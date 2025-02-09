<script setup lang="ts">
import TabContainer from './components/ui/TabContainer.vue'
import Tab from './components/ui/Tab.vue'
import Selector from './components/ui/Selector.vue'
import Tooltip from './components/ui/Tooltip.vue'
import Slider from './components/ui/Slider.vue'
import Help from './components/Help.vue'
import RenderCanvas from './components/RenderCanvas.vue'
import { compiler, checkShaderType, slangd, moduleLoadingMessage } from './try-slang'
import { defineAsyncComponent, onBeforeMount, onMounted, ref, useTemplateRef, type Ref } from 'vue'
import { isWholeProgramTarget, type Bindings, type ReflectionJSON, type RunnableShaderType, type ShaderType } from './compiler'
import { demoList } from './demo-list'
import { compressToBase64URL, decompressFromBase64URL, getResourceCommandsFromAttributes, getUniformSize, getUniformSliders, isWebGPUSupported, parseCallCommands, type CallCommand, type ResourceCommand, type UniformController } from './util'
import type { ThreadGroupSize } from './slang-wasm'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import ReflectionView from './components/ReflectionView.vue'
import Colorpick from './components/ui/Colorpick.vue'

// MonacoEditor is a big component, so we load it asynchronously.
const MonacoEditor = defineAsyncComponent(() => import('./components/MonacoEditor.vue'))

// target -> profile mappings
const defaultShaderURL = "circle.slang";
const compileTargets = [
    "SPIRV",
    "HLSL",
    "GLSL",
    "METAL",
    "WGSL",
] as const
const targetProfileMap: { [target in typeof compileTargets[number]]?: { default: string, options: string[] } } = {
    // TODO: uncomment when we support specifying profiles.
    // "SPIRV": {default:"1.5", options:["1.3", "1.4", "1.5", "1.6"]},
};

const targetLanguageMap: { [target in typeof compileTargets[number]]: string } = {
    "SPIRV": "spirv",
    "HLSL": "generic-shader",
    "GLSL": "generic-shader",
    "METAL": "generic-shader",
    "WGSL": "wgsl",
};

const codeEditor = useTemplateRef("codeEditor");
const diagnosticsArea = useTemplateRef("diagnostics");
const codeGenArea = useTemplateRef("codeGenArea");

const shareButton = useTemplateRef("shareButton");
const tooltip = useTemplateRef("tooltip");
const helpModal = useTemplateRef("helpModal");
const targetSelect = useTemplateRef("targetSelect");
const renderCanvas = useTemplateRef("renderCanvas");

const selectedDemo = ref("");
const initialized = ref(false);
const showHelp = ref(false);

const selectedProfile = ref("");
const profiles = ref<string[]>([]);
const showProfiles = ref(false);

const selectedEntrypoint = ref("");
const entrypoints = ref<string[]>([]);
const showEntrypoints = ref(false);

const printedText = ref("");
const device = ref<GPUDevice | null>(null);

const currentDisplayMode = ref<ShaderType>("imageMain");
const uniformComponents = ref<UniformController[]>([])

let pageLoaded = false;
let reflectionJson: any = {};


async function tryGetDevice() {
    if (!isWebGPUSupported()) {
        console.log('WebGPU is not supported in this browser');
        return null;
    }
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) {
        console.log('need a browser that supports WebGPU');
        return null;
    }
    const requiredFeatures: [] = [];

    let device = await adapter?.requestDevice({ requiredFeatures });
    if (!device) {
        console.log('need a browser that supports WebGPU');
        return null;
    }
    return device;
}

onBeforeMount(async () => {
    device.value = await tryGetDevice();
});

function updateProfileOptions() {
    const selectedTarget = targetSelect.value!.getValue();

    // If the selected target does not have any profiles, hide the profile dropdown.
    const profileData = targetProfileMap[selectedTarget] || null;
    if (!profileData) {
        profiles.value = [];
        showProfiles.value = false;
    }
    else {
        profiles.value = profileData.options;
        showProfiles.value = true;
        selectedProfile.value = profileData.default;
    }

    // If the target can be compiled as a whole program without entrypoint selection, hide the entrypoint dropdown.
    if (isWholeProgramTarget(selectedTarget)) {
        showEntrypoints.value = false;
    } else {
        showEntrypoints.value = true;
        updateEntryPointOptions();
    }
}

onMounted(async () => {
    updateProfileOptions();

    pageLoaded = true;
    if (!device) {
        logError(moduleLoadingMessage + "Browser does not support WebGPU, Run shader feature is disabled.");
    }
    runIfFullyInitialized();

    window.addEventListener('slangLoaded', runIfFullyInitialized);

    document.addEventListener('keydown', function (event) {
        if (event.key === 'F5') {
            event.preventDefault();
            compileOrRun();
        }
        else if (event.ctrlKey && event.key === 'b') {
            event.preventDefault();
            // Your custom code here
            onCompile();
        }
    });
})

async function onShare() {
    if (!codeEditor.value) {
        throw new Error("Code editor not initialized");
    };
    if (!shareButton.value) {
        throw new Error("Share button not initialized");
    };
    try {
        const code = codeEditor.value.getValue();
        const compressed = await compressToBase64URL(code);
        let url = new URL(window.location.href.split('?')[0]);
        const compileTarget = targetSelect.value!.getValue();
        url.searchParams.set("target", compileTarget)
        url.searchParams.set("code", compressed);
        navigator.clipboard.writeText(url.href);
        tooltip.value!.showTooltip(shareButton.value, "Link copied to clipboard.");
    }
    catch (e) {
        tooltip.value!.showTooltip(shareButton.value, "Failed to copy link to clipboard.");
    }
}

function loadDemo(selectedDemoURL: string) {
    if (selectedDemoURL != "") {
        // Is `selectedDemoURL` a relative path?
        let finalURL;
        if (!selectedDemoURL.startsWith("http")) {
            // If so, append the current origin to it.
            // Combine the url to point to demos/${selectedDemoURL}.
            finalURL = new URL("demos/" + selectedDemoURL, window.location.href);
        }
        else {
            finalURL = new URL(selectedDemoURL);
        }
        // Retrieve text from selectedDemoURL.
        fetch(finalURL)
            .then((response) => response.text())
            .then((data) => {
                codeEditor.value?.setEditorValue(data);
                updateEntryPointOptions();
                compileOrRun();
            });
    }
}

// Function to update the profile dropdown based on the selected target
function updateEntryPointOptions() {
    if (!compiler)
        return;
    entrypoints.value = compiler.findDefinedEntryPoints(codeEditor.value!.getValue());
    if ((selectedEntrypoint.value == "" || !entrypoints.value.includes(selectedEntrypoint.value)) && entrypoints.value.length > 0)
        selectedEntrypoint.value = entrypoints.value[0];
}

function compileOrRun() {
    const userSource = codeEditor.value!.getValue();
    const shaderType = checkShaderType(userSource);

    if (shaderType == null) {
        onCompile();
    }
    else {
        if (device.value == null) {
            onCompile().then(() => {
                if (diagnosticsArea.value?.getValue() == "")
                    diagnosticsArea.value.appendEditorValue(`The shader compiled successfully, ` +
                        `but it cannot run because your browser does not support WebGPU.\n` +
                        `WebGPU is supported in Chrome, Edge, Firefox Nightly and Safari Technology Preview. ` +
                        `On iOS, WebGPU support requires Safari 16.4 or later and must be enabled in settings. ` +
                        `Please check your browser version and enable WebGPU if possible.`);
            });
        }
        else {
            doRun();
        }
    }
}

export type CompiledPlayground = {
    slangSource: string,
    shader: Shader,
    mainEntryPoint: RunnableShaderType,
    resourceCommands: ResourceCommand[],
    callCommands: CallCommand[],
    uniformSize: number,
    uniformComponents: Ref<UniformController[]>,
}

function doRun() {
    if (!renderCanvas.value) {
        throw new Error("WebGPU is not supported in this browser");
    }
    const userSource = codeEditor.value!.getValue()

    // We will have some restrictions on runnable shader, the user code has to define imageMain or printMain function.
    // We will do a pre-filter on the user input source code, if it's not runnable, we will not run it.
    const shaderType = checkShaderType(userSource);
    if (shaderType == null) {
        toggleDisplayMode(null);
        codeGenArea.value?.setEditorValue("");
        throw new Error("Error: In order to run the shader, please define either imageMain or printMain function in the shader code.");
    }

    const entryPointName = shaderType;
    const ret = compileShader(userSource, entryPointName, "WGSL");

    if (!ret.succ) {
        toggleDisplayMode(null);
        return;
    }

    let resourceCommands = getResourceCommandsFromAttributes(ret.reflection);
    let uniformSize = getUniformSize(ret.reflection)
    uniformComponents.value = getUniformSliders(resourceCommands)

    let callCommands: CallCommand[] | null = null;
    try {
        callCommands = parseCallCommands(userSource, ret.reflection);
    }
    catch (error: any) {
        throw new Error("Error while parsing '//! CALL' commands: " + error.message);
    }

    if (compiler == null) {
        throw new Error("Could not get compiler");
    }
    toggleDisplayMode(compiler.shaderType);

    renderCanvas.value.onRun({
        slangSource: userSource,
        shader: ret,
        mainEntryPoint: entryPointName,
        resourceCommands,
        callCommands,
        uniformSize,
        uniformComponents: uniformComponents,
    });
}

// For the compile button action, we don't have restriction on user code that it has to define imageMain or printMain function.
// But if it doesn't define any of them, then user code has to define a entry point function name. Because our built-in shader
// have no way to call the user defined function, and compile engine cannot compile the source code.
async function onCompile() {

    toggleDisplayMode(null);
    const compileTarget = targetSelect.value!.getValue();

    await updateEntryPointOptions();

    if (selectedEntrypoint.value == "" && !isWholeProgramTarget(compileTarget)) {
        diagnosticsArea.value?.setEditorValue("Please select the entry point name");
        return;
    }

    if (compiler == null) throw new Error("Compiler doesn't exist");

    if (compileTarget == "SPIRV")
        await compiler.initSpirvTools();

    // compile the compute shader code from input text area
    const userSource = codeEditor.value!.getValue();
    compileShader(userSource, selectedEntrypoint.value, compileTarget);

    if (compiler.diagnosticsMsg.length > 0) {
        diagnosticsArea.value?.setEditorValue(compiler.diagnosticsMsg);
        return;
    }
}

function toggleDisplayMode(displayMode: ShaderType) {
    currentDisplayMode.value = displayMode;
}

export type Shader = {
    succ: true,
    code: string,
    layout: Bindings,
    hashedStrings: any,
    reflection: ReflectionJSON,
    threadGroupSize: { [key: string]: ThreadGroupSize },
};

export type MaybeShader = Shader | {
    succ: false
};

function compileShader(userSource: string, entryPoint: string, compileTarget: typeof compileTargets[number], includePlaygroundModule = true): MaybeShader {
    if (compiler == null) throw new Error("No compiler available");
    const compiledResult = compiler.compile(userSource, entryPoint, compileTarget);
    diagnosticsArea.value?.setEditorValue(compiler.diagnosticsMsg, true);

    // If compile is failed, we just clear the codeGenArea
    if (!compiledResult) {
        codeGenArea.value?.setEditorValue('Compilation returned empty result.');
        return { succ: false };
    }

    let [compiledCode, layout, hashedStrings, reflectionJsonObj, threadGroupSize] = compiledResult;
    reflectionJson = reflectionJsonObj;

    codeGenArea.value?.setEditorValue(compiledCode);
    codeGenArea.value?.setLanguage(targetLanguageMap[compileTarget]);

    // Update reflection info.
    window.$jsontree.setJson("reflectionDiv", reflectionJson);
    window.$jsontree.refreshAll();

    return { succ: true, code: compiledCode, layout: layout, hashedStrings: hashedStrings, reflection: reflectionJson, threadGroupSize: threadGroupSize };
}

function restoreSelectedTargetFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const target = urlParams.get('target');
    if (target) {
        if (!compileTargets.includes(target as any)) {
            diagnosticsArea.value?.setEditorValue("Invalid target specified in URL: " + target);
            return;
        }
        targetSelect.value!.setValue(target as any);
        updateProfileOptions();
    }
}

function restoreDemoOrCodeFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    let demo = urlParams.get('demo');
    if (demo) {
        if (!demo.endsWith(".slang"))
            demo += ".slang";
        selectedDemo.value = demo;
        loadDemo(demo);
        return true;
    }
    const code = urlParams.get('code');
    if (code) {
        decompressFromBase64URL(code).then((decompressed) => {
            codeEditor.value!.setEditorValue(decompressed);
            updateEntryPointOptions();
            compileOrRun();
        });
        return true;
    }
    return false;
}

async function runIfFullyInitialized() {
    if (compiler && slangd && pageLoaded && codeEditor.value) {
        (await import("./language-server")).initLanguageServer();

        initialized.value = true;

        restoreSelectedTargetFromURL();

        if (restoreDemoOrCodeFromURL()) { }
        else if (codeEditor.value.getValue() == "") {
            loadDemo(defaultShaderURL);
        }
        else {
            compileOrRun();
        }
    }
}

function logError(message: string) {
    diagnosticsArea.value?.appendEditorValue(message + "\n", true);
}
</script>

<template>
    <Tooltip ref="tooltip"></Tooltip>
    <Transition>
        <div id="loading-screen" v-if="!initialized">
            <img height="80px" src="./assets/slang-logo.svg" alt="Slang Logo" />
            <div id="loading-status-line">
                <div class="spinner"></div>
                <p class="loading-status" id="loadingStatusLabel">Loading Playground...</p>
            </div>
            <div id="progress-bar-container">
                <div class="progress-bar" id="progress-bar"></div>
            </div>
        </div>
    </Transition>
    <div class="mainContainer" v-show="initialized">
        <Splitpanes class="slang-theme">
            <Pane class="leftContainer" size="62">
                <div class="navbar">
                    <!-- Logo section -->
                    <div class="navbar-logo">
                        <a href="/" title="Return to home page."><img src="./assets/slang-logo.svg" alt="Logo"
                                class="logo-img" /></a>
                    </div>

                    <!-- Load Demo section -->
                    <div class="navbar-actions navbar-item">
                        <div class="navbar-group">
                            <select class="dropdown-select" id="demo-select" name="demo" aria-label="Load Demo"
                                v-model="selectedDemo" @change="loadDemo(selectedDemo)">
                                <option value="" disabled selected>Load Demo</option>
                                <option v-for="demo in demoList" :value="demo.url" :key="demo.url"
                                    :disabled="demo.url == ''">{{ demo.name }}
                                </option>
                            </select>
                        </div>
                    </div>

                    <!-- Run section -->
                    <div class="navbar-run navbar-item">
                        <button :disabled="device == null"
                            :title="device == null ? `Run shader feature is disabled because the current browser does not support WebGPU.` : `(F5) Compile and run the shader that provides either 'printMain' or 'imageMain'.);`"
                            @click="doRun()">&#9658;
                            Run</button>
                    </div>

                    <!-- Entry/Compile section -->
                    <div class="navbar-compile navbar-item">
                        <Selector :options="compileTargets" modelValue="SPIRV" name="target" aria-label="target"
                            ref="targetSelect" @change="updateProfileOptions"></Selector>

                        <select class="dropdown-select" name="profile" aria-label="profile" v-model="selectedProfile"
                            v-show="showProfiles">
                            <option v-for="profile in profiles" :value="profile" :key="profile">{{
                                profile }}</option>
                        </select>

                        <select class="dropdown-select" name="entrypoint" aria-label="Entrypoint"
                            :onfocus="updateEntryPointOptions" @onmousedown="updateEntryPointOptions"
                            v-model="selectedEntrypoint" v-show="showEntrypoints">
                            <option value="" disabled selected>Entrypoint</option>
                            <option v-for="entrypoint in entrypoints" :value="entrypoint" :key="entrypoint">{{
                                entrypoint }}</option>
                        </select>

                        <button id="compile-btn"
                            title='(Ctrl+B) Compile the shader to the selected target. Entrypoints needs to be marked with the `[shader("stage")]` attribute.'
                            @click="onCompile()">
                            Compile
                        </button>
                    </div>
                    <!-- Share button section -->
                    <div class="navbar-standalone-button-item">
                        <button class="svg-btn" title="Create sharable link" ref="shareButton" @click="onShare">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28px" height="28px" viewBox="0 0 64 64"
                                fill="currentColor">
                                <path
                                    d="M 9 9 L 9 14 L 9 54 L 51 54 L 56 54 L 55 42 L 51 42 L 51 49.095703 L 13 50 L 13.900391 14 L 21 14 L 21 10 L 9 9 z M 44 9 L 44 17.072266 C 29.919275 17.731863 19 23.439669 19 44 L 23 44 C 23 32.732824 29.174448 25.875825 44 25.080078 L 44 33 L 56 20.5 L 44 9 z">
                                </path>
                            </svg>
                        </button>
                    </div>

                    <!-- Help button section -->
                    <div class="navbar-standalone-button-item">
                        <button class="svg-btn" title="Show Help" @click="helpModal!.openHelp()">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28px" height="28px" viewBox="0 0 24 24"
                                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                                stroke-linejoin="round" class="feather feather-help-circle">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                                <line x1="12" y1="17" x2="12" y2="17" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="workSpace">
                    <Splitpanes horizontal>
                        <Pane size="80">
                            <MonacoEditor class="codingSpace" ref="codeEditor" @vue:mounted="runIfFullyInitialized()" />
                        </Pane>
                        <Pane>
                            <MonacoEditor class="diagnosticSpace" ref="diagnostics" readOnlyMode />
                        </Pane>
                    </Splitpanes>
                </div>
            </Pane>
            <Pane class="rightContainer">
                <Splitpanes horizontal class="resultSpace">
                    <Pane class="outputSpace" size="69" v-if="device != null" v-show="currentDisplayMode != null">
                        <div id="renderOutput" v-show="currentDisplayMode == 'imageMain'">
                            <RenderCanvas :device="device" @log-error="logError"
                                @log-output="(log) => { printedText = log }" ref="renderCanvas"></RenderCanvas>
                        </div>
                        <textarea readonly class="printSpace"
                            v-show="currentDisplayMode == 'printMain'">{{ printedText }}</textarea>
                    </Pane>
                    <Pane class="codeGenSpace">
                        <TabContainer>
                            <Tab name="code" label="Target Code">
                                <MonacoEditor ref="codeGenArea" readOnlyMode />
                            </Tab>

                            <Tab name="reflection" label="Reflection">
                                <ReflectionView />
                            </Tab>

                            <Tab name="uniform" label="Uniforms"
                                v-if="currentDisplayMode == 'imageMain' && uniformComponents.length > 0">
                                <div class="uniformPanel">
                                    <div v-for="uniformComponent in uniformComponents">
                                        <Slider v-if="uniformComponent.type == 'slider'" :name="uniformComponent.name"
                                            v-model:value="uniformComponent.value" :min="uniformComponent.min"
                                            :max="uniformComponent.max"/>
                                        <Colorpick v-if="uniformComponent.type == 'color pick'" :name="uniformComponent.name"
                                            v-model:value="uniformComponent.value"/>
                                    </div>
                                </div>
                            </Tab>
                        </TabContainer>
                    </Pane>
                </Splitpanes>
            </Pane>
        </Splitpanes>
    </div>
    <Help v-show="showHelp" ref="helpModal"></Help>
</template>

<style scoped>
#renderOutput {
    display: block;
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
}

#loading-screen.v-leave-active {
    transition: opacity 0.5s ease;
}

#loading-screen.v-leave-to {
    opacity: 0;
}

.resultSpace.splitpanes .splitpanes__pane {
    transition: none !important;
    overflow: hidden;
}

.resultSpace [style*="display: none"]~.splitpanes__splitter~div {
    height: 100% !important;
}

.uniformPanel {
    background-color: var(--code-editor-background);
    height: 100%
}
</style>
