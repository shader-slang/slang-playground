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

var resourceBindings;
var resourceCommands;
var allocatedResources;
var hashedStrings;

var printfBufferElementSize = 12;
var printfBufferSize = this.printfBufferElementSize * 2048; // 12 bytes per printf struct

var sourceCodeChange = true;

var currentWindowSize = [300, 150];

const RENDER_MODE = SlangCompiler.RENDER_SHADER;
const PRINT_MODE = SlangCompiler.PRINT_SHADER;
const HIDDEN_MODE = SlangCompiler.NON_RUNNABLE_SHADER;
const defaultShaderURL = "circle.slang";

var currentMode = RENDER_MODE;

var randFloatPipeline;
var randFloatResources;

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
            //computePipeline.createOutput(true, currentWindowSize);
            //computePipeline.createBindGroup();

            processResourceCommands(computePipeline, resourceBindings, resourceCommands).then((allocatedResources) => {
                computePipeline.createBindGroup(allocatedResources);
                globalThis.allocatedResources = allocatedResources;
    
                passThroughPipeline.inputTexture = allocatedResources.get("outputTexture");
                passThroughPipeline.createBindGroup();

                if (canvas.style.display != "none") 
                {
                    requestAnimationFrame(render);
                }
            }).catch((error) => {
                diagnosticsArea.setValue(error.message);
            });
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

    var timeArray = new Float32Array(4);
    timeArray[0] = timeMS * 0.001;
    computePipeline.device.queue.writeBuffer(allocatedResources.get("time"), 0, timeArray);

    // computePipeline.updateUniformBuffer(timeMS * 0.01);
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
        encoder.copyBufferToBuffer(
            allocatedResources.get("outputBuffer"),
            0,
            allocatedResources.get("outputBufferRead"),
            0,
            allocatedResources.get("outputBuffer").size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    // Only request the next frame if we are in the render mode
    if (currentMode == RENDER_MODE)
        requestAnimationFrame(render);
}



// This is the definition of the printf buffer.
// struct FormatedStruct
// {
//     uint32_t type = 0xFFFFFFFF;
//     uint32_t low = 0;
//     uint32_t high = 0;
// };
//
function parsePrintfBuffer()
{
    const hashedString = globalThis.hashedStrings;
    const printfValueResource = globalThis.allocatedResources.get("printfBufferRead");

    // Read the printf buffer
    const printfBufferArray = new Uint32Array(printfValueResource.getMappedRange())

    var elementIndex = 0;
    var numberElements = printfBufferArray.byteLength / globalThis.printfBufferElementSize;

    // TODO: We currently doesn't support 64-bit data type (e.g. uint64_t, int64_t, double, etc.)
    // so 32-bit array should be able to contain everything we need.
    var dataArray = [];
    const elementSizeInWords = globalThis.printfBufferElementSize / 4;
    var outStrArry = [];
    var formatString = "";
    for (elementIndex = 0; elementIndex < numberElements; elementIndex++)
    {
        var offset = elementIndex * elementSizeInWords;
        const type = printfBufferArray[offset];
        switch (type)
        {
            case 1: // format string
                formatString = hashedString.getString(printfBufferArray[offset + 1]);    // low field
                break;
            case 2: // normal string
                dataArray.push(hashedString.getString(printfBufferArray[offset + 1]));  // low field
                break;
            case 3: // integer
                dataArray.push(printfBufferArray[offset + 1]);  // low field
                break;
            case 4: // float
                const floatData = reinterpretUint32AsFloat(printfBufferArray[offset + 1]);
                dataArray.push(floatData);                      // low field
                break;
            case 5: // TODO: We can't handle 64-bit data type yet.
                dataArray.push(0);                              // low field
                break;
            case 0xFFFFFFFF:
            {
                const parsedTokens = parsePrintfFormat(formatString);
                const output = formatPrintfString(parsedTokens, dataArray);
                outStrArry.push(output);
                formatString = "";
                dataArray = [];
                if (elementIndex < numberElements - 1)
                {
                    const nextOffset = offset + elementSizeInWords;
                    // advance to the next element to see if it's a format string, if it's not we just early return
                    // the results, otherwise just continue processing.
                    if (printfBufferArray[nextOffset] != 1)          // type field
                    {
                        return outStrArry;
                    }
                }
                break;
            }
        }
    }

    if (formatString != "")
    {
        // If we are here, it means that the printf buffer is used up, and we are in the middle of processing
        // one printf string, so we are still going to format it, even though there could be some data missing, which
        // will be shown as 'undef'.
        const parsedTokens = parsePrintfFormat(formatString);
        const output = formatPrintfString(parsedTokens, dataArray);
        outStrArry.push(output);
        outStrArry.push("Print buffer is out of boundary, some data is missing!!!");
    }

    return outStrArry;
}

async function printResult()
{
    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
    encoder.clearBuffer(allocatedResources.get("printfBufferRead"));

    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setBindGroup(0, computePipeline.bindGroup);
    pass.setPipeline(computePipeline.pipeline);
    pass.dispatchWorkgroups(1, 1);
    pass.end();

    // copy output buffer back in print mode
    encoder.copyBufferToBuffer(
        allocatedResources.get("outputBuffer"), 0, allocatedResources.get("outputBufferRead"), 0, allocatedResources.get("outputBuffer").size);
    encoder.copyBufferToBuffer(
        allocatedResources.get("g_printedBuffer"), 0, allocatedResources.get("printfBufferRead"), 0, allocatedResources.get("g_printedBuffer").size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    await device.queue.onSubmittedWorkDone();

    // Read the results once the job is done
    await allocatedResources.get("printfBufferRead").mapAsync(GPUMapMode.READ);

    var textResult = "";
    const formatPrint = parsePrintfBuffer();
    if (formatPrint.length != 0)
        textResult += "Shader Output:\n" + formatPrint.join("") + "\n";

    allocatedResources.get("printfBufferRead").unmap();
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

async function processResourceCommands(pipeline, resourceBindings, resourceCommands) 
{
    var allocatedResources = new Map();
    const safeSet = (map, key, value) => { if (map.has(key)) { map.get(key).destroy(); } map.set(key, value); };

    for (const { resourceName, parsedCommand } of resourceCommands)
    {
        if (parsedCommand.type === "ZEROS")
        {
            const size = command.size.reduce((a, b) => a * b);
            const elementSize = 4; // Assuming 4 bytes per element (e.g., float) TODO: infer from type.
            const bindingInfo = resourceBindings.get(resourceName);
            if (!bindingInfo)
            {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (!bindingInfo.buffer)
            {
                throw new Error(`Resource ${resourceName} is not defined as a buffer.`);
            }

            const buffer = pipeline.device.createBuffer({
                size: size * elementSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            safeSet(allocatedResources, resourceName, buffer);

            // Initialize the buffer with zeros.
            const zeros = new Float32Array(size);
            pipeline.device.queue.writeBuffer(buffer, 0, zeros);
        }
        else if (parsedCommand.type === "URL")
        {   
            // Load image from URL and wait for it to be ready.
            const bindingInfo = resourceBindings.get(resourceName);
            
            if (!bindingInfo)
            {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (!bindingInfo.texture)
            {
                throw new Error(`Resource ${resourceName} is not a texture.`);
            }
            
            const image = new Image();
            try
            {
                // TODO: Pop-up a warning if the image is not CORS-enabled.
                // TODO: Pop-up a warning for the user to confirm that its okay to load a cross-origin image (i.e. do you trust this code..)
                //
                image.crossOrigin = "anonymous"; 

                image.src = parsedCommand.url;
                await image.decode();
            }
            catch (error)
            {
                throw new Error(`Failed to load & decode image from URL: ${parsedCommand.url}`);
            }

            try 
            {
                const imageBitmap = await createImageBitmap(image);
                const texture = pipeline.device.createTexture({
                    size: [imageBitmap.width, imageBitmap.height],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                });
                pipeline.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: texture }, [imageBitmap.width, imageBitmap.height]);
                safeSet(allocatedResources, resourceName, texture);
            }
            catch (error)
            {
                throw new Error(`Failed to create texture from image: ${error}`);
            }
        }
        else if (parsedCommand.type === "RAND")
        {
            const size = parsedCommand.size.reduce((a, b) => a * b);
            const elementSize = 4; // Assuming 4 bytes per element (e.g., float) TODO: infer from type.
            const bindingInfo = resourceBindings.get(resourceName);
            if (!bindingInfo)
            {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (!bindingInfo.buffer)
            {
                throw new Error(`Resource ${resourceName} is not defined as a buffer.`);
            }

            const buffer = pipeline.device.createBuffer({
                size: size * elementSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            safeSet(allocatedResources, resourceName, buffer);

            // Place a call to a shader that fills the buffer with random numbers.
            if (!globalThis.randFloatPipeline)
            {
                var randomPipeline = new ComputePipeline(pipeline.device);

                // Load randFloat shader code from the file.
                const randFloatShaderCode = await (await fetch('rand_float.slang')).text();
                const compiledResult = compiler.compile(randFloatShaderCode, "randFloatMain", "WGSL", SlangCompiler.SLANG_STAGE_COMPUTE, false);
                if (!compiledResult)
                {
                    throw new Error("[Internal] Failed to compile randFloat shader");
                }
                
                let [code, layout, hashedStrings] = compiledResult;
                const module = pipeline.device.createShaderModule({code:code});
                
                randomPipeline.createPipelineLayout(layout);

                // Create the pipeline (without resource bindings for now)
                randomPipeline.createPipeline(module, null);

                globalThis.randFloatPipeline = randomPipeline;
            }
            
            // Dispatch a random number generation shader.
            {
                var randomPipeline = globalThis.randFloatPipeline;

                // Alloc resources for the shader.
                if (!globalThis.randFloatResources)
                    globalThis.randFloatResources = new Map();
                
                globalThis.randFloatResources.set("outputBuffer", buffer);

                if (!globalThis.randFloatResources.has("seed"))
                    globalThis.randFloatResources.set("seed", 
                        pipeline.device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}));
                
                const seedBuffer = globalThis.randFloatResources.get("seed");

                // Set bindings on the pipeline.
                globalThis.randFloatPipeline.createBindGroup(globalThis.randFloatResources);

                const seedValue = new Float32Array([Math.random(), 0, 0, 0]);
                pipeline.device.queue.writeBuffer(seedBuffer, 0, seedValue);

                // Encode commands to do the computation
                var encoder = pipeline.device.createCommandEncoder({ label: 'compute builtin encoder' });
                var pass = encoder.beginComputePass({ label: 'compute builtin pass' });
                
                pass.setBindGroup(0, randomPipeline.bindGroup);
                pass.setPipeline(randomPipeline.pipeline);

                const workGroupSizeX = Math.floor((size + 63) / 64);
                pass.dispatchWorkgroups(workGroupSizeX, 1);
                pass.end();

                // Finish encoding and submit the commands
                var commandBuffer = encoder.finish();
                pipeline.device.queue.submit([commandBuffer]);
            }
        }
    }

    //
    // Some special-case allocations
    //

    safeSet(allocatedResources, "outputTexture", createOutputTexture(device, currentWindowSize[0], currentWindowSize[1], 'rgba8unorm'));
    
    safeSet(allocatedResources, "outputBuffer", pipeline.device.createBuffer({
        size: 2 * 2 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }));

    safeSet(allocatedResources, "outputBufferRead", pipeline.device.createBuffer({
        size: 2 * 2 * 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }));

    safeSet(allocatedResources, "g_printedBuffer", pipeline.device.createBuffer({
        size: printfBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }));

    safeSet(allocatedResources, "printfBufferRead", pipeline.device.createBuffer({
        size: printfBufferSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }));

    var length = new Float32Array(4).byteLength;
    safeSet(allocatedResources, "time", pipeline.device.createBuffer({size: length, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}));

    return allocatedResources;
}

function freeAllocatedResources(resources)
{
    for (const resource of resources.values())
    {
        resource.destroy();
    }
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

    if (!ret.succ)
    {
        toggleDisplayMode(HIDDEN_MODE);
        return;
    }

    globalThis.hashedStrings = ret.hashedStrings;

    try {
        resourceCommands = parseResourceCommands(userSource); 
    } catch (error) {
        diagnosticsArea.setValue(error.message);
        return;
    }

    resourceBindings = ret.layout;
    // create a pipeline resource 'signature' based on the bindings found in the program.
    computePipeline.createPipelineLayout(resourceBindings); 

    processResourceCommands(computePipeline, resourceBindings, resourceCommands).then((allocatedResources) => {
        globalThis.allocatedResources = allocatedResources;

        if (!passThroughPipeline)
        {
            passThroughPipeline = new GraphicsPipeline(device);
            const shaderModule = device.createShaderModule({code: passThroughshaderCode});
            const inputTexture = allocatedResources.get("outputTexture");
            passThroughPipeline.createPipeline(shaderModule, inputTexture);
        }

        if (ret.succ)
        {
            const module = device.createShaderModule({code:ret.code});
            computePipeline.createPipeline(module, allocatedResources);
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

    }).catch((error) => {
        diagnosticsArea.setValue(error.message);
    });
}

function compileOrRun()
{
    const userSource = monacoEditor.getValue();
    const shaderType = checkShaderType(userSource);
    if (shaderType == SlangCompiler.NON_RUNNABLE_SHADER)
    {
        onCompile();
    }
    else
    {
        onRun();
    }
}

function compileShader(userSource, entryPoint, compileTarget, includePlaygroundModule = true)
{
    const compiledResult = compiler.compile(userSource, entryPoint, compileTarget, SlangCompiler.SLANG_STAGE_COMPUTE, includePlaygroundModule);
    diagnosticsArea.setValue(compiler.diagnosticsMsg);

    // If compile is failed, we just clear the codeGenArea
    if (!compiledResult)
    {
        codeGenArea.setValue('Compilation returned empty result.');
        return {succ: false};
    }

    let [compiledCode, layout, hashedStrings] = compiledResult;

    codeGenArea.setValue(compiledCode);
    if (compileTarget == "WGSL")
        codeGenArea.getModel().setLanguage("wgsl");
    else if (compileTarget == "SPIRV")
        codeGenArea.getModel().setLanguage("spirv");
    else
        codeGenArea.getModel().setLanguage("generic-shader");
    return {succ: true, code: compiledCode, layout: layout, hashedStrings: hashedStrings};
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
            if (monacoEditor.getValue() == "")
            {
                loadDemo(defaultShaderURL);
            }
            else
            {
                compileOrRun();
            }
        }
    }
}