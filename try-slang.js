'use strict';

const SLANG_STAGE_VERTEX = 1;
const SLANG_STAGE_FRAGMENT = 5;
const SLANG_STAGE_COMPUTE = 6;

var Slang;
var globalSlangSession;
var slangSession;
var device;
var context;
var computePipeline;
var passThroughPipeline;

var monacoEditor;
var outputCodeArea;

const defaultShaderCode = `
RWStructuredBuffer<int>               outputBuffer;
[format("r32f")] RWTexture2D<float>   texture;


[shader("compute")]
void computeMain(int3 dispatchThreadID : SV_DispatchThreadID)
{
    int idx = dispatchThreadID.x * 32 + dispatchThreadID.y;
    outputBuffer[idx] = idx;

    uint width = 0;
    uint height = 0;
    texture.GetDimensions(width, height);

    float2 size = float2(width, height);
    float2 center = size / 2.0;

    float2 pos = float2(dispatchThreadID.xy);

    float dist = distance(pos, center);
    float strip = dist / 32.0 % 2.0;

    uint color = 0;
    if (strip < 1.0f)
        color = 0xFF0000FF;
    else
        color = 0x00FFFFFF;

    texture[dispatchThreadID.xy] = float(color);
}
`;

async function webgpuInit()
{
    const adapter = await navigator.gpu?.requestAdapter();

    const requiredFeatures = [];

    // This feature is not necessary if we can support write-only texture in slang.
    if (adapter.features.has('bgra8unorm-storage')) {
        requiredFeatures.push('float32-filterable')
    }

    device = await adapter?.requestDevice({requiredFeatures});
    if (!device)
    {
        console.log('need a browser that supports WebGPU');
        return;
    }
    context = configContext(device, canvas);
}


function render(shaderCode)
{
    const module = device.createShaderModule({code:shaderCode});
    computePipeline.createPipeline(module);

    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setBindGroup(0, computePipeline.bindGroup);
    pass.setPipeline(computePipeline.pipeline);
    pass.dispatchWorkgroups(canvas.width, canvas.height);
    pass.end();

    // Get a WebGPU context from the canvas and configure it

    var renderPassDescriptor = passThroughPipeline.createRenderPassDesc();
    renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass(renderPassDescriptor);

    renderPass.setBindGroup(0, passThroughPipeline.bindGroup);
    renderPass.setPipeline(passThroughPipeline.pipeline);
    renderPass.draw(6);  // call our vertex shader 6 times.
    renderPass.end();

    // copy output buffer back
    encoder.copyBufferToBuffer(computePipeline.outputBuffer, 0, computePipeline.outputBufferRead, 0, computePipeline.outputBuffer.size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
}

async function waitForComplete(outputBufferRead)
{
    // Read the results
    await Promise.all([
        outputBufferRead.mapAsync(GPUMapMode.READ),
    ]);

    const output = new Int32Array(outputBufferRead.getMappedRange());

    outputResult(output);
    outputBufferRead.unmap();
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


var onRunCompile = () => {
    if (!device)
        return;

    if (!computePipeline)
    {
        computePipeline = new ComputePipeline(device);
        computePipeline.setupComputePipeline();
    }

    if (!passThroughPipeline)
    {
        passThroughPipeline = new GraphicsPipeline(device);
        const shaderModule = device.createShaderModule({code: passThroughshaderCode});
        const inputTexture = computePipeline.outputTexture;
        passThroughPipeline.createPipeline(shaderModule, inputTexture);
    }

    // compile the compute shader code from input text area
    var shaderSource = monacoEditor.getValue();
    var wgslCode = TrySlang.compile(shaderSource, "computeMain", SLANG_STAGE_COMPUTE);
    outputCodeArea.setValue(wgslCode);

    render(wgslCode);
    waitForComplete(computePipeline.outputBufferRead);

    var code=monacoEditor.getValue();
    console.log(code);
}


function loadEditor(readOnlyMode = false, containerId, preloadCode) {

    require(["vs/editor/editor.main"], function () {
      var editor = monaco.editor.create(document.getElementById(containerId), {
                  value: preloadCode,
                  language: 'javascript',
                  theme: 'vs-dark',
                  readOnly: readOnlyMode
              });
        if (readOnlyMode)
            outputCodeArea = editor;
        else
            monacoEditor = editor;
    });
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

        var promise = webgpuInit();
        promise.then(() => {
            if (device)
            {
                document.getElementById("run-btn").disabled = false;
            }
            else
            {
                document.getElementById("WebGPU-status-bar").innerHTML = "Browser does not support WebGPU";
            }
        });
    },
};
