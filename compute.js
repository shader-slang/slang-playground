
class ComputePipeline
{
    pipeline;
    pipelineLayout;

    // TODO: We should make this field optional, and only when user select a "Debug" mode will this option be available,
    // and we will output this buffer to the output area.

    outputBuffer;
    outputBufferRead;
    outputTexture;
    device;
    bindGroup;

    // thread group size (array of 3 integers)
    threadGroupSize;

    // resource name (string) -> binding descriptor 
    resourceBindings;

    constructor(device)
    {
        this.device = device;
    }

    setThreadGroupSize(size)
    {
        this.threadGroupSize = size;
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
        
        // If resources are provided, create the bind group right away
        if (resources)
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
        if (entries.length != this.resourceBindings.size)
        {
            // print out the names of the resources that aren't bound
            for (const [name, resource] of this.resourceBindings)
            {
                var missingEntries = []
                if (!entries.find(entry => entry.binding == resource.binding))
                {
                    missingEntries.push(name);
                }
            }

            throw new Error("Cannot create bind-group. The following resources are not bound: " + missingEntries.join(", "));
        }
        
        this.bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: entries,
        });
    }
}
