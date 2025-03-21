<script setup lang="ts">
import type { CompiledPlayground } from '@/App.vue';
import type { Bindings, ShaderType } from '../compiler';
import { ComputePipeline } from '../compute';
import { GraphicsPipeline, passThroughshaderCode } from '../pass_through';
import { compiler } from '../try-slang';
import { type CallCommand, NotReadyError, parsePrintfBuffer, type ResourceCommand, sizeFromFormat } from '../util';
import { onMounted, ref, useTemplateRef } from 'vue';
import randFloatShaderCode from "../slang/rand_float.slang?raw";

let context: GPUCanvasContext;
let randFloatPipeline: ComputePipeline;
let computePipelines: ComputePipeline[] = [];
let passThroughPipeline: GraphicsPipeline;

let compiledCode: CompiledPlayground;
let allocatedResources: Map<string, GPUTexture | GPUBuffer>;
let randFloatResources: Map<string, GPUObjectBase>;

let renderThread: Promise<void> | null = null;
let abortRender = false;
let onRenderAborted: (() => void) | null = null;

const printfBufferElementSize = 12;
const printfBufferSize = printfBufferElementSize * 2048; // 12 bytes per printf struct

let currentWindowSize = [300, 150];

let canvasLastMouseDownPos = { x: 0, y: 0 };
let canvasCurrentMousePos = { x: 0, y: 0 };
let canvasIsMouseDown = false;
let canvasMouseClicked = false;

const canvas = useTemplateRef("canvas");
const frameTime = ref(0);

const { device } = defineProps<{
    device: GPUDevice;
}>()

let emit = defineEmits<{
    (e: 'logError', message: string): void;
    (e: 'logOutput', message: string): void;
}>();

defineExpose({
    onRun,
});

onMounted(() => {
    if (canvas.value == null) {
        throw new Error("Could not get canvas element");
    }

    try {
        context = configContext(device);
    }
    catch (e) {
        console.error(e);
    }

    // The default resolution of a canvas element is 300x150, which is too small compared to the container size of the canvas,
    // therefore, we have to set the resolution same as the container size.
    const observer = new ResizeObserver((entries) => { resizeCanvasHandler(entries); });
    observer.observe(canvas.value);
})

function resizeCanvas(entries: ResizeObserverEntry[]) {
    const canvas = entries[0].target;

    if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("canvas object is not a canvas element");
    }

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;

    if (width != currentWindowSize[0] || height != currentWindowSize[1]) {
        // ensure the size won't be 0 nor exceed the limit, otherwise WebGPU will throw an errors
        canvas.width = Math.max(2, Math.min(width, device.limits.maxTextureDimension2D));
        canvas.height = Math.max(2, Math.min(height, device.limits.maxTextureDimension2D));

        currentWindowSize = [canvas.width, canvas.height];
        return true;
    }

    return false;
}

function withRenderLock(setupFn: { (): Promise<void>; }, renderFn: { (timeMS: number, currentDisplayMode: ShaderType): Promise<boolean>; }) {
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
                let nextFrame = false;
                try {
                    const keepRendering = await renderFn(timeMS, compiler?.shaderType || null);
                    nextFrame = keepRendering && !abortRender;
                    if (nextFrame)
                        requestAnimationFrame(newRenderLoop);
                } catch (error: any) {
                    if (error instanceof Error)
                        emit("logError", `Error when rendering: ${error.message} in ${error.stack}`);
                    else
                        emit("logError", `Error when rendering: ${error}`);
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
                if (error instanceof NotReadyError) {
                    // do nothing
                } else {
                    emit("logError", error.message);
                    console.error(error);
                }
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

function handleResize() {
    if (!passThroughPipeline)
        return;

    if (currentWindowSize[0] < 2 || currentWindowSize[1] < 2)
        return;

    for (const { resourceName, parsedCommand } of compiledCode.resourceCommands) {
        if (parsedCommand.type === "BLACK_SCREEN") {
            const width = parsedCommand.width_scale * currentWindowSize[0];
            const height = parsedCommand.height_scale * currentWindowSize[1];
            const size = width * height;

            const bindingInfo = compiledCode.shader.layout.get(resourceName);
            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            const format = bindingInfo.storageTexture?.format;
            if (format == undefined) {
                throw new Error(`Could not find format of ${resourceName}`)
            }
            const elementSize = sizeFromFormat(format);

            if (!bindingInfo.texture && !bindingInfo.storageTexture) {
                throw new Error(`Resource ${resourceName} is an invalid type for BLACK`);
            }
            try {
                let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;
                if (bindingInfo.storageTexture) {
                    usage |= GPUTextureUsage.STORAGE_BINDING;
                }
                const texture = device.createTexture({
                    size: [width, height],
                    format,
                    usage: usage,
                });

                let zeros = new Uint8Array(Array(size * elementSize).fill(0));
                device.queue.writeTexture({ texture }, zeros, { bytesPerRow: width * elementSize }, { width, height });

                // Initialize the texture with zeros.
                const encoder = device.createCommandEncoder({ label: 'resize encoder' });
                let oldTexture = allocatedResources.get(resourceName);
                if (!(oldTexture instanceof GPUTexture)) {
                    throw new Error("Cannot resize non texture");
                }
                let sharedWidth = Math.min(width, oldTexture.width);
                let sharedHeight = Math.min(height, oldTexture.height);
                encoder.copyTextureToTexture({ texture: oldTexture }, { texture }, {
                    width: sharedWidth,
                    height: sharedHeight,
                })
                
                let commandBuffer = encoder.finish();
                device.queue.submit([commandBuffer]);

                safeSet(allocatedResources, resourceName, texture);
            }
            catch (error) {
                throw new Error(`Failed to create texture: ${error}`);
            }
        }
    }

    passThroughPipeline.inputTexture = (allocatedResources.get("outputTexture") as GPUTexture);
    passThroughPipeline.createBindGroup();

    for (const pipeline of computePipelines)
        pipeline.createBindGroup(allocatedResources);
}

// We use the timer in the resize handler debounce the resize event, otherwise we could end of rendering
// multiple useless frames.
function resizeCanvasHandler(entries: ResizeObserverEntry[]) {
    let needResize = resizeCanvas(entries);
    if (needResize) {
        handleResize();
    }
}

function configContext(device: GPUDevice) {
    let context = canvas.value?.getContext('webgpu');

    const canvasConfig = {
        device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage:
            GPUTextureUsage.RENDER_ATTACHMENT,
    };

    if (context == null) {
        throw new Error("Could not get webgpu context");
    }

    context.configure(canvasConfig);
    return context;
}

function mousedown(event: MouseEvent) {
    canvasLastMouseDownPos.x = event.offsetX;
    canvasLastMouseDownPos.y = event.offsetY;
    canvasCurrentMousePos.x = event.offsetX;
    canvasCurrentMousePos.y = event.offsetY;
    canvasMouseClicked = true;
    canvasIsMouseDown = true;
}

function mousemove(event: MouseEvent) {
    if (canvasIsMouseDown) {
        canvasCurrentMousePos.x = event.offsetX;
        canvasCurrentMousePos.y = event.offsetY;
    }
}

function mouseup(event: MouseEvent) {
    canvasIsMouseDown = false;
}

function resetMouse() {
    canvasIsMouseDown = false;
    canvasLastMouseDownPos.x = 0;
    canvasLastMouseDownPos.y = 0;
    canvasCurrentMousePos.x = 0;
    canvasCurrentMousePos.y = 0;
    canvasMouseClicked = false;
}

let timeAggregate = 0;
let frameCount = 0;

async function execFrame(timeMS: number, currentDisplayMode: ShaderType, playgroundData: CompiledPlayground, firstFrame: boolean) {
    if (currentDisplayMode == null)
        return false;
    if (currentWindowSize[0] < 2 || currentWindowSize[1] < 2)
        return false;

    const startTime = performance.now();
    let uniformInput = allocatedResources.get("uniformInput");
    if (!(uniformInput instanceof GPUBuffer)) {
        throw new Error("uniformInput doesn't exist or is of incorrect type");
    }

    let uniformBufferData = new ArrayBuffer(playgroundData.uniformSize);
    let uniformBufferView = new DataView(uniformBufferData);

    for (let uniformComponent of playgroundData.uniformComponents.value) {
        let offset = uniformComponent.buffer_offset;
        try {
        if (uniformComponent.type == "SLIDER") {
            uniformBufferView.setFloat32(offset, uniformComponent.value, true);
        } else if (uniformComponent.type == "COLOR_PICK") {
            uniformComponent.value.forEach((v, i) => {
                uniformBufferView.setFloat32(offset + i * 4, v, true);
            });
        } else if (uniformComponent.type == "TIME") {
            uniformBufferView.setFloat32(offset, timeMS * 0.001, true);
        } else if (uniformComponent.type == "MOUSE_POSITION") {
            uniformBufferView.setFloat32(offset, canvasCurrentMousePos.x, true);
            uniformBufferView.setFloat32(offset + 4, canvasCurrentMousePos.y, true);
            uniformBufferView.setFloat32(offset + 8, canvasLastMouseDownPos.x * (canvasIsMouseDown ? -1 : 1), true);
            uniformBufferView.setFloat32(offset + 12, canvasLastMouseDownPos.y * (canvasMouseClicked ? -1 : 1), true);
        } else {
            let _: never = uniformComponent;
            throw new Error("Invalid state");
        }
        } catch (error) {
            emit("logError", "Error when writing to uniform buffer: " + error);
            return false;
        }
    }

    device.queue.writeBuffer(uniformInput, 0, new Uint8Array(uniformBufferData));

    // Encode commands to do the computation
    const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });

    let printfBufferRead = allocatedResources.get("printfBufferRead");
    if (!(printfBufferRead instanceof GPUBuffer)) {
        throw new Error("printfBufferRead is not a buffer");
    }
    if (currentDisplayMode == "printMain") {
        encoder.clearBuffer(printfBufferRead);
    }

    // zip the computePipelines and callCommands together
    for (const [pipeline, command] of playgroundData.callCommands.map((x: CallCommand, i: number) => [computePipelines[i], x] as const)) {
        if (command.callOnce && !firstFrame) {
            // If the command is marked as callOnce and it's not the first frame, skip it.
            continue;
        }
        const pass = encoder.beginComputePass({ label: `${command.fnName} compute pass` });
        pass.setBindGroup(0, pipeline.bindGroup || null);
        if (pipeline.pipeline == undefined) {
            throw new Error("pipeline is undefined");
        }
        pass.setPipeline(pipeline.pipeline);
        // Determine the workgroup size based on the size of the buffer or texture.
        let size: [number, number, number];
        if (command.type == "RESOURCE_BASED") {
            if (!allocatedResources.has(command.resourceName)) {
                emit("logError", "Error when dispatching " + command.fnName + ". Resource not found: " + command.resourceName);
                pass.end();
                return false;
            }

            let resource = allocatedResources.get(command.resourceName);
            if (resource instanceof GPUBuffer) {
                let elementSize = command.elementSize || 4;
                size = [resource.size / elementSize, 1, 1];
            }
            else if (resource instanceof GPUTexture) {
                size = [resource.width, resource.height, 1];
            }
            else {
                pass.end();
                emit("logError", "Error when dispatching " + command.fnName + ". Resource type not supported for dispatch: " + resource);
                return false;
            }
        } else if (command.type == "FIXED_SIZE") {
            if (command.size.length > 3) {
                emit("logError", "Error when dispatching " + command.fnName + ". Too many parameters: " + command.size);
                pass.end();
                return false;
            }
            size = [1, 1, 1];
            for (let i = 0; i < command.size.length; i++) {
                size[i] = command.size[i];
            }
        } else {
            // exhaustiveness check
            let x: never = command;
            throw new Error("Invalid state!");
        }

        if (pipeline.threadGroupSize == undefined) {
            throw new Error("threadGroupSize is undefined");
        }

        const blockSize = pipeline.threadGroupSize

        const workGroupSize = size
            .map((size, idx) => [size, blockSize[idx]] as const)
            .map(([size, blockSize]) => Math.floor((size + blockSize - 1) / blockSize))

        pass.dispatchWorkgroups(workGroupSize[0], workGroupSize[1], workGroupSize[2]);

        pass.end();
    }

    if (currentDisplayMode == "imageMain") {
        const renderPassDescriptor = passThroughPipeline.createRenderPassDesc(context.getCurrentTexture().createView());
        const renderPass = encoder.beginRenderPass(renderPassDescriptor);

        renderPass.setBindGroup(0, passThroughPipeline.bindGroup || null);
        if (passThroughPipeline.pipeline == undefined) {
            throw new Error("Pass through pipeline is undefined!");
        }
        renderPass.setPipeline(passThroughPipeline.pipeline);
        renderPass.draw(6);  // call our vertex shader 6 times.
        renderPass.end();
    }

    // copy output buffer back in print mode
    if (currentDisplayMode == "printMain") {
        let g_printedBuffer = allocatedResources.get("g_printedBuffer")
        if (!(g_printedBuffer instanceof GPUBuffer)) {
            throw new Error("g_printedBuffer is not a buffer");
        }
        encoder.copyBufferToBuffer(
            g_printedBuffer, 0, printfBufferRead, 0, g_printedBuffer.size);
    }

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    await device.queue.onSubmittedWorkDone();

    if (currentDisplayMode == "printMain") {
        await printfBufferRead.mapAsync(GPUMapMode.READ);

        let textResult = "";
        const formatPrint = parsePrintfBuffer(
            compiledCode.shader.hashedStrings,
            printfBufferRead,
            printfBufferElementSize);

        if (formatPrint.length != 0)
            textResult += "Shader Output:\n" + formatPrint.join("") + "\n";

        printfBufferRead.unmap();
        emit("logOutput", textResult);
    }

    const timeElapsed = performance.now() - startTime;

    // Update performance info.
    timeAggregate += timeElapsed;
    frameCount++;
    if (frameCount == 20) {
        let avgTime = (timeAggregate / frameCount);
        frameTime.value = avgTime;
        timeAggregate = 0;
        frameCount = 0;
    }

    // Request the next frame
    return true;
}

function safeSet<T extends GPUTexture | GPUBuffer>(map: Map<string, T>, key: string, value: T) {
    if (map.has(key)) {
        let currentEntry = map.get(key);
        if (currentEntry == undefined) throw new Error("Invalid state");
        currentEntry.destroy();
    }
    map.set(key, value);
};

async function processResourceCommands(resourceBindings: Bindings, resourceCommands: ResourceCommand[], uniformSize: number) {
    let allocatedResources: Map<string, GPUBuffer | GPUTexture> = new Map();

    safeSet(allocatedResources, "uniformInput", device.createBuffer({ size: uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));

    for (const { resourceName, parsedCommand } of resourceCommands) {
        if (parsedCommand.type === "ZEROS") {
            const elementSize = parsedCommand.elementSize;
            const bindingInfo = resourceBindings.get(resourceName);
            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (!bindingInfo.buffer) {
                throw new Error(`Resource ${resourceName} is an invalid type for ZEROS`);
            }

            const buffer = device.createBuffer({
                size: parsedCommand.count * elementSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            safeSet(allocatedResources, resourceName, buffer);

            // Initialize the buffer with zeros.
            let zeros: BufferSource = new Uint8Array(parsedCommand.count * elementSize);
            device.queue.writeBuffer(buffer, 0, zeros);
        } else if (parsedCommand.type === "BLACK") {
            const size = parsedCommand.width * parsedCommand.height;
            const bindingInfo = resourceBindings.get(resourceName);
            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            const format = bindingInfo.storageTexture?.format;
            if (format == undefined) {
                throw new Error(`Could not find format of ${resourceName}`);
            }
            const elementSize = sizeFromFormat(format);

            if (!bindingInfo.texture && !bindingInfo.storageTexture) {
                throw new Error(`Resource ${resourceName} is an invalid type for BLACK`);
            }
            try {
                let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
                if (bindingInfo.storageTexture) {
                    usage |= GPUTextureUsage.STORAGE_BINDING;
                }
                const texture = device.createTexture({
                    size: [parsedCommand.width, parsedCommand.height],
                    format,
                    usage: usage,
                });

                safeSet(allocatedResources, resourceName, texture);

                // Initialize the texture with zeros.
                let zeros = new Uint8Array(Array(size * elementSize).fill(0));
                device.queue.writeTexture({ texture }, zeros, { bytesPerRow: parsedCommand.width * elementSize }, { width: parsedCommand.width, height: parsedCommand.height });
            }
            catch (error) {
                throw new Error(`Failed to create texture: ${error}`);
            }
        } else if (parsedCommand.type === "BLACK_SCREEN") {
            const width = parsedCommand.width_scale * currentWindowSize[0];
            const height = parsedCommand.height_scale * currentWindowSize[1];
            const size = width * height;

            const bindingInfo = resourceBindings.get(resourceName);
            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }


            const format = bindingInfo.storageTexture?.format;
            if (format == undefined) {
                throw new Error(`Could not find format of ${resourceName}`)
            }
            const elementSize = sizeFromFormat(format);

            if (!bindingInfo.texture && !bindingInfo.storageTexture) {
                throw new Error(`Resource ${resourceName} is an invalid type for BLACK`);
            }
            try {
                let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;
                if (bindingInfo.storageTexture) {
                    usage |= GPUTextureUsage.STORAGE_BINDING;
                }
                const texture = device.createTexture({
                    size: [width, height],
                    format,
                    usage: usage,
                });

                safeSet(allocatedResources, resourceName, texture);

                // Initialize the texture with zeros.
                let zeros = new Uint8Array(Array(size * elementSize).fill(0));
                device.queue.writeTexture({ texture }, zeros, { bytesPerRow: width * elementSize }, { width, height });
                device.queue.submit([]);
            }
            catch (error) {
                throw new Error(`Failed to create texture: ${error}`);
            }
        } else if (parsedCommand.type === "URL") {
            // Load image from URL and wait for it to be ready.
            const bindingInfo = resourceBindings.get(resourceName);

            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (!bindingInfo.texture) {
                throw new Error(`Resource ${resourceName} is not a texture.`);
            }


            const format = parsedCommand.format;

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
                const texture = device.createTexture({
                    size: [imageBitmap.width, imageBitmap.height],
                    format,
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                });
                device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: texture }, [imageBitmap.width, imageBitmap.height]);
                safeSet(allocatedResources, resourceName, texture);
            }
            catch (error) {
                throw new Error(`Failed to create texture from image: ${error}`);
            }
        } else if (parsedCommand.type === "RAND") {
            const elementSize = 4; // RAND is only valid for floats
            const bindingInfo = resourceBindings.get(resourceName);
            if (!bindingInfo) {
                throw new Error(`Resource ${resourceName} is not defined in the bindings.`);
            }

            if (!bindingInfo.buffer) {
                throw new Error(`Resource ${resourceName} is not defined as a buffer.`);
            }

            const buffer = device.createBuffer({
                size: parsedCommand.count * elementSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            safeSet(allocatedResources, resourceName, buffer);

            // Place a call to a shader that fills the buffer with random numbers.
            if (!randFloatPipeline) {
                const randomPipeline = new ComputePipeline(device);

                if (compiler == null) {
                    throw new Error("Compiler is not defined!");
                }
                const compiledResult = compiler.compile(randFloatShaderCode, "computeMain", "WGSL", false);
                if (!compiledResult) {
                    throw new Error("[Internal] Failed to compile randFloat shader");
                }

                let [code, layout] = compiledResult;
                const module = device.createShaderModule({ code: code });

                randomPipeline.createPipelineLayout(layout);

                // Create the pipeline (without resource bindings for now)
                randomPipeline.createPipeline(module, "computeMain");

                randFloatPipeline = randomPipeline;
            }

            // Dispatch a random number generation shader.
            {
                const randomPipeline = randFloatPipeline;

                // Alloc resources for the shader.
                if (!randFloatResources)
                    randFloatResources = new Map();

                randFloatResources.set("outputBuffer", buffer);

                if (!randFloatResources.has("uniformInput"))
                    randFloatResources.set("uniformInput",
                        device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));

                const seedBuffer = randFloatResources.get("uniformInput") as GPUBuffer;

                // Set bindings on the pipeline.
                randFloatPipeline.createBindGroup(randFloatResources);

                const seedValue = new Float32Array([Math.random(), 0, 0, 0]);
                device.queue.writeBuffer(seedBuffer, 0, seedValue);

                // Encode commands to do the computation
                const encoder = device.createCommandEncoder({ label: 'compute builtin encoder' });
                const pass = encoder.beginComputePass({ label: 'compute builtin pass' });

                pass.setBindGroup(0, randomPipeline.bindGroup || null);

                if (randomPipeline.pipeline == undefined) {
                    throw new Error("Random pipeline is undefined");
                }
                pass.setPipeline(randomPipeline.pipeline);

                const workGroupSizeX = Math.floor((parsedCommand.count + 63) / 64);
                pass.dispatchWorkgroups(workGroupSizeX, 1);
                pass.end();

                // Finish encoding and submit the commands
                const commandBuffer = encoder.finish();
                device.queue.submit([commandBuffer]);
                await device.queue.onSubmittedWorkDone();
            }
        } else if (parsedCommand.type == "SLIDER") {
            const elementSize = parsedCommand.elementSize;

            const buffer = allocatedResources.get("uniformInput") as GPUBuffer

            // Initialize the buffer with the default.
            let bufferDefault: BufferSource
            if (elementSize == 4) {
                bufferDefault = new Float32Array([parsedCommand.default]);
            } else
                throw new Error("Unsupported float size for slider")
            device.queue.writeBuffer(buffer, parsedCommand.offset, bufferDefault);
        } else if (parsedCommand.type == "COLOR_PICK") {
            const elementSize = parsedCommand.elementSize;

            const buffer = allocatedResources.get("uniformInput") as GPUBuffer

            // Initialize the buffer with the default.
            let bufferDefault: BufferSource
            if (elementSize == 4) {
                bufferDefault = new Float32Array(parsedCommand.default);
            } else
                throw new Error("Unsupported float size for color pick")
            device.queue.writeBuffer(buffer, parsedCommand.offset, bufferDefault);
        } else if (parsedCommand.type == "TIME") {
            const buffer = allocatedResources.get("uniformInput") as GPUBuffer

            // Initialize the buffer with zeros.
            let bufferDefault: BufferSource = new Float32Array([0.0]);
            device.queue.writeBuffer(buffer, parsedCommand.offset, bufferDefault);
        } else if (parsedCommand.type == "MOUSE_POSITION") {
            const buffer = allocatedResources.get("uniformInput") as GPUBuffer

            // Initialize the buffer with zeros.
            let bufferDefault: BufferSource = new Float32Array([0, 0, 0, 0]);
            device.queue.writeBuffer(buffer, parsedCommand.offset, bufferDefault);
        } else {
            // exhaustiveness check
            let x: never = parsedCommand;
            throw new Error("Invalid resource command type");
        }
    }

    //
    // Some special-case allocations
    //
    safeSet(allocatedResources, "g_printedBuffer", device.createBuffer({
        size: printfBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }));

    safeSet(allocatedResources, "printfBufferRead", device.createBuffer({
        size: printfBufferSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }));

    return allocatedResources;
}

function onRun(runCompiledCode: CompiledPlayground) {
    if (!device)
        return;
    if (!compiler)
        return;

    resetMouse();

    let firstFrame = true;

    withRenderLock(
        // setupFn
        async () => {
            compiledCode = runCompiledCode;

            if (computePipelines.length > 0)
                computePipelines = []; // This should release the resources of the pipelines.

            const module = device.createShaderModule({ code: compiledCode.shader.code });

            for (const callCommand of compiledCode.callCommands) {
                const entryPoint = callCommand.fnName;
                const pipeline = new ComputePipeline(device);
                // create a pipeline resource 'signature' based on the bindings found in the program.
                pipeline.createPipelineLayout(compiledCode.shader.layout);
                pipeline.createPipeline(module, entryPoint);
                pipeline.setThreadGroupSize(compiledCode.shader.threadGroupSizes[entryPoint]);
                computePipelines.push(pipeline);
            }

            allocatedResources = await processResourceCommands(compiledCode.shader.layout, compiledCode.resourceCommands, compiledCode.uniformSize);

            if (!passThroughPipeline) {
                passThroughPipeline = new GraphicsPipeline(device);
                const shaderModule = device.createShaderModule({ code: passThroughshaderCode });
                const inputTexture = allocatedResources.get("outputTexture");
                if (!(inputTexture instanceof GPUTexture)) {
                    throw new Error("inputTexture is not a texture");
                }
                passThroughPipeline.createPipeline(shaderModule, inputTexture);
            }

            let outputTexture = allocatedResources.get("outputTexture");
            if (!(outputTexture instanceof GPUTexture)) {
                throw new Error("");
            }
            passThroughPipeline.inputTexture = outputTexture;
            passThroughPipeline.createBindGroup();

            // Create bind groups for the pipelines
            for (const pipeline of computePipelines)
                pipeline.createBindGroup(allocatedResources);
        },
        // renderFn
        async (timeMS: number) => {
            if (compiler == null) {
                throw new Error("Could not get compiler");
            }
            if (compiler.shaderType !== null) {
                const keepRendering = await execFrame(timeMS, compiler?.shaderType || null, compiledCode, firstFrame);
                firstFrame = false;
                return keepRendering;
            }
            return false;
        });
}
</script>

<template>
    <div class="renderOverlay">
        <div id="performanceInfo">{{ `${frameTime.toFixed(1)} ms` }}</div>
    </div>
    <canvas v-bind="$attrs" class="renderCanvas" @mousedown="mousedown" @mousemove="mousemove" @mouseup="mouseup"
        ref="canvas"></canvas>
</template>

<style scoped>
.renderCanvas {
    background-color: var(--black);
    width: 100%;
    height: 100%;
}

.renderOverlay {
    position: absolute;
    padding: 8px;
    border-radius: 5px;
    width: fit-content;
    background: rgba(0, 0, 0, 0.3);
}

#performanceInfo {
    color: white;
    width: fit-content;
    -moz-user-select: -moz-none;
    -khtml-user-select: none;
    -webkit-user-select: none;
    -ms-user-select: none;
    user-select: none;
}
</style>