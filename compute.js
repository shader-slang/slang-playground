
var sprintf = null;

class ComputePipeline
{
    pipeline;
    pipelineLayout;

    // TODO: We should make this field optional, and only when user select a "Debug" mode will this option be available,
    // and we will output this buffer to the output area.

    uniformBuffer;
    uniformBufferHost = new Float32Array(4);


    printfBufferElementSize = 12;
    printfBufferSize = this.printfBufferElementSize * 100; // 16 bytes per printf struct
    printfBuffer;
    printfBufferRead;

    outputBuffer;
    outputBufferRead;
    outputTexture;
    device;
    bindGroup;

    constructor(device)
    {
        this.device = device;
    }

    createComputePipelineLayout()
    {
        // We fill fix our bind group layout to have 2 entries in our playground.
        const bindGroupLayoutDescriptor = {
            lable: 'compute pipeline bind group layout',
            entries: [
                {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
                {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
                {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
                {binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: {access: "write-only", format: this.outputTexture.format}},
            ],
        };

        const bindGroupLayout = device.createBindGroupLayout(bindGroupLayoutDescriptor);
        const layout = device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});

        this.pipelineLayout = layout;
    }

    createPipeline(shaderModule)
    {
        const pipeline = device.createComputePipeline({
            label: 'compute pipeline',
            layout: this.pipelineLayout,
            compute: {module: shaderModule},
            });

        this.pipeline = pipeline;
        this.createBindGroup();
    }

    createBindGroup()
    {
        const bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                    { binding: 0, resource: { buffer: this.uniformBuffer }},
                    { binding: 1, resource: { buffer: this.printfBuffer }},
                    { binding: 2, resource: { buffer: this.outputBuffer }},
                    { binding: 3, resource: this.outputTexture.createView() },
                    ],
            });

        this.bindGroup = bindGroup;
    }

    destroyResources()
    {
        if (this.outputBuffer)
        {
            this.outputBuffer.destroy();
            this.outputBuffer = null;
        }

        if (this.outputBufferRead)
        {
            this.outputBufferRead.destroy();
            this.outputBufferRead = null;
        }

        if (this.printfBuffer)
        {
            this.printfBuffer.destroy();
            this.printfBuffer = null;
        }

        if (this.printfBufferRead)
        {
            this.printfBufferRead.destroy();
            this.printfBufferRead = null;
        }

        if (this.outputTexture)
        {
            this.outputTexture.destroy();
            this.outputTexture = null;
        }
    }
    // All out compute pipeline will have 2 outputs:
    // 1. A buffer that will be used to read the result back to the CPU
    // 2. A texture that will be used to display the result on the screen
    createOutput(invalid, windowSize)
    {
        if (invalid)
        {
            this.destroyResources();
            let usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;

            // we will fix the size of the workgroup to be 2 x 2 for printMain.
            const numberElements = 1;
            const size = numberElements * 4; // int type
            this.outputBuffer = this.device.createBuffer({lable: 'outputBuffer', size, usage});

            this.printfBuffer = this.device.createBuffer({lable: 'outputBuffer', size: this.printfBufferSize, usage});

            usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
            this.outputBufferRead = this.device.createBuffer({lable: 'outputBufferRead', size, usage});
            this.printfBufferRead = this.device.createBuffer({lable: 'outputBufferRead', size: this.printfBufferSize, usage});

            this.outputTexture = createOutputTexture(device, windowSize[0], windowSize[1], 'rgba8unorm');
        }
    }

    createUniformBuffer()
    {
        this.uniformBuffer = this.device.createBuffer({size: this.uniformBufferHost.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    }

    updateUniformBuffer(data)
    {
        this.uniformBufferHost[0] = data;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformBufferHost);
    }

    setupComputePipeline(windowSize)
    {
        this.createOutput(true, windowSize);
        this.createComputePipelineLayout();
    }


    // This is the definition of the printf buffer.
    // struct FormatedStruct
    // {
    //     uint32_t type = 0xFFFFFFFF;
    //     uint32_t low = 0;
    //     uint32_t high = 0;
    // };
    parsePrintfBuffer(hashedString)
    {
        const printfBufferArray = new Uint32Array(computePipeline.printfBufferRead.getMappedRange())
        var elementIndex = 0;
        var numberElements = printfBufferArray.byteLength / this.printfBufferElementSize;

        var formatString;
        if (printfBufferArray[0] == 1)                                      // type field
        {
            formatString = hashedString.getString(printfBufferArray[1]);    // low field
        }
        else
        {
            // If the first element is not a string, we will just return an empty string, it indicates
            // that the printf buffer is empty.
            return "";
        }

        // TODO: We currently doesn't support 64-bit data type (e.g. uint64_t, int64_t, double, etc.)
        // so 32-bit array should be able to contain everything we need.
        var dataArray = [];
        const elementSizeInWords = this.printfBufferElementSize / 4;
        for (elementIndex = 1; elementIndex < numberElements; elementIndex++)
        {
            var offset = elementIndex * elementSizeInWords;
            const type = printfBufferArray[offset];

            if (type == 1)                                      // type field, this is a string
            {
                dataArray.push(hashedString.getString(printfBufferArray[offset + 1]));  // low field
            }
            else if (type == 2)                                 // type field
            {
                dataArray.push(printfBufferArray[offset + 1]);  // low field
            }
            else if (type == 3)                                 // type field
            {
                const floatData = reinterpretUint32AsFloat(printfBufferArray[offset + 1]);
                dataArray.push(floatData);                      // low field
            }
            else if (type == 4)                                 // type field
            {
                // TODO: We can't handle 64-bit data type yet.
                dataArray.push(0);                      // low field
            }
            else if (type == 0xFFFFFFFF)
            {
                break;
            }
        }

        const parsedTokens = parsePrintfFormat(formatString);
        const output = formatPrintfString(parsedTokens, dataArray);
        return output;
    }
}
