'use strict';

var Slang;
<<<<<<< HEAD
var globalSlangSession;
var slangSession;
=======
var device;
>>>>>>> 272516a (Render something on browser)

async function webgpuInit()
{
    const adapter = await navigator.gpu?.requestAdapter();

    const requiredFeatures = [];
    if (adapter.features.has('bgra8unorm-storage')) {
        requiredFeatures.push('bgra8unorm-storage')
    }

    device = await adapter?.requestDevice({requiredFeatures});
    if (!device)
    {
        fail('need a browser that supports WebGPU');
        return;
    }
}

class ComputePipeline
{
    pipeline;
    pipelineLayout;
    outputBuffer;
    outputTexture;
    outputImageBuffer; // will be deleted once we have graphics render pass
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
        // const workgroupSize = [canvas.width, canvas.height, 1];
        // const dispatchCount = [1, 1, 1];
        const numberElements = canvas.width * canvas.height;
        const size = numberElements * 4; // int type
        this.outputBuffer = this.device.createBuffer({size, usage});

        usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
        const outputBufferRead = this.device.createBuffer({size, usage});
        this.outputBufferRead = outputBufferRead;

        const imageBuffer = this.device.createBuffer({size, usage});
        this.outputImageBuffer = imageBuffer;

        const storageTexture = createOutputTexture(device, canvas.width, canvas.height, 'r32uint');
        this.outputTexture = storageTexture;

    }

    setupComputePipeline()
    {
        this.createOutput();
        this.createComputePipelineLayout(this.shaderModule, 'r32uint');
    }
}

function render(shaderCode)
{
    // const context = configContext(device, canvas);
    const module = device.createShaderModule({code:shaderCode});
    computePipeline.createPipeline(module);

    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setPipeline(computePipeline.pipeline);
    pass.setBindGroup(0, computePipeline.bindGroup);
    pass.dispatchWorkgroups(canvas.width, canvas.height);
    pass.end();

    encoder.copyBufferToBuffer(computePipeline.outputBuffer, 0, computePipeline.outputBufferRead, 0, computePipeline.outputBuffer.size);

    const sourceTex = { texture: computePipeline.outputTexture};
    const dstBuffer = {
            bytesPerRow: canvas.width * 4,
            rowPerImage: canvas.height,
            buffer: computePipeline.outputImageBuffer
        };
    encoder.copyTextureToBuffer(sourceTex, dstBuffer, {width: canvas.width, height: canvas.height});

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
}

async function waitForComplete(outputBufferRead, outputImageBuffer)
{
    // Read the results
    await Promise.all([
        outputBufferRead.mapAsync(GPUMapMode.READ),
    ]);

    await Promise.all([
        outputImageBuffer.mapAsync(GPUMapMode.READ),
    ]);

    const output = new Int32Array(outputBufferRead.getMappedRange());

    const outputImage = new Uint32Array(outputImageBuffer.getMappedRange());

    outputResult(output);
    copyToCanvas(outputImage);

    outputBufferRead.unmap();
    outputImageBuffer.unmap();
}

function copyToCanvas(outputImage)
{
    var ctx = canvas.getContext("2d");;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < outputImage.length; i++)
    {
        var pix = outputImage[i];
        const r  = ((pix & 0xFF000000) >> 24);
        const g  = ((pix & 0x00FF0000) >> 16);
        const b  = ((pix & 0x0000FF00) >> 8);
        const a  = ((pix & 0x000000FF) >> 0);
        const pixel = new Uint8Array([r, g, b, a]);

        data[i * 4] =     pixel[0];
        data[i * 4 + 1] = pixel[1];
        data[i * 4 + 2] = pixel[2];
        data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
}

function outputResult(output)
{
    var result = "";
    for (let i = 0; i < output.length; i++)
    {
         result += output[i] + '\n';
    }

    document.getElementById("result").value = result;
}

var TrySlang = {
    compile: function(shaderSource, entryPointName, stage) {

        try {
            var slangCode = document.getElementById("input").value;
            var module = slangSession.loadModuleFromSource(slangCode);
            if(!module) {
                var error = Slang.getLastError();
                console.error(error.type + " error: " + error.message);
                return;
            }
            var entryPoint = module.findEntryPointByName(entryPointName, stage);
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
        } catch (e) {
            console.log(e);
            return null;
        }
        finally {
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
            return wgslCode;
        }
    },
};

const SLANG_STAGE_VERTEX = 1;
const SLANG_STAGE_FRAGMENT = 5;
const SLANG_STAGE_COMPUTE = 6;

var computePipeline;
var onRunCompile = () => {
    if (device && !computePipeline)
    {
        computePipeline = new ComputePipeline(device);
        computePipeline.setupComputePipeline();
    }

    var shaderSource = document.getElementById("input").value;
    var wgslCode = TrySlang.compile(shaderSource, "computeMain", SLANG_STAGE_COMPUTE);

    var test = document.getElementById("passthrough_shader");

    var wgsl_vert = TrySlang.compile(passThroughshaderCode, "vertexMain", SLANG_STAGE_VERTEX);
    var wgsl_frag = TrySlang.compile(passThroughshaderCode, "fragMain", SLANG_STAGE_FRAGMENT);

    render(wgslCode);
    waitForComplete(computePipeline.outputBufferRead, computePipeline.outputImageBuffer);
}


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
        webgpuInit();
    },
};
