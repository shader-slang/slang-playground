
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
    createOutput(invalid, windowSize)
    {
        if (invalid)
        {
            this.destroyResources();
            let usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;

            // we will fix the size of the workgroup to be 2 x 2 for printMain.
            const numberElements = 2 * 2;
            const size = numberElements * 4; // int type
            this.outputBuffer = this.device.createBuffer({label: 'outputBuffer', size, usage});

            usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
            const outputBufferRead = this.device.createBuffer({label: 'outputBufferRead', size, usage});
            this.outputBufferRead = outputBufferRead;

            const storageTexture = createOutputTexture(device, windowSize[0], windowSize[1], 'r32float');
            this.outputTexture = storageTexture;

        }
    }
}
