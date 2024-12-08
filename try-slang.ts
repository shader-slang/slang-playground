/// <reference path="node_modules/monaco-editor/monaco.d.ts" />
import { ComputePipeline } from './compute.js';
import { GraphicsPipeline, passThroughshaderCode } from './pass_through.js';
import { SlangCompiler, Bindings, isWholeProgramTarget } from './compiler.js';
import { initMonaco, userCodeURI, codeEditorChangeContent, initLanguageServer } from './language-server.js';
import { restoreSelectedTargetFromURL, restoreDemoSelectionFromURL, loadDemo, canvasCurrentMousePos, canvasLastMouseDownPos, canvasIsMouseDown, canvasMouseClicked, resetMouse } from './ui.js';
import { fetchWithProgress, configContext, parseResourceCommands, parseCallCommands, createOutputTexture, parsePrintfBuffer, CallCommand } from './util.js';
import type { LanguageServer, MainModule, ThreadGroupSize } from "./slang-wasm.js";

// ignore complaint about missing types - added via tsconfig
// @ts-ignore
import * as pako from './node_modules/pako/dist/pako.esm.mjs';
globalThis.pako = pako;

import type { PublicApi as JJsonPublicApi } from "./node_modules/jjsontree.js/src/ts/api.js"
declare global {
    let $jsontree: JJsonPublicApi
}

declare let RequireJS: {
    require: typeof require
};

export var compiler: SlangCompiler | null = null;
export var slangd: LanguageServer | null = null;
var device: GPUDevice;
var context: GPUCanvasContext;
var randFloatPipeline: ComputePipeline;
var computePipeline: ComputePipeline;
var extraComputePipelines: ComputePipeline[] = [];
var passThroughPipeline: GraphicsPipeline;

export var monacoEditor: monaco.editor.IStandaloneCodeEditor;
var diagnosticsArea: monaco.editor.IStandaloneCodeEditor;
var codeGenArea: monaco.editor.IStandaloneCodeEditor;

var resourceBindings: Bindings;
var resourceCommands: { resourceName: string; parsedCommand: ParsedCommand; }[];
var callCommands: CallCommand[];
var allocatedResources: Map<string, GPUTexture | GPUBuffer>;
var hashedStrings: any;

var renderThread: Promise<void> | null = null;
var abortRender = false;
var onRenderAborted: (() => void) | null = null;

const printfBufferElementSize = 12;
const printfBufferSize = printfBufferElementSize * 2048; // 12 bytes per printf struct

var sourceCodeChange = true;

var currentWindowSize = [300, 150];

const RENDER_MODE = SlangCompiler.RENDER_SHADER;
const PRINT_MODE = SlangCompiler.PRINT_SHADER;
const HIDDEN_MODE = SlangCompiler.NON_RUNNABLE_SHADER;
const defaultShaderURL = "circle.slang";

var currentMode = RENDER_MODE;

var randFloatPipeline: ComputePipeline;
var randFloatResources: Map<string, GPUObjectBase>;

async function webgpuInit() {
    try {
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) {
            console.log('need a browser that supports WebGPU');
            return;
        }
        const requiredFeatures: never[] = [];

        device = await adapter?.requestDevice({ requiredFeatures });
        if (!device) {
            console.log('need a browser that supports WebGPU');
            return;
        }
        context = configContext(device, canvas);
    }
    catch {
    }
    // The default resolution of a canvas element is 300x150, which is too small compared to the container size of the canvas,
    // therefore, we have to set the resolution same as the container size.

    const observer = new ResizeObserver((entries) => { resizeCanvasHandler(entries); });
    observer.observe(canvas);
}

function resizeCanvas(entries: ResizeObserverEntry[]) {
    if (device == null)
        return;

    const canvas = entries[0].target;

    if(!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("canvas object is not a canvas element")
    }

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    if (canvas.style.display == "none") {
        var parentDiv = document.getElementById("output");
        width = parentDiv?.clientWidth || width;
        height = parentDiv?.clientHeight || height;
    }

    if (width != currentWindowSize[0] || height != currentWindowSize[1]) {
        // ensure the size won't be 0 nor exceed the limit, otherwise WebGPU will throw an errors
        canvas.width = Math.max(2, Math.min(width, device.limits.maxTextureDimension2D));
        canvas.height = Math.max(2, Math.min(height, device.limits.maxTextureDimension2D));

        currentWindowSize = [canvas.width, canvas.height];
        return true;
    }

    return false;
}

function abortRendererIfActive(): Promise<void> {
    return new Promise((resolve) => {
        if (renderThread) {
            abortRender = true;
            onRenderAborted = resolve;
        }
        else {
            resolve();
        }
    });
}

function withRenderLock(setupFn: { (): Promise<void>; }, renderFn: { (timeMS: number): Promise<boolean>; }) {
    // Overwrite the onRenderAborted function to the new one.
    // This also makes sure that a single function is called when the render thread is aborted.
    //
    onRenderAborted = () => {
        // On callback, reset the onRenderAborted function to null to clear it for any future
        // resets.
        //
        onRenderAborted = null;

        // Clear state for the new render thread.
        abortRender = false;

        // New render loop with the provided function.
        renderThread = new Promise((resolve) => {
            let releaseRenderLock = resolve;

            // Set up render loop function
            const newRenderLoop = async (timeMS: number) => {
                var nextFrame = false;
                try {
                    const keepRendering = await renderFn(timeMS);
                    nextFrame = keepRendering && !abortRender;
                    if (nextFrame)
                        requestAnimationFrame(newRenderLoop);
                } catch (error: any) {
                    if (error instanceof Error)
                        diagnosticsArea.setValue(`Error when rendering: ${error.message} in ${error.stack}`);
                    else
                        diagnosticsArea.setValue(`Error when rendering: ${error}`);
                }
                finally {
                    if (!nextFrame)
                        releaseRenderLock();
                }
            }

            // Setup renderer and start the render loop.
            setupFn().then(() => {
                requestAnimationFrame(newRenderLoop);
            }).catch((error: Error) => {
                diagnosticsArea.setValue(error.message);
                releaseRenderLock();
            });
        });

        // Queue any follow-up actions upon abort.
        renderThread.then(() => {
            renderThread = null; // Clear the render thread.
            if (onRenderAborted)
                onRenderAborted();
        })
    };

    // Is there any renderer active?
    if (!renderThread) {
        // Nothing to wait for. Call immediately.
        onRenderAborted();
    }
    else {
        // Otherwise, signal the render thread to abort.
        abortRender = true;
    }
}

function startRendering() {
    // This is a lighter-weight setup function that doesn't need to re-compile the shader code.
    const setupRenderer = async () => {
        if (!computePipeline || !passThroughPipeline)
            throw new Error("pipeline not ready");

        if (!currentWindowSize || currentWindowSize[0] < 2 || currentWindowSize[1] < 2)
            throw new Error("window not ready");

        allocatedResources = await processResourceCommands(computePipeline, resourceBindings, resourceCommands);

        computePipeline.createBindGroup(allocatedResources);

        passThroughPipeline.inputTexture = (allocatedResources.get("outputTexture") as GPUTexture);
        passThroughPipeline.createBindGroup();

        for (const pipeline of extraComputePipelines)
            pipeline.createBindGroup(allocatedResources);
    };

    withRenderLock(setupRenderer, execFrame);
}

// We use the timer in the resize handler debounce the resize event, otherwise we could end of rendering
// multiple useless frames.
function resizeCanvasHandler(entries: ResizeObserverEntry[]) {
    var needResize = resizeCanvas(entries);
    if (needResize) {
        startRendering();
    }
}

function toggleDisplayMode(displayMode: number) {
    if (currentMode == displayMode)
        return;
    let resultSplitContainer = document.getElementById("resultSplitContainer")
    if (resultSplitContainer == null) {
        throw new Error("Cannot get resultSplitContatiner element")
    }
    let printResult = document.getElementById("printResult")
    if (printResult == null) {
        throw new Error("Cannot get printResult element")
    }
    if (currentMode == HIDDEN_MODE && displayMode != HIDDEN_MODE) {
        resultSplitContainer.style.gridTemplateRows = "50% 14px 1fr";
    }
    if (displayMode == RENDER_MODE) {
        printResult.style.display = "none";
        renderOutput.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        currentMode = RENDER_MODE;
    }
    else if (displayMode == PRINT_MODE) {
        renderOutput.style.display = "none";
        printResult.style.display = "grid";

        currentMode = PRINT_MODE;
    }
    else if (displayMode == HIDDEN_MODE) {
        renderOutput.style.display = "none";
        printResult.style.display = "none";
        resultSplitContainer.style.gridTemplateRows = "0px 14px 1fr";
        currentMode = HIDDEN_MODE;
    }
    else {
        console.log("Invalid display mode " + displayMode);
    }
}

var timeAggregate = 0;
var frameCount = 0;

async function execFrame(timeMS: number) {
    if (currentMode == HIDDEN_MODE)
        return false;
    if (currentWindowSize[0] < 2 || currentWindowSize[1] < 2)
        return false;

    const startTime = performance.now();

    var timeArray = new Float32Array(8);
    timeArray[0] = canvasCurrentMousePos.x;
    timeArray[1] = canvasCurrentMousePos.y;
    timeArray[2] = canvasLastMouseDownPos.x;
    timeArray[3] = canvasLastMouseDownPos.y;
    if (canvasIsMouseDown)
        timeArray[2] = -timeArray[2];
    if (canvasMouseClicked)
        timeArray[3] = -timeArray[3];
    timeArray[4] = timeMS * 0.001;
    let uniformInput = allocatedResources.get("uniformInput");
    if(!(uniformInput instanceof GPUBuffer)) {
        throw new Error("uniformInput doesn't exist or is of incorrect type")
    }
    computePipeline.device.queue.writeBuffer(uniformInput, 0, timeArray);

    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });

    // The extra passes always go first.
    // zip the extraComputePipelines and callCommands together
    for (const [pipeline, command] of callCommands.map((x: CallCommand, i: number) => [extraComputePipelines[i], x] as const)) {
        const pass = encoder.beginComputePass({ label: 'extra passes' });
        pass.setBindGroup(0, pipeline.bindGroup || null);
        if(pipeline.pipeline == undefined) {
            throw new Error("pipeline is undefined")
        }
        pass.setPipeline(pipeline.pipeline);
        // Determine the workgroup size based on the size of the buffer or texture.
        if (command.type == "RESOURCE_BASED") {
            if (!allocatedResources.has(command.resourceName)) {
                diagnosticsArea.setValue("Error when dispatching " + command.fnName + ". Resource not found: " + command.resourceName);
                pass.end();
                return false;
            }

            if(pipeline.threadGroupSize == undefined) {
                throw new Error("threadGroupSize is undefined")
            }

            let resource = allocatedResources.get(command.resourceName)
            if (resource instanceof GPUBuffer) {
                let size = resource.size / 4;
                const blockSizeX = pipeline.threadGroupSize.x;
                const blockSizeY = pipeline.threadGroupSize.y;

                const workGroupSizeX = Math.floor((size + blockSizeX - 1) / blockSizeX);
                const workGroupSizeY = Math.floor((1 + blockSizeY - 1) / blockSizeY);

                pass.dispatchWorkgroups(workGroupSizeX, workGroupSizeY);
            }
            else if (resource instanceof GPUTexture) {
                let size = [0, 0];
                size[0] = resource.width;
                size[1] = resource.height;
                const blockSizeX = pipeline.threadGroupSize.x;
                const blockSizeY = pipeline.threadGroupSize.y;

                const workGroupSizeX = Math.floor((size[0] + blockSizeX - 1) / blockSizeX);
                const workGroupSizeY = Math.floor((size[1] + blockSizeY - 1) / blockSizeY);

                pass.dispatchWorkgroups(workGroupSizeX, workGroupSizeY);
            }
            else {
                pass.end();
                diagnosticsArea.setValue("Error when dispatching " + command.fnName + ". Resource type not supported for dispatch: " + resource);
                return false;
            }
        }

        pass.end();
    }

    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setBindGroup(0, computePipeline.bindGroup || null);
    if (computePipeline.pipeline == undefined)
        throw new Error("Compute pipeline is not defined.");
    pass.setPipeline(computePipeline.pipeline);
    const workGroupSizeX = (currentWindowSize[0] + 15) / 16;
    const workGroupSizeY = (currentWindowSize[1] + 15) / 16;
    pass.dispatchWorkgroups(workGroupSizeX, workGroupSizeY);
    pass.end();

    if (currentMode == RENDER_MODE) {
        var renderPassDescriptor = passThroughPipeline.createRenderPassDesc(context.getCurrentTexture().createView());
        const renderPass = encoder.beginRenderPass(renderPassDescriptor);

        renderPass.setBindGroup(0, passThroughPipeline.bindGroup || null);
        if (passThroughPipeline.pipeline == undefined) {
            throw new Error("Pass through pipeline is undefined!")
        }
        renderPass.setPipeline(passThroughPipeline.pipeline);
        renderPass.draw(6);  // call our vertex shader 6 times.
        renderPass.end();
    }

    // copy output buffer back in print mode
    if (currentMode == PRINT_MODE) {
        let outputBuffer = allocatedResources.get("outputBuffer");
        if(!(outputBuffer instanceof GPUBuffer)) {
            throw new Error("outputBuffer is incorrect type or doesn't exist")
        }
        let outputBufferRead = allocatedResources.get("outputBufferRead");
        if(!(outputBufferRead instanceof GPUBuffer)) {
            throw new Error("outputBufferRead is incorrect type or doesn't exist")
        }
        encoder.copyBufferToBuffer(
            outputBuffer,
            0,
            outputBufferRead,
            0,
            outputBuffer.size);
    }

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    await device.queue.onSubmittedWorkDone();

    const timeElapsed = performance.now() - startTime;

    // Update performance info.
    timeAggregate += timeElapsed;
    frameCount++;
    if (frameCount == 20) {
        var avgTime = (timeAggregate / frameCount);
        let performanceInfo = document.getElementById("performanceInfo");
        if (!(performanceInfo instanceof HTMLDivElement)) {
            throw new Error("performanceInfo has an invalid type")
        }
        performanceInfo.innerText = avgTime.toFixed(1) + " ms ";
        timeAggregate = 0;
        frameCount = 0;
    }

    // Only request the next frame if we are in the render mode
    if (currentMode == RENDER_MODE)
        return true;
    else
        return false;
}

async function printResult() {
    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
    let printfBufferRead = allocatedResources.get("printfBufferRead");
    if(!(printfBufferRead instanceof GPUBuffer)) {
        throw new Error("printfBufferRead is not a buffer")
    }
    encoder.clearBuffer(printfBufferRead);

    const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

    pass.setBindGroup(0, computePipeline.bindGroup || null);
    if (computePipeline.pipeline == undefined) {
        throw new Error("Compute pipeline is undefined")
    }
    pass.setPipeline(computePipeline.pipeline);
    pass.dispatchWorkgroups(1, 1);
    pass.end();

    // copy output buffer back in print mode
    let outputBuffer = allocatedResources.get("outputBuffer")
    if(!(outputBuffer instanceof GPUBuffer)) {
        throw new Error("outputBuffer is not a buffer")
    }
    let outputBufferRead = allocatedResources.get("outputBufferRead")
    if(!(outputBufferRead instanceof GPUBuffer)) {
        throw new Error("outputBufferRead is not a buffer")
    }
    let g_printedBuffer = allocatedResources.get("g_printedBuffer")
    if(!(g_printedBuffer instanceof GPUBuffer)) {
        throw new Error("g_printedBuffer is not a buffer")
    }
    encoder.copyBufferToBuffer(
        outputBuffer, 0, outputBufferRead, 0, outputBuffer.size);
    encoder.copyBufferToBuffer(
        g_printedBuffer, 0, printfBufferRead, 0, g_printedBuffer.size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    await device.queue.onSubmittedWorkDone();

    // Read the results once the job is done
    await printfBufferRead.mapAsync(GPUMapMode.READ);

    let textResult = "";
    const formatPrint = parsePrintfBuffer(
        hashedStrings,
        printfBufferRead,
        printfBufferElementSize);

    if (formatPrint.length != 0)
        textResult += "Shader Output:\n" + formatPrint.join("") + "\n";

    printfBufferRead.unmap();
    let printResult = document.getElementById("printResult")
    if (!(printResult instanceof HTMLTextAreaElement)) {
        throw new Error("printResult invalid type")
    }
    printResult.value = textResult;
}

function checkShaderType(userSource: string) {
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

export type ParsedCommand = {
    "type": "ZEROS" | "RAND",
    "size": number[],
} | {
    "type": "URL",
    "url": string,
}

function safeSet<T extends GPUTexture | GPUBuffer>(map: Map<string, T>, key: string, value: T) {
    if (map.has(key)) {
        let currentEntry = map.get(key);
        if (currentEntry == undefined) throw new Error("Invalid state")
        currentEntry.destroy()
    }
    map.set(key, value);
};

async function processResourceCommands(pipeline: ComputePipeline | GraphicsPipeline, resourceBindings: Bindings, resourceCommands: { resourceName: string; parsedCommand: ParsedCommand; }[]) {
    var allocatedResources: Map<string, GPUBuffer | GPUTexture> = new Map();

    for (const { resourceName, parsedCommand } of resourceCommands) {
        if (parsedCommand.type === "ZEROS") {
            const size = parsedCommand.size.reduce((a: number, b: number) => a * b);
            const elementSize = 4; // Assuming 4 bytes per element (e.g., float) TODO: infer from type.
            const bindingInfo = resourceBindings.get(resourceName);
            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (bindingInfo.buffer) {
                const buffer = pipeline.device.createBuffer({
                    size: size * elementSize,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                });

                safeSet(allocatedResources, resourceName, buffer);

                // Initialize the buffer with zeros.
                const zeros = new Float32Array(size);
                pipeline.device.queue.writeBuffer(buffer, 0, zeros);
            } else if (bindingInfo.texture || bindingInfo.storageTexture) {
                if (parsedCommand.size.length !== 2) {
                    throw new Error(`Invalid parameter count ${parsedCommand.size.length} for ZEROS on texture ${resourceName}, should be 2.`);
                }
                try {
                    let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
                    if (bindingInfo.storageTexture) {
                        usage |= GPUTextureUsage.STORAGE_BINDING;
                    }
                    const texture = pipeline.device.createTexture({
                        size: parsedCommand.size,
                        format: bindingInfo.storageTexture ? 'r32float' : 'rgba8unorm',
                        usage: usage,
                    });

                    safeSet(allocatedResources, resourceName, texture);

                    // Initialize the texture with zeros.
                    let zeros = new Uint8Array(Array(size * elementSize).fill(0));
                    pipeline.device.queue.writeTexture({ texture }, zeros, { bytesPerRow: parsedCommand.size[0] * elementSize }, { width: parsedCommand.size[0], height: parsedCommand.size[1] });
                }
                catch (error) {
                    throw new Error(`Failed to create texture: ${error}`);
                }
            } else {
                throw new Error(`Resource ${resourceName} is an invalid type for ZEROS`);
            }
        }
        else if (parsedCommand.type === "URL") {
            // Load image from URL and wait for it to be ready.
            const bindingInfo = resourceBindings.get(resourceName);

            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (!bindingInfo.texture) {
                throw new Error(`Resource ${resourceName} is not a texture.`);
            }

            const image = new Image();
            try {
                // TODO: Pop-up a warning if the image is not CORS-enabled.
                // TODO: Pop-up a warning for the user to confirm that its okay to load a cross-origin image (i.e. do you trust this code..)
                //
                image.crossOrigin = "anonymous";

                image.src = parsedCommand.url;
                await image.decode();
            }
            catch (error) {
                throw new Error(`Failed to load & decode image from URL: ${parsedCommand.url}`);
            }

            try {
                const imageBitmap = await createImageBitmap(image);
                const texture = pipeline.device.createTexture({
                    size: [imageBitmap.width, imageBitmap.height],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                });
                pipeline.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: texture }, [imageBitmap.width, imageBitmap.height]);
                safeSet(allocatedResources, resourceName, texture);
            }
            catch (error) {
                throw new Error(`Failed to create texture from image: ${error}`);
            }
        }
        else if (parsedCommand.type === "RAND") {
            const size = parsedCommand.size.reduce((a: number, b: number) => a * b);
            const elementSize = 4; // Assuming 4 bytes per element (e.g., float) TODO: infer from type.
            const bindingInfo = resourceBindings.get(resourceName);
            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (!bindingInfo.buffer) {
                throw new Error(`Resource ${resourceName} is not defined as a buffer.`);
            }

            const buffer = pipeline.device.createBuffer({
                size: size * elementSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            safeSet(allocatedResources, resourceName, buffer);

            // Place a call to a shader that fills the buffer with random numbers.
            if (!randFloatPipeline) {
                const randomPipeline = new ComputePipeline(pipeline.device);

                // Load randFloat shader code from the file.
                const randFloatShaderCode = await (await fetch('demos/rand_float.slang')).text();
                if (compiler == null) {
                    throw new Error("Compiler is not defined!")
                }
                const compiledResult = compiler.compile(randFloatShaderCode, "computeMain", "WGSL");
                if (!compiledResult) {
                    throw new Error("[Internal] Failed to compile randFloat shader");
                }

                let [code, layout, hashedStrings] = compiledResult;
                const module = pipeline.device.createShaderModule({ code: code });

                randomPipeline.createPipelineLayout(layout);

                // Create the pipeline (without resource bindings for now)
                randomPipeline.createPipeline(module, null);

                randFloatPipeline = randomPipeline;
            }

            // Dispatch a random number generation shader.
            {
                const randomPipeline = randFloatPipeline;

                // Alloc resources for the shader.
                if (!randFloatResources)
                    randFloatResources = new Map();

                randFloatResources.set("outputBuffer", buffer);

                if (!randFloatResources.has("seed"))
                    randFloatResources.set("seed",
                        pipeline.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));

                const seedBuffer = randFloatResources.get("seed") as GPUBuffer;

                // Set bindings on the pipeline.
                randFloatPipeline.createBindGroup(randFloatResources);

                const seedValue = new Float32Array([Math.random(), 0, 0, 0]);
                pipeline.device.queue.writeBuffer(seedBuffer, 0, seedValue);

                // Encode commands to do the computation
                const encoder = pipeline.device.createCommandEncoder({ label: 'compute builtin encoder' });
                const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

                pass.setBindGroup(0, randomPipeline.bindGroup || null);

                if (randomPipeline.pipeline == undefined) {
                    throw new Error("Random pipeline is undefined")
                }
                pass.setPipeline(randomPipeline.pipeline);

                const workGroupSizeX = Math.floor((size + 63) / 64);
                pass.dispatchWorkgroups(workGroupSizeX, 1);
                pass.end();

                // Finish encoding and submit the commands
                const commandBuffer = encoder.finish();
                pipeline.device.queue.submit([commandBuffer]);
                await pipeline.device.queue.onSubmittedWorkDone();
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

    var length = new Float32Array(8).byteLength;
    safeSet(allocatedResources, "uniformInput", pipeline.device.createBuffer({ size: length, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));

    return allocatedResources;
}

function freeAllocatedResources(resources: Map<string, GPUBuffer | GPUTexture>) {
    for (const resource of resources.values()) {
        resource.destroy();
    }
}

export var onRun = () => {
    if (!device)
        return;
    if (!monacoEditor)
        return;
    if (!compiler)
        return;

    resetMouse();
    if (!computePipeline) {
        computePipeline = new ComputePipeline(device);
    }

    withRenderLock(
        // setupFn
        async () => {
            // We will have some restrictions on runnable shader, the user code has to define imageMain or printMain function.
            // We will do a pre-filter on the user input source code, if it's not runnable, we will not run it.
            const userSource = monacoEditor.getValue();
            const shaderType = checkShaderType(userSource);
            if (shaderType == SlangCompiler.NON_RUNNABLE_SHADER) {
                toggleDisplayMode(HIDDEN_MODE);
                codeGenArea.setValue("");
                throw new Error("Error: In order to run the shader, please define either imageMain or printMain function in the shader code.");
            }

            const entryPointName = shaderType == SlangCompiler.RENDER_SHADER ? "imageMain" : "printMain";
            const ret = compileShader(userSource, entryPointName, "WGSL");

            if (!ret.succ) {
                toggleDisplayMode(HIDDEN_MODE);
                throw new Error("");
            }

            hashedStrings = ret.hashedStrings;

            resourceCommands = parseResourceCommands(userSource);

            try {
                callCommands = parseCallCommands(userSource);
            }
            catch (error: any) {
                throw new Error("Error while parsing '//! CALL' commands: " + error.message);
            }

            resourceBindings = ret.layout;
            // create a pipeline resource 'signature' based on the bindings found in the program.
            computePipeline.createPipelineLayout(resourceBindings);

            if (extraComputePipelines.length > 0)
                extraComputePipelines = []; // This should release the resources of the extra pipelines.

            if (callCommands && (callCommands.length > 0)) {
                for (const command of callCommands) {
                    const compiledResult = compileShader(userSource, command.fnName, "WGSL");
                    if (!compiledResult.succ) {
                        throw new Error("Failed to compile shader for requested entry-point: " + command.fnName);
                    }

                    const module = device.createShaderModule({ code: compiledResult.code });
                    const pipeline = new ComputePipeline(device);
                    pipeline.createPipelineLayout(compiledResult.layout);
                    pipeline.createPipeline(module, null);
                    pipeline.setThreadGroupSize(compiledResult.threadGroupSize);
                    extraComputePipelines.push(pipeline);
                }
            }

            allocatedResources = await processResourceCommands(computePipeline, resourceBindings, resourceCommands);


            if (!passThroughPipeline) {
                passThroughPipeline = new GraphicsPipeline(device);
                const shaderModule = device.createShaderModule({ code: passThroughshaderCode });
                const inputTexture = allocatedResources.get("outputTexture");
                if(!(inputTexture instanceof GPUTexture)) {
                    throw new Error("inputTexture is not a texture")
                }
                passThroughPipeline.createPipeline(shaderModule, inputTexture);
            }

            let outputTexture = allocatedResources.get("outputTexture");
            if (!(outputTexture instanceof GPUTexture)) {
                throw new Error("")
            }
            passThroughPipeline.inputTexture = outputTexture;
            passThroughPipeline.createBindGroup();

            const module = device.createShaderModule({ code: ret.code });
            computePipeline.createPipeline(module, allocatedResources);

            // Create bind groups for the extra pipelines
            for (const pipeline of extraComputePipelines)
                pipeline.createBindGroup(allocatedResources);

            if (compiler == null) {
                throw new Error("Could not get compiler")
            }
            toggleDisplayMode(compiler.shaderType);
        },
        // renderFn
        async (timeMS: number) => {
            if (compiler == null) {
                throw new Error("Could not get compiler")
            }
            if (compiler.shaderType == SlangCompiler.PRINT_SHADER) {
                await printResult();
                return false; // Stop after one frame.
            }
            else if (compiler.shaderType == SlangCompiler.RENDER_SHADER) {
                return await execFrame(timeMS);
            }
            return false;
        });
}

function appendOutput(editor: monaco.editor.IStandaloneCodeEditor, textLine: string) {
    editor.setValue(editor.getValue() + textLine + "\n");
}

export function compileOrRun() {
    const userSource = monacoEditor.getValue();
    const shaderType = checkShaderType(userSource);

    if (shaderType == SlangCompiler.NON_RUNNABLE_SHADER) {
        onCompile();
    }
    else {
        if (device == null) {
            onCompile().then(() => {
                if (diagnosticsArea.getValue() == "")
                    appendOutput(diagnosticsArea, `The shader compiled successfully,` +
                        `but it cannot run because your browser does not support WebGPU.\n` +
                        `WebGPU is supported in Chrome, Edge, Firefox Nightly and Safari Technology Preview. ` +
                        `On iOS, WebGPU support requires Safari 16.4 or later and must be enabled in settings. ` +
                        `Please check your browser version and enable WebGPU if possible.`);
            });
        }
        else {
            onRun();
        }
    }
}

var reflectionJson: any = {};

type Shader = {
    succ: true,
    code: string,
    layout: Bindings,
    hashedStrings: any,
    reflection: any,
    threadGroupSize: ThreadGroupSize | { x: number, y: number, z: number }
} | {
    succ: false
};
function compileShader(userSource: string, entryPoint: string, compileTarget: string, includePlaygroundModule = true): Shader {
    if (compiler == null) throw new Error("No compiler available")
    const compiledResult = compiler.compile(userSource, entryPoint, compileTarget);
    diagnosticsArea.setValue(compiler.diagnosticsMsg);

    // If compile is failed, we just clear the codeGenArea
    if (!compiledResult) {
        codeGenArea.setValue('Compilation returned empty result.');
        return { succ: false };
    }

    let [compiledCode, layout, hashedStrings, reflectionJsonObj, threadGroupSize] = compiledResult;
    reflectionJson = reflectionJsonObj;

    codeGenArea.setValue(compiledCode);
    let model = codeGenArea.getModel();
    if (model == null) {
        throw new Error("Cannot get editor model")
    }
    if (compileTarget == "WGSL")
        monaco.editor.setModelLanguage(model, "wgsl");
    else if (compileTarget == "SPIRV")
        monaco.editor.setModelLanguage(model, "spirv");
    else
        monaco.editor.setModelLanguage(model, "generic-shader");

    // Update reflection info.
    window.$jsontree.setJson("reflectionDiv", reflectionJson);
    window.$jsontree.refreshAll();

    return { succ: true, code: compiledCode, layout: layout, hashedStrings: hashedStrings, reflection: reflectionJson, threadGroupSize: threadGroupSize };
}

// For the compile button action, we don't have restriction on user code that it has to define imageMain or printMain function.
// But if it doesn't define any of them, then user code has to define a entry point function name. Because our built-in shader
// have no way to call the user defined function, and compile engine cannot compile the source code.
export async function onCompile() {

    toggleDisplayMode(HIDDEN_MODE);
    const compileTarget = (document.getElementById("target-select") as HTMLSelectElement).value;

    const entryPoint = (document.getElementById("entrypoint-select") as HTMLSelectElement).value;
    if (entryPoint == "" && !isWholeProgramTarget(compileTarget)) {
        diagnosticsArea.setValue("Please select the entry point name");
        return;
    }

    if (compiler == null) throw new Error("Compiler doesn't exist")

    if (compileTarget == "SPIRV")
        await compiler.initSpirvTools();

    // compile the compute shader code from input text area
    const userSource = monacoEditor.getValue();
    compileShader(userSource, entryPoint, compileTarget);

    if (compiler.diagnosticsMsg.length > 0) {
        diagnosticsArea.setValue(compiler.diagnosticsMsg);
        return;
    }
}

export function loadEditor(readOnlyMode = false, containerId: string, preloadCode: string) {
    RequireJS.require(["vs/editor/editor.main"], function () {
        let container = document.getElementById(containerId);
        if (container == null) {
            throw new Error("Could not find container for editor")
        }
        initMonaco();
        let model = readOnlyMode
            ? monaco.editor.createModel(preloadCode)
            : monaco.editor.createModel("", "slang", monaco.Uri.parse(userCodeURI));
        let editor = monaco.editor.create(container, {
            model: model,
            language: readOnlyMode ? 'csharp' : 'slang',
            theme: 'slang-dark',
            readOnly: readOnlyMode,
            lineNumbers: readOnlyMode ? "off" : "on",
            automaticLayout: true,
            wordWrap: containerId == "diagnostics" ? "on" : "off",
            "semanticHighlighting.enabled": true,
            renderValidationDecorations: "on",
            minimap: {
                enabled: false
            },
        });
        if (!readOnlyMode) {
            model.onDidChangeContent(codeEditorChangeContent);
            model.setValue(preloadCode);
        }

        if (containerId == "codeEditor")
            monacoEditor = editor;
        else if (containerId == "diagnostics") {
            let model = editor.getModel();
            if (model == null) {
                throw new Error("Cannot get editor model")
            }
            monaco.editor.setModelLanguage(model, "text")
            diagnosticsArea = editor;
        }
        else if (containerId == "codeGen") {
            codeGenArea = editor;
        }
    })
}


// Event when loading the WebAssembly module
var moduleLoadingMessage = "";
type ReplaceReturnType<T extends (...a: any) => any, TNewReturn> = (...a: Parameters<T>) => TNewReturn;
export type ModuleType = MainModule & Omit<EmscriptenModule, "instantiateWasm"> & {
    instantiateWasm: ReplaceReturnType<EmscriptenModule["instantiateWasm"], Promise<WebAssembly.Exports>>
}

declare global {
    var Module: ModuleType
}

// Define the Module object with a callback for initialization
globalThis.Module = {
    locateFile: function (path: string) {
        if (path.endsWith('.wasm')) {
            return 'slang-wasm.wasm.gz'; // Use the gzip compressed file
        }
        return path;
    },
    instantiateWasm: async function (imports: WebAssembly.Imports, receiveInstance: (arg0: WebAssembly.Instance) => void): Promise<WebAssembly.Exports> {
        // Step 1: Fetch the compressed .wasm.gz file
        var progressBar = document.getElementById('progress-bar');
        const compressedData = await fetchWithProgress('slang-wasm.wasm.gz', (loaded, total) => {
            const progress = (loaded / total) * 100;
            if (progressBar == null) progressBar = document.getElementById('progress-bar');
            if (progressBar) progressBar.style.width = `${progress}%`;
        });

        // Step 2: Decompress the gzip data
        const wasmBinary = globalThis.pako.inflate(compressedData);

        // Step 3: Instantiate the WebAssembly module from the decompressed data
        const { instance } = await WebAssembly.instantiate(wasmBinary, imports);
        receiveInstance(instance);
        return instance.exports;
    },
    onRuntimeInitialized: function () {
        var label = document.getElementById("loadingStatusLabel");
        if (label)
            label.innerText = "Initializing Slang Compiler...";
        compiler = new SlangCompiler(globalThis.Module);
        var result = compiler.init();
        slangd = globalThis.Module.createLanguageServer();
        if (result.ret) {
            (document.getElementById("compile-btn") as HTMLButtonElement).disabled = false;
            moduleLoadingMessage = "Slang compiler initialized successfully.\n";
            runIfFullyInitialized();
        }
        else {
            console.log(result.msg);
            moduleLoadingMessage = "Failed to initialize Slang Compiler, Run and Compile features are disabled.\n";
        }
    }
} satisfies Partial<ModuleType> as any;


RequireJS.require(["./slang-wasm.js"]);

var pageLoaded = false;
// event when loading the page
window.onload = async function () {
    pageLoaded = true;

    await webgpuInit();
    let button = (document.getElementById("run-btn") as HTMLButtonElement);
    if (device) {
        button.disabled = false;
    }
    else {
        diagnosticsArea.setValue(moduleLoadingMessage + "Browser does not support WebGPU, Run shader feature is disabled.");
        button.title = "Run shader feature is disabled because the current browser does not support WebGPU.";
    }
    runIfFullyInitialized();
}

function runIfFullyInitialized() {
    if (compiler && slangd && pageLoaded && monacoEditor) {
        initLanguageServer();

        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen == null) throw new Error("missing loading screen element");
        // Start fade-out by setting opacity to 0
        loadingScreen.style.opacity = '0';
        // Wait for the transition to finish before hiding completely
        loadingScreen.addEventListener('transitionend', () => {
            loadingScreen.style.display = 'none';
        });
        (document.getElementById('contentDiv') as HTMLElement).style.cssText = "";

        restoreSelectedTargetFromURL();

        if (restoreDemoSelectionFromURL()) { }
        else if (monacoEditor.getValue() == "") {
            loadDemo(defaultShaderURL);
        }
        else {
            compileOrRun();
        }
    }
}