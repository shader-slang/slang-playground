'use strict';

var compiler = null;
var slangd = null;
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
import playground;

float4 imageMain(uint2 dispatchThreadID, int2 screenSize)
{
    float2 size = float2(screenSize.x, screenSize.y);
    float2 center = size / 2.0;

    float2 pos = float2(dispatchThreadID.xy);

    float stripSize = screenSize.x / 40;

    const float time = getTime(); // from playgournd
    float dist = distance(pos, center) + time;
    float strip = dist / stripSize % 2.0;

    uint color = 0;
    if (strip < 1.0f)
        return float4(1.0f, 0.0f, 0.0f, 1.0f);
    else
        color = 0x00FFFFFF;
        return float4(0.0f, 1.0f, 1.0f, 1.0f);
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

    if (width != currentWindowSize[0] || height != currentWindowSize[1])
    {
        // ensure the size won't be 0 nor exceed the limit, otherwise WebGPU will throw an errors
        canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
        canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));

        currentWindowSize = [canvas.width, canvas.height];
        return true;
    }

    return false;
}

var renderDelayTimer = null;

function startRendering() {
    if (renderDelayTimer)
        clearTimeout(renderDelayTimer);

    renderDelayTimer = setTimeout(() => {
        if (computePipeline && passThroughPipeline &&
            currentWindowSize[0] > 1 && currentWindowSize[1] > 1) {
            computePipeline.createOutput(true, currentWindowSize);
            computePipeline.createBindGroup();
            passThroughPipeline.inputTexture = computePipeline.outputTexture;
            passThroughPipeline.createBindGroup();
            if (canvas.style.display != "none") {
                requestAnimationFrame(render);
            }
        }
    }, 100);
}

// We use the timer in the resize handler debounce the resize event, otherwise we could end of rendering
// multiple useless frames.
function resizeCanvasHandler(entries)
{
    var needResize = resizeCanvas(entries);
    if (needResize) {
        startRendering();
    }
}

function toggleDisplayMode(displayMode)
{
    if (currentMode == displayMode)
        return;
    if (currentMode == HIDDEN_MODE && displayMode != HIDDEN_MODE)
    {
        document.getElementById("resultSplitContainer").style.gridTemplateRows="50% 14px 1fr";
    }
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
        document.getElementById("resultSplitContainer").style.gridTemplateRows="0px 14px 1fr";
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
    if (currentWindowSize[0] < 2 || currentWindowSize[1] < 2)
        return;

    computePipeline.updateUniformBuffer(timeMS * 0.01);
    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setBindGroup(0, computePipeline.bindGroup);
    pass.setPipeline(computePipeline.pipeline);
    const workGroupSizeX = (currentWindowSize[0] + 15) / 16;
    const workGroupSizeY = (currentWindowSize[1] + 15) / 16;
    pass.dispatchWorkgroups(workGroupSizeX, workGroupSizeY);
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

async function printResult()
{
    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setBindGroup(0, computePipeline.bindGroup);
    pass.setPipeline(computePipeline.pipeline);
    pass.dispatchWorkgroups(1, 1);
    pass.end();

    // copy output buffer back in print mode
    encoder.copyBufferToBuffer(computePipeline.outputBuffer, 0, computePipeline.outputBufferRead, 0, computePipeline.outputBuffer.size);
    encoder.copyBufferToBuffer(computePipeline.printfBuffer, 0, computePipeline.printfBufferRead, 0, computePipeline.printfBuffer.size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    await device.queue.onSubmittedWorkDone();

    // Read the results once the job is done
    await computePipeline.printfBufferRead.mapAsync(GPUMapMode.READ);

    var textResult = "";
    const formatPrint = computePipeline.parsePrintfBuffer(compiler.hashedString);
    if (formatPrint != "")
        textResult += "Formatted Printf:\n" + formatPrint + "\n";

    computePipeline.printfBufferRead.unmap();
    document.getElementById("printResult").value = textResult;
}

function checkShaderType(userSource)
{
    // we did a pre-filter on the user input source code.
    const isImageMain = userSource.match("imageMain");
    const isPrintMain = userSource.match("printMain");

    // Only one of the main function should be defined.
    // In this case, we will know that the shader is not runnable, so we can only compile it.
    if (isImageMain == isPrintMain)
        return SlangCompiler.NON_RUNNABLE_SHADER;

    if (isImageMain)
        return SlangCompiler.RENDER_SHADER;
    else
        return SlangCompiler.PRINT_SHADER;
}

var onRun = () => {
    if (!device)
        return;
    if (!monacoEditor)
        return;
    if (!compiler)
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

    // We will have some restrictions on runnable shader, the user code has to define imageMain or printMain function.
    // We will do a pre-filter on the user input source code, if it's not runnable, we will not run it.
    const userSource = monacoEditor.getValue();
    const shaderType = checkShaderType(userSource);
    if (shaderType == SlangCompiler.NON_RUNNABLE_SHADER)
    {
        diagnosticsArea.setValue("Error: In order to run the shader, please define either imageMain or printMain function in the shader code.");
        // clear content in render area and code-gen area
        toggleDisplayMode(HIDDEN_MODE);
        codeGenArea.setValue("");
        return;
    }

    const entryPointName = shaderType == SlangCompiler.RENDER_SHADER? "imageMain" : "printMain";
    const ret = compileShader(userSource, entryPointName, "WGSL");

    // Recompile the pipeline.
    if (ret.succ)
    {
        const module = device.createShaderModule({code:ret.code});
        computePipeline.createPipeline(module);
    }

    toggleDisplayMode(compiler.shaderType);
    if (compiler.shaderType == SlangCompiler.PRINT_SHADER)
    {
        printResult();
    }
    else if (compiler.shaderType == SlangCompiler.RENDER_SHADER)
    {
        startRendering();
    }
}

function compileShader(userSource, entryPoint, compileTarget)
{
    var compiledCode = compiler.compile(userSource, entryPoint, compileTarget, SlangCompiler.SLANG_STAGE_COMPUTE);
    diagnosticsArea.setValue(compiler.diagnosticsMsg);

    // If compile is failed, we just clear the codeGenArea
    if (!compiledCode)
    {
        codeGenArea.setValue('Compilation returned empty result.');
        return {succ: false, code: compiledCode};
    }

    codeGenArea.setValue(compiledCode);
    if (compileTarget == "WGSL")
        codeGenArea.getModel().setLanguage("wgsl");
    else if (compileTarget == "SPIRV")
        codeGenArea.getModel().setLanguage("spirv");
    else
        codeGenArea.getModel().setLanguage("generic-shader");
    return {succ: true, code: compiledCode};
}

// For the compile button action, we don't have restriction on user code that it has to define imageMain or printMain function.
// But if it doesn't define any of them, then user code has to define a entry point function name. Because our built-in shader
// have no way to call the user defined function, and compile engine cannot compile the source code.
var onCompile = async () => {

    toggleDisplayMode(HIDDEN_MODE);
    const compileTarget = document.getElementById("target-select").value;

    const entryPoint = document.getElementById("entrypoint-select").value;
    if (entryPoint == "" && !isWholeProgramTarget(compileTarget))
    {
        diagnosticsArea.setValue("Please select the entry point name");
        return;
    }

    if (compileTarget == "SPIRV")
        await compiler.initSpirvTools();

    // compile the compute shader code from input text area
    const userSource = monacoEditor.getValue();
    compileShader(userSource, entryPoint, compileTarget);

    if (compiler.diagnosticsMsg.length > 0)
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
      initMonaco();
      var model = readOnlyMode
        ? monaco.editor.createModel(preloadCode)
        : monaco.editor.createModel("", "slang", monaco.Uri.parse(userCodeURI));
      var editor = monaco.editor.create(container, {
                  model: model,
                  language: readOnlyMode?'csharp':'slang',
                  theme: 'slang-dark',
                  readOnly: readOnlyMode,
                  lineNumbers: readOnlyMode?"off":"on",
                  automaticLayout: true,
                  "semanticHighlighting.enabled": true,
                  renderValidationDecorations: "on",
                  minimap: {
                    enabled: false
                },
              });
        if (!readOnlyMode)
        {
            model.onDidChangeContent(codeEditorChangeContent);
            model.setValue(preloadCode);
        }

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

// Define the Module object with a callback for initialization
var Module = {
    onRuntimeInitialized: function () {
        var label = document.getElementById("loadingStatusLabel");
        if (label)
            label.innerText = "Initializing Slang Compiler...";
        compiler = new SlangCompiler(Module);
        slangd = Module.createLanguageServer();
        var result = compiler.init();
        if (result.ret) {
            document.getElementById("compile-btn").disabled = false;
            moduleLoadingMessage = "Slang compiler initialized successfully.\n";
            runIfFullyInitialized();
        }
        else {
            console.log(result.msg);
            moduleLoadingMessage = "Failed to initialize Slang Compiler, Run and Compile features are disabled.\n";
        }
    }
};

function loadSlangWasm() {
    var label = document.getElementById("loadingStatusLabel");
    if (label)
        label.innerText = "Loading Slang Compiler...";
    const script = document.createElement("script");
    script.src = "slang-wasm.js";
    document.head.appendChild(script);
}

var pageLoaded = false;
// event when loading the page
window.onload = async function ()
{
    loadSlangWasm();
    pageLoaded = true;

    await webgpuInit();
    if (device)
    {
        document.getElementById("run-btn").disabled = false;
    }
    else
    {
        diagnosticsArea.setValue(moduleLoadingMessage + "Browser does not support WebGPU, Run shader feature is disabled.");
        document.getElementById("run-btn").title = "Run shader feature is disabled because the current browser does not support WebGPU.";
    }
    runIfFullyInitialized();
}

function runIfFullyInitialized()
{
    if (compiler && slangd && pageLoaded)
    {
        initLanguageServer();

        const loadingScreen = document.getElementById('loading-screen');
        // Start fade-out by setting opacity to 0
        loadingScreen.style.opacity = '0';
        // Wait for the transition to finish before hiding completely
        loadingScreen.addEventListener('transitionend', () => {
            loadingScreen.style.display = 'none';
        });
        document.getElementById('contentDiv').style="";

        restoreSelectedTargetFromURL();

        if (device)
        {
            onRun();
        }
    }
}
