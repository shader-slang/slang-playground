import { Bindings } from "./compiler";

class ComputePipeline
{
    pipeline: GPUComputePipeline | undefined;
    pipelineLayout: GPUPipelineLayout | "auto" | undefined;

    // TODO: We should make this field optional, and only when user select a "Debug" mode will this option be available,
    // and we will output this buffer to the output area.

    outputBuffer: any;
    outputBufferRead: any;
    outputTexture: any;
    device;
    bindGroup: GPUBindGroup | undefined;

    // thread group size (array of 3 integers)
    threadGroupSize: any;

    // resource name (string) -> binding descriptor 
    resourceBindings: Bindings | undefined;

    constructor(device: GPUDevice)
    {
        this.device = device;
    }

    setThreadGroupSize(size: number)
    {
        this.threadGroupSize = size;
    }

    createPipelineLayout(resourceDescriptors: Bindings)
    {
        this.resourceBindings = resourceDescriptors;

        const entries: GPUBindGroupLayoutEntry[] = [];
        for (const [name, binding] of this.resourceBindings)
        {
            entries.push(binding);
        }
        const bindGroupLayoutDescriptor: GPUBindGroupLayoutDescriptor = {
            label: 'compute pipeline bind group layout',
            entries: entries,
        };

        const bindGroupLayout = this.device.createBindGroupLayout(bindGroupLayoutDescriptor);
        const layout = this.device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});

        this.pipelineLayout = layout;
    }

    createPipeline(shaderModule: GPUShaderModule, resources: Map<any, any> | null)
    {
        if(this.pipelineLayout == undefined)
            throw new Error("Cannot create pipeline without layout")
        const pipeline = this.device.createComputePipeline({
            label: 'compute pipeline',
            layout: this.pipelineLayout,
            compute: {module: shaderModule},
            });

        this.pipeline = pipeline;
        
        // If resources are provided, create the bind group right away
        if (resources)
            this.createBindGroup(resources);
    }

    createBindGroup(allocatedResources: Map<any, any>)
    {
        if(this.resourceBindings == undefined)
            throw new Error("No resource bindings")
        if(this.pipeline == undefined)
            throw new Error("No pipeline")

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
            let missingEntries = []
            // print out the names of the resources that aren't bound
            for (const [name, resource] of this.resourceBindings)
            {
                missingEntries = []
                if (!entries.find(entry => entry.binding == resource.binding))
                {
                    missingEntries.push(name);
                }
            }

            throw new Error("Cannot create bind-group. The following resources are not bound: " + missingEntries.join(", "));
        }
        
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: entries,
        });
    }
}
