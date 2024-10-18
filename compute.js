
class ComputePipeline
{
    pipeline;
    pipelineLayout;

    // TODO: We should make this field optional, and only when user select a "Debug" mode will this option be available,
    // and we will output this buffer to the output area.
    outputBuffer;
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
                {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
                {binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: {access: "read-write", format: this.outputTexture.format}},
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

        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                    { binding: 0, resource: { buffer: this.outputBuffer }},
                    { binding: 1, resource: this.outputTexture.createView() },
                    ],
            });

        this.bindGroup = bindGroup;
        this.pipeline = pipeline;
    }

    // All out compute pipeline will have 2 outputs:
    // 1. A buffer that will be used to read the result back to the CPU
    // 2. A texture that will be used to display the result on the screen
    createOutput()
    {
        let usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
        const numberElements = canvas.clientWidth * canvas.clientHeight;
        const size = numberElements * 4; // int type
        this.outputBuffer = this.device.createBuffer({size, usage});

        usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
        const outputBufferRead = this.device.createBuffer({size, usage});
        this.outputBufferRead = outputBufferRead;

        const imageBuffer = this.device.createBuffer({size, usage});
        this.outputImageBuffer = imageBuffer;

        const storageTexture = createOutputTexture(device, canvas.clientWidth, canvas.clientHeight, 'r32float');
        this.outputTexture = storageTexture;

    }

    setupComputePipeline()
    {
        this.createOutput();
        this.createComputePipelineLayout();
    }
}
