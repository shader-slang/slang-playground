
class ComputePipeline
{
    pipeline;
    pipelineLayout;

    // TODO: We should make this field optional, and only when user select a "Debug" mode will this option be available,
    // and we will output this buffer to the output area.

    uniformBuffer;
    uniformBufferHost = new Float32Array(4);


    printfBufferElementSize = 12;
    printfBufferSize = this.printfBufferElementSize * 2048; // 12 bytes per printf struct
    printfBuffer;
    printfBufferRead;

    outputBuffer;
    outputBufferRead;
    outputTexture;
    device;
    bindGroup;

    // resource name (string) -> binding descriptor 
    resourceBindings;

    constructor(device)
    {
        this.device = device;
    }

    createPipelineLayout(resourceDescriptors)
    {
        this.resourceBindings = resourceDescriptors;

        const entries = [];
        for (const [name, binding] of this.resourceBindings)
        {
            entries.push(binding);
        }
        const bindGroupLayoutDescriptor = {
            label: 'compute pipeline bind group layout',
            entries: entries,
            //lable: 'compute pipeline bind group layout',
            //entries: [
            //    {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
            //    {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
            //    {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
            //    {binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: {access: "write-only", format: this.outputTexture.format}},
            //],
        };

        const bindGroupLayout = device.createBindGroupLayout(bindGroupLayoutDescriptor);
        const layout = device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});

        this.pipelineLayout = layout;
    }

    createPipeline(shaderModule, resources)
    {
        const pipeline = device.createComputePipeline({
            label: 'compute pipeline',
            layout: this.pipelineLayout,
            compute: {module: shaderModule},
            });

        this.pipeline = pipeline;
        this.createBindGroup(resources);
    }

    createBindGroup(allocatedResources)
    {
        const entries = [];
        for (const [name, resource] of allocatedResources)
        {
            const bindInfo = this.resourceBindings.get(name);
            
            if (bindInfo)
            {
                if (bindInfo.buffer)
                {
                    entries.push({binding: bindInfo.binding, resource: {buffer: resource}});
                }
                else if (bindInfo.storageTexture)
                {
                    entries.push({binding: bindInfo.binding, resource: resource.createView()});
                }
                else if (bindInfo.texture)
                {
                    entries.push({binding: bindInfo.binding, resource: resource.createView()});
                }
            }
        }

        // Check that all resources are bound
        if (entries.length != resourceBindings.size)
        {
            // print out the name of the resource that is not bound
            for (const [name, resource] of resourceBindings)
            {
                var missingEntries = []
                if (!entries.find(entry => entry.resource == resource))
                {
                    missingEntries.push(name);
                }
            }

            // throw
            throw new Error("Cannot create bind-group. The following resources are not bound: " + missingEntries.join(", "));
        }
        
        this.bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: entries,
        });
    }

    // All out compute pipeline will have 2 outputs:
    // 1. A buffer that will be used to read the result back to the CPU
    // 2. A texture that will be used to display the result on the screen
    /*createOutput(invalid, windowSize)
    {
        if (invalid)
        {
            this.destroyResources();
            let usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;

            // we will fix the size of the workgroup to be 2 x 2 for printMain.
            const numberElements = 1;
            const size = numberElements * 4; // int type
            this.outputBuffer = this.device.createBuffer({label: 'outputBuffer', size, usage});

            this.printfBuffer = this.device.createBuffer({lable: 'outputBuffer', size: this.printfBufferSize, usage});

            usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
            this.outputBufferRead = this.device.createBuffer({lable: 'outputBufferRead', size, usage});
            this.printfBufferRead = this.device.createBuffer({lable: 'outputBufferRead', size: this.printfBufferSize, usage});

            this.outputTexture = createOutputTexture(device, windowSize[0], windowSize[1], 'rgba8unorm');
        }
    }*/

    // This is the definition of the printf buffer.
    // struct FormatedStruct
    // {
    //     uint32_t type = 0xFFFFFFFF;
    //     uint32_t low = 0;
    //     uint32_t high = 0;
    // };
    //
    parsePrintfBuffer(hashedString)
    {
        const printfBufferArray = new Uint32Array(computePipeline.printfBufferRead.getMappedRange())
        var elementIndex = 0;
        var numberElements = printfBufferArray.byteLength / this.printfBufferElementSize;

        // TODO: We currently doesn't support 64-bit data type (e.g. uint64_t, int64_t, double, etc.)
        // so 32-bit array should be able to contain everything we need.
        var dataArray = [];
        const elementSizeInWords = this.printfBufferElementSize / 4;
        var outStrArry = [];
        var formatString = "";
        for (elementIndex = 0; elementIndex < numberElements; elementIndex++)
        {
            var offset = elementIndex * elementSizeInWords;
            const type = printfBufferArray[offset];
            switch (type)
            {
                case 1: // format string
                    formatString = hashedString.getString(printfBufferArray[offset + 1]);    // low field
                    break;
                case 2: // normal string
                    dataArray.push(hashedString.getString(printfBufferArray[offset + 1]));  // low field
                    break;
                case 3: // integer
                    dataArray.push(printfBufferArray[offset + 1]);  // low field
                    break;
                case 4: // float
                    const floatData = reinterpretUint32AsFloat(printfBufferArray[offset + 1]);
                    dataArray.push(floatData);                      // low field
                    break;
                case 5: // TODO: We can't handle 64-bit data type yet.
                    dataArray.push(0);                              // low field
                    break;
                case 0xFFFFFFFF:
                {
                    const parsedTokens = parsePrintfFormat(formatString);
                    const output = formatPrintfString(parsedTokens, dataArray);
                    outStrArry.push(output);
                    formatString = "";
                    dataArray = [];
                    if (elementIndex < numberElements - 1)
                    {
                        const nextOffset = offset + elementSizeInWords;
                        // advance to the next element to see if it's a format string, if it's not we just early return
                        // the results, otherwise just continue processing.
                        if (printfBufferArray[nextOffset] != 1)          // type field
                        {
                            return outStrArry;
                        }
                    }
                    break;
                }
            }
        }

        if (formatString != "")
        {
            // If we are here, it means that the printf buffer is used up, and we are in the middle of processing
            // one printf string, so we are still going to format it, even though there could be some data missing, which
            // will be shown as 'undef'.
            const parsedTokens = parsePrintfFormat(formatString);
            const output = formatPrintfString(parsedTokens, dataArray);
            outStrArry.push(output);
            outStrArry.push("Print buffer is out of boundary, some data is missing!!!");
        }

        return outStrArry;
    }

}
