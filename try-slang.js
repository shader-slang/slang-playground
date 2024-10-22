'use strict';

var compiler;
var device;
var context;
var computePipeline;
var passThroughPipeline;

var monacoEditor;
var diagnosticsArea;
var codeGenArea;


var sourceCodeChange = true;

// TODO: Question?
// When we generate the shader code to wgsl, the uniform variable (float time) will have 16 bytes alignment, which is not shown in the slang
// code. So how the user can know the correct alignment of the uniform variable without using the slang reflection API or
// looking at the generated shader code?
const defaultShaderCode = `
uniform float time;
RWStructuredBuffer<int>               outputBuffer;
[format("r32f")] RWTexture2D<float>   texture;


[shader("compute")]
void imageMain(int3 dispatchThreadID : SV_DispatchThreadID)
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

    // This feature is not necessary if we can support write-only texture in slang.
    const requiredFeatures = [];
    requiredFeatures.push('bgra8unorm-storage');
    requiredFeatures.push('float32-filterable');

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


var onRun = () => {
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

    // When click the run button, we won't provide the entrypoint name, the compiler will try
    // the all the runnable entry points, and if it can't find it, it will not run the shader
    // and show the error message in the diagnostics area.
    const ret = compileShader("");
    if (!ret)
    {
        diagnosticsArea.setValue(compiler.diagnosticsMsg);
        return;
    }

    render(0);
    // TODO: This function is used to read the output buffer from GPU, and print out.
    // We will add an option to select render Mode and print mode. Once print mode is selected,
    // we will not enable the animation, and will call this function to print results on screen.
    // waitForComplete(computePipeline.outputBufferRead);
}

function compileShader(entryPoint)
{
    // compile the compute shader code from input text area
    var slangSource = monacoEditor.getValue();
    var compiledCode = compiler.compile(slangSource, entryPoint, SlangCompiler.SLANG_STAGE_COMPUTE);

    // If compile is failed, we just clear the codeGenArea
    if (!compiledCode)
    {
        codeGenArea.setValue('');
        return false;
    }

    codeGenArea.setValue(compiledCode);
    return true;
}

var onCompile = () => {
    // TODO: We should get the entry point from the UI
    compileShader("computeMain");
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


// Event when loading the WebAssembly module
var Module = {
    onRuntimeInitialized: function() {
        compiler = new SlangCompiler(Module);
        var result = compiler.init();
        if (result.ret)
        {
            document.getElementById("compile-btn").disabled = false;
        }
        else
        {
            console.log(result.msg);
            document.getElementById("WebGPU-status-bar").innerHTML = "Failed to initialize Slang Compiler " + result.msg;
        }
    },
};

// even when loading the page
window.onload = function ()
{
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
}
