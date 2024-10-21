'use strict';

var Slang;
var globalSlangSession;
var slangSession;
var device;
var context;
var computePipeline;
var passThroughPipeline;

var monacoEditor;
var diagnosticsArea;
var codeGenArea;

const SLANG_STAGE_VERTEX = 1;
const SLANG_STAGE_FRAGMENT = 5;
const SLANG_STAGE_COMPUTE = 6;

var sourceCodeChange = true;
var g_needResize = false;

// TODO: Question?
// When we generate the shader code to wgsl, the uniform variable (float time) will have 16 bytes alignment, which is not shown in the slang
// code. So how the user can know the correct alignment of the uniform variable without using the slang reflection API or
// looking at the generated shader code?
const defaultShaderCode = `
uniform float time;
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

    float stripSize = width / 40;

    float dist = distance(pos, center) + time;
    float strip = dist / stripSize % 2.0;

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
    if (!adapter)
    {
        console.log('need a browser that supports WebGPU');
        return;
    }

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

    // The default resolution of a canvas element is 300x150, which is too small compared to the container size of the canvas,
    // therefore, we have to set the resolution same as the container size.

    const observer = new ResizeObserver((entries) => { resizeCanvasHandler(entries); });
    observer.observe(canvas);
}

function resizeCanvas(entries)
{
    const canvas = entries[0].target;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width || canvas.height !== height)
    {
        // ensure the size won't be 0 nor exceed the limit, otherwise WebGPU will throw an errors
        canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
        canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));

        return true;
    }

    return false;
}

// We use the timer in the resize handler debounce the resize event, otherwise we could end of rendering
// multiple useless frames.
function resizeCanvasHandler(entries)
{
    setTimeout(() => {
        var needResize = resizeCanvas(entries);
        if (needResize)
        {
            if (computePipeline && passThroughPipeline)
            {
                computePipeline.createOutput(true);
                computePipeline.createBindGroup();
                passThroughPipeline.inputTexture = computePipeline.outputTexture;
                passThroughPipeline.createBindGroup();
                requestAnimationFrame(render);
            }
        }
    }, 100);
}


async function render(timeMS)
{
    // we only need to re-create the pipeline when the source code is changed and recompiled.
    if (sourceCodeChange)
    {
        var shaderCode = codeGenArea.getValue();
        const module = device.createShaderModule({code:shaderCode});
        computePipeline.createPipeline(module);
        sourceCodeChange = false;
    }


    computePipeline.updateUniformBuffer(timeMS * 0.01);
    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setBindGroup(0, computePipeline.bindGroup);
    pass.setPipeline(computePipeline.pipeline);
    pass.dispatchWorkgroups(canvas.clientWidth, canvas.clientHeight);
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
    // encoder.copyBufferToBuffer(computePipeline.outputBuffer, 0, computePipeline.outputBufferRead, 0, computePipeline.outputBuffer.size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    requestAnimationFrame(render);
}

async function waitForComplete(outputBufferRead)
{
    // Read the results
    await Promise.all([
        outputBufferRead.mapAsync(GPUMapMode.READ),
    ]);

    const output = new Int32Array(outputBufferRead.getMappedRange());

    outputResult(output).then(() => {
        outputBufferRead.unmap()
    });
}

async function outputResult(output)
{
    // TODO: Optional - output the printable result to the output area
    // we don't have such area in the current UI
    // var result = "";
    // for (let i = 0; i < output.length; i++)
    // {
    //      result += output[i] + '\n';
    // }
    //
    // document.getElementById("result").value = result;
}

var TrySlang = {
    compile: function(shaderSource, entryPointName, stage) {

        try {
            slangSession = globalSlangSession.createSession();
            if(!slangSession) {
                var error = Slang.getLastError();
                console.error(error.type + " error: " + error.message);
                codeGenArea.setValue(error.type + " error: " + error.message);
                return null;
            }

            var module = slangSession.loadModuleFromSource(shaderSource);
            if(!module) {
                var error = Slang.getLastError();
                console.error(error.type + " error: " + error.message);
                codeGenArea.setValue(error.type + " error: " + error.message);
                return null;
            }
            var entryPoint = module.findAndCheckEntryPoint(entryPointName, stage);
            if(!entryPoint) {
                var error = Slang.getLastError();
                console.error(error.type + " error: " + error.message);
                codeGenArea.setValue(error.type + " error: " + error.message);
                return null;
            }
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
                codeGenArea.setValue(error.type + " error: " + error.message);
                return null;
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
            if (slangSession) {
                slangSession.delete();
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
        computePipeline.createUniformBuffer(4); // 4 bytes for float number
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
    if (!wgslCode)
        return;

    codeGenArea.setValue(wgslCode);

    render(0);
    // TODO: This function is used to read the output buffer from GPU, and print out.
    // We will add an option to select render Mode and print mode. Once print mode is selected,
    // we will not enable the animation, and will call this function to print results on screen.
    // waitForComplete(computePipeline.outputBufferRead);

    var code=monacoEditor.getValue();
    console.log(code);
}

function onSourceCodeChange()
{
    sourceCodeChange = true;
}

function loadEditor(readOnlyMode = false, containerId, preloadCode) {

    require(["vs/editor/editor.main"], function () {
      var editor = monaco.editor.create(document.getElementById(containerId), {
                  value: preloadCode,
                  language: 'javascript',
                  theme: 'vs-dark',
                  readOnly: readOnlyMode,
                  automaticLayout: true,
              });

        if (containerId == "codeEditor")
            monacoEditor = editor;
        else if (containerId == "diagnostics")
            diagnosticsArea = editor;
        else if (containerId == "codeGen")
        {
            codeGenArea = editor;
            codeGenArea.onDidChangeModelContent(function (e) {
              onSourceCodeChange();
            });
        }
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
        } catch (e) {
            console.log(e);
            document.getElementById("WebGPU-status-bar").innerHTML = "Failed to initialize Slang Compiler";
            return;
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
