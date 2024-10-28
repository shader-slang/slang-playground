
class ComputePipeline
{
    pipeline;
    pipelineLayout;

    // TODO: We should make this field optional, and only when user select a "Debug" mode will this option be available,
    // and we will output this buffer to the output area.

    uniformBuffer;
    uniformBufferHost = new Float32Array(4);

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
                {binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: {access: "read-write", format: this.outputTexture.format}},
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
                    { binding: 1, resource: { buffer: this.outputBuffer }},
                    { binding: 2, resource: this.outputTexture.createView() },
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

            // we will fix the size of the workgroup to be 32x32 for printMain.
            const numberElements = 16 * 16 /*windowSize[0] * windowSize[1]*/;
            const size = numberElements * 4; // int type
            this.outputBuffer = this.device.createBuffer({lable: 'outputBuffer', size, usage});

            usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
            const outputBufferRead = this.device.createBuffer({lable: 'outputBufferRead', size, usage});
            this.outputBufferRead = outputBufferRead;

            const storageTexture = createOutputTexture(device, windowSize[0], windowSize[1], 'r32float');
            this.outputTexture = storageTexture;

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
}
