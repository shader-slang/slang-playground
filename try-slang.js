'use strict';

var compiler = null;
var device;
var context;
var computePipeline;
var passThroughPipeline;

var monacoEditor;
var diagnosticsArea;
var codeGenArea;


var sourceCodeChange = true;

var currentWindowSize = [300, 150];

const RENDER_MODE = SlangCompiler.RENDER_SHADER;
const PRINT_MODE = SlangCompiler.PRINT_SHADER;
const HIDDEN_MODE = SlangCompiler.NON_RUNNABLE_SHADER;

var currentMode = RENDER_MODE;

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

    if (canvas.style.display == "none")
    {
        var parentDiv = document.getElementById("output");
        currentWindowSize = [parentDiv.clientWidth, parentDiv.clientHeight];
        return true;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width || canvas.height !== height)
    {
        // ensure the size won't be 0 nor exceed the limit, otherwise WebGPU will throw an errors
        canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
        canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));

        currentWindowSize = [canvas.width, canvas.height];
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
                computePipeline.createOutput(true, currentWindowSize);
                computePipeline.createBindGroup();
                passThroughPipeline.inputTexture = computePipeline.outputTexture;
                passThroughPipeline.createBindGroup();
                if (canvas.style.display != "none")
                {
                    requestAnimationFrame(render);
                }
            }
        }
    }, 100);
}

function toggleDisplayMode(displayMode)
{
    if (currentMode == displayMode)
        return;

    if (displayMode == RENDER_MODE)
    {
        var printResult = document.getElementById("printResult")
        printResult.style.display = "none";

        canvas.style.display="grid";
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        currentMode = RENDER_MODE;
    }
    else if (displayMode == PRINT_MODE)
    {
        canvas.style.display="none";
        var printResult = document.getElementById("printResult")
        printResult.style.display = "grid";

        currentMode = PRINT_MODE;
    }
    else if (displayMode == HIDDEN_MODE)
    {
        canvas.style.display="none";
        document.getElementById("printResult").style.display = "none";

        currentMode = HIDDEN_MODE;
    }
    else
    {
        console.log("Invalid display mode " + displayMode);
    }
}

async function render(timeMS)
{
    if (currentMode == HIDDEN_MODE)
        return;

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
    pass.dispatchWorkgroups(currentWindowSize[0], currentWindowSize[1]);
    pass.end();

    if (currentMode == RENDER_MODE)
    {
        var renderPassDescriptor = passThroughPipeline.createRenderPassDesc();
        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
        const renderPass = encoder.beginRenderPass(renderPassDescriptor);

        renderPass.setBindGroup(0, passThroughPipeline.bindGroup);
        renderPass.setPipeline(passThroughPipeline.pipeline);
        renderPass.draw(6);  // call our vertex shader 6 times.
        renderPass.end();
    }

    // copy output buffer back in print mode
    if (currentMode == PRINT_MODE)
        encoder.copyBufferToBuffer(computePipeline.outputBuffer, 0, computePipeline.outputBufferRead, 0, computePipeline.outputBuffer.size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    // Only request the next frame if we are in the render mode
    if (currentMode == RENDER_MODE)
        requestAnimationFrame(render);
}

async function printResult(outputBufferRead)
{
    await device.queue.onSubmittedWorkDone();
    // Read the results once the job is done
    await Promise.all([
        outputBufferRead.mapAsync(GPUMapMode.READ),
    ]);

    const output = new Int32Array(outputBufferRead.getMappedRange());

    const textResult = formatResult(output);
    outputBufferRead.unmap();

    console.log(canvas.style.display);

    document.getElementById("printResult").value = textResult;
}

function formatResult(output)
{
    var result = "";
    for (let i = 0; i < output.length; i++)
    {
         result += output[i] + '\n';
    }

    return result;
}


var onRun = () => {
    if (!device)
        return;

    if (!computePipeline)
    {
        computePipeline = new ComputePipeline(device);
        computePipeline.setupComputePipeline(currentWindowSize);
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
    const ret = compileShader("", "WGSL");

    if (!ret)
    {
        toggleDisplayMode(SlangCompiler.PRINT_SHADER);
        return;
    }

    toggleDisplayMode(compiler.shaderType);

    render(0);

    if (compiler.shaderType == SlangCompiler.PRINT_SHADER)
        printResult(computePipeline.outputBufferRead);
}

function compileShader(entryPoint, compileTarget)
{
    // compile the compute shader code from input text area
    var slangSource = monacoEditor.getValue();
    var compiledCode = compiler.compile(slangSource, entryPoint, compileTarget, SlangCompiler.SLANG_STAGE_COMPUTE);

    diagnosticsArea.setValue(compiler.diagnosticsMsg);

    // If compile is failed, we just clear the codeGenArea
    if (!compiledCode)
    {
        codeGenArea.setValue('');
        return false;
    }

    codeGenArea.setValue(compiledCode);
    return true;
}

var onCompile = async () => {

    toggleDisplayMode(HIDDEN_MODE);

    const entryPoint = document.getElementById("entrypoint-select").value;
    if (entryPoint == "")
    {
        diagnosticsArea.setValue("Please select the entry point name");
        return;
    }

    const compileTarget = document.getElementById("target-select").value;

    if (compileTarget == "SPIRV")
        await compiler.initSpirvTools();

    const ret = compileShader(entryPoint, compileTarget);
    if (!ret)
    {
        diagnosticsArea.setValue(compiler.diagnosticsMsg);
        return;
    }
}

function onSourceCodeChange()
{
    sourceCodeChange = true;
}

function loadEditor(readOnlyMode = false, containerId, preloadCode) {

    require(["vs/editor/editor.main"], function () {
      var container = document.getElementById(containerId);
      var editor = monaco.editor.create(container, {
                  value: preloadCode,
                  language: 'csharp',
                  quickSuggestions: false,
                  theme: 'vs-dark',
                  readOnly: readOnlyMode,
                  lineNumbers: readOnlyMode?"off":"on",
                  automaticLayout: true,
                  minimap: {
                    enabled: false
                },
              });
        const leftContainer = document.getElementsByClassName("leftContainer").item(0);
        const rightContainer = document.getElementsByClassName("rightContainer").item(0);
        const resizeObserver = new ResizeObserver(() => {
            const width = leftContainer.contains(container)? leftContainer.clientWidth : rightContainer.clientWidth;
            const height = container.clientHeight;
            editor.layout({ width, height });
        });
        resizeObserver.observe(container);
        resizeObserver.observe(leftContainer);

        if (containerId == "codeEditor")
            monacoEditor = editor;
        else if (containerId == "diagnostics")
        {
            var model = editor.getModel();
            monaco.editor.setModelLanguage(model, "text")
            diagnosticsArea = editor;
        }
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
var moduleLoadingMessage = "";
var Module = {
    onRuntimeInitialized: function() {
        compiler = new SlangCompiler(Module);
        var result = compiler.init();
        if (result.ret)
        {
            document.getElementById("compile-btn").disabled = false;
            moduleLoadingMessage = "Slang compiler initialized successfully.\n";
        }
        else
        {
            console.log(result.msg);
            moduleLoadingMessage = "Failed to initialize Slang Compiler, Run and Compile features are disabled.\n";
        }
    },
};

// event when loading the page
window.onload = function ()
{
    webgpuInit();
    var promise = webgpuInit();
    promise.then(() => {
        if (device)
        {
            document.getElementById("run-btn").disabled = false;
            document.getElementById("run-btn").click();
        }
        else
        {
            diagnosticsArea.setValue(moduleLoadingMessage + "Browser does not support WebGPU, Run shader feature is disabled.");
            document.getElementById("run-btn").title = "Run shader feature is disabled because the current browser does not support WebGPU.";
        }
    });
}
