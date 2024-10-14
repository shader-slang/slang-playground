'use strict';

var Slang;
var globalSlangSession;
var slangSession;

async function webgpuInit(shaderCode)
{
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device)
    {
        fail('need a browser that supports WebGPU');
        return;
    }

    const module = device.createShaderModule({code:shaderCode});
    const pipeline = device.createComputePipeline({
        label: 'compute pipeline',
        layout: 'auto',
        compute: {module},
        });

    let usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
    const workgroupSize = [4, 1, 1];
    const dispatchCount = [1, 1, 1];
    const numberElements = workgroupSize.reduce((accumulator, currentValue) => accumulator * currentValue, 1);
    const size = numberElements * 4; // int type
    const outputBuffer = device.createBuffer({size, usage});

    usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
    const outputBufferRead = device.createBuffer({size, usage});

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
                { binding: 0, resource: { buffer: outputBuffer }},
                ],
        });

    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(...dispatchCount);
    pass.end();

    encoder.copyBufferToBuffer(outputBuffer, 0, outputBufferRead, 0, size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    // Read the results
    await Promise.all([
        outputBufferRead.mapAsync(GPUMapMode.READ),
    ]);

    const output = new Int32Array(outputBufferRead.getMappedRange());

    outputResult(output)
}


var TrySlang = {
    iterate: function() {

        try {
            var slangCode = document.getElementById("input").value;
            var module = slangSession.loadModuleFromSource(slangCode);
            if(!module) {
                var error = Slang.getLastError();
                console.error(error.type + " error: " + error.message);
                return;
            }
            var entryPoint = module.findEntryPointByName("computeMain");
            var components = new Slang.ComponentTypeList();
            components.push_back(module);
            components.push_back(entryPoint);
            var program = slangSession.createCompositeComponentType(components);
            var linkedProgram = program.link();
            var wgslCode =
                linkedProgram.getEntryPointCode(
                    0 /* entryPointIndex */, 0 /* targetIndex */
                );
            if(wgslCode == "") {
                var error = Slang.getLastError();
                console.error(error.type + " error: " + error.message);
                return;
            }
            document.getElementById("output").value = wgslCode;
        } finally {
            if(linkedProgram) {
                linkedProgram.delete();
            }
            if(program) {
                program.delete();
            }
            if(entryPoint) {
                entryPoint.delete();
            }
            if(module) {
                module.delete();
            }
        }
    },
};


var Module = {
    onRuntimeInitialized: function() {
        Slang = Module;
        try {
            globalSlangSession = Slang.createGlobalSession();
            if(!globalSlangSession) {
                var error = Slang.getLastError();
                console.error(error.type + " error: " + error.message);
                return;
            }
            slangSession = globalSlangSession.createSession();
            if(!slangSession) {
                var error = Slang.getLastError();
                console.error(error.type + " error: " + error.message);
                return;
            }

            TrySlang.iterate();

        } finally {
            if(globalSlangSession) {
                globalSlangSession.delete();
            }
            if(slangSession) {
                slangSession.delete();
            }
        }

    },
};
