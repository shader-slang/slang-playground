<script setup lang="ts">
import TabContainer from './components/ui/TabContainer.vue'
import Tab from './components/ui/Tab.vue'
import Selector from './components/ui/Selector.vue'
import Tooltip from './components/ui/Tooltip.vue'
import Slider from './components/ui/Slider.vue'
import Help from './components/Help.vue'
import RenderCanvas from './components/RenderCanvas.vue'
import { compiler, checkShaderType, slangd, moduleLoadingMessage } from './try-slang'
import { computed, defineAsyncComponent, onBeforeMount, onMounted, ref, reactive, nextTick, useTemplateRef, watch, type Ref } from 'vue'
import { isWholeProgramTarget, type Bindings, type ReflectionJSON, type RunnableShaderType, type ShaderType } from './compiler'
import { demoList } from './demo-list'
import { compressToBase64URL, decompressFromBase64URL, getResourceCommandsFromAttributes, getUniformSize, getUniformControllers, isWebGPUSupported, parseCallCommands, type CallCommand, type HashedStringData, type ResourceCommand, type UniformController, isControllerRendered } from './util'
import { userCodeURI } from './language-server'
import type { ThreadGroupSize } from './slang-wasm'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import ReflectionView from './components/ReflectionView.vue'
import Colorpick from './components/ui/Colorpick.vue'
import { useWindowSize } from '@vueuse/core'

/**
 * Convert GitHub blob URLs into raw.githubusercontent URLs for direct fetch.
 */
function normalizeGitHubUrl(input: string): string {
  try {
    const m = input.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (m) {
      const [, user, repo, branch, path] = m;
      return `https://raw.githubusercontent.com/${user}/${repo}/refs/heads/${branch}/${path}`;
    }
  } catch {
    // ignore
  }
  return input;
}

// Cache Talos JWT bearer token during session so user is only prompted once
let talosBearerToken: string | null = null;

async function fetchTextFromUrl(finalURL: URL): Promise<string> {
  if (finalURL.hostname.endsWith('talos.nvidia.com') &&
      (finalURL.pathname.startsWith('/api/v1/contents') || finalURL.pathname.startsWith('/contents/'))) {
    // Support Talos UI paths (/contents/...) by rewriting to the API with matrix params
    let requestURL = finalURL
    if (finalURL.pathname.startsWith('/contents/')) {
      const matrix = ';start=0;limit=9223372036854776000;q=.*;q-lang=pcre;truncate-length=100000'
      const filePath = finalURL.pathname.substring('/contents'.length)
      requestURL = new URL(`${finalURL.protocol}//${finalURL.host}/api/v1/contents${matrix}${filePath}`)
    }
    if (!talosBearerToken) {
      talosBearerToken = window.prompt('Enter Talos NVAuth JWT Bearer token')
    }
    if (!talosBearerToken) throw new Error('No Talos token provided')
    const authResp = await fetch(requestURL.toString(), { headers: { Authorization: `Bearer ${talosBearerToken}` } })
    if (!authResp.ok) throw new Error(`HTTP ${authResp.status} ${authResp.statusText}`)
    const data: any = await authResp.json()
    if (Array.isArray(data.results)) {
      return data.results.map((r: any) => r.content || '').join('\n')
    }
    if (Array.isArray(data.lines)) {
      return data.lines.map((l: any) => typeof l === 'string' ? l : (l.text || '')).join('\n')
    }
    if (typeof data.content === 'string') {
      return data.content
    }
    return JSON.stringify(data, null, 2)
  }
  const resp = await fetch(finalURL.toString())
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
  return await resp.text()
}

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
    "CUDA",
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
    "CUDA": "cuda",
};

const codeGenArea = useTemplateRef("codeGenArea");

const tabContainer = useTemplateRef("tabContainer");
const editorTabContainer = useTemplateRef("editorTabContainer");

const shareButton = useTemplateRef("shareButton");
const tooltip = useTemplateRef("tooltip");
const helpModal = useTemplateRef("helpModal");
const targetSelect = useTemplateRef("targetSelect");
const renderCanvas = useTemplateRef("renderCanvas");

const selectedDemo = ref("");
const contentSource = ref<'demo' | 'user-code' | 'url'>('user-code');
const fileURL = ref('');
const initialized = ref(false);
const showHelp = ref(false);

const selectedProfile = ref("");
const profiles = ref<string[]>([]);
const showProfiles = ref(false);

const selectedEntrypoint = ref("");
const entrypoints = ref<string[]>([]);
const showEntrypoints = ref(false);

const printedText = ref("");
const diagnosticsText = ref("");
watch(diagnosticsText, (newText, _) => {
    if (newText != "") {
        tabContainer.value?.setActiveTab("diagnostics")
    }
})
const device = ref<GPUDevice | null>(null);

const currentDisplayMode = ref<ShaderType>("imageMain");
const uniformComponents = ref<UniformController[]>([])
const areAnyUniformsRendered = computed(() => uniformComponents.value.filter(isControllerRendered).length > 0);


// Track window width for small-screen layout
const { width } = useWindowSize()
const isSmallScreen = computed(() => width.value < 768)
const smallScreenEditorVisible = ref(false);

// Editor tabs state: default user/common tabs plus imported files
interface FileTab { name: string; label: string; uri: string; content: string }
const fileTabs = ref<FileTab[]>([
  { name: 'user', label: 'user.slang', uri: userCodeURI, content: '' }
])
// Map of MonacoEditor component refs keyed by tab.name
const editorRefs = reactive<Record<string, any>>({})

// Convenience ref for legacy API (user) to drive demos and compile/run
const codeEditor = computed(() => editorRefs[fileTabs.value[0].name])

/**
 * Import .slang from URL into the current tab (with overwrite warning if name matches)
 */
async function importIntoCurrentTab() {
  const inputURL = window.prompt('Enter URL to import (.slang file)')
  if (!inputURL) return
  const finalURL = new URL(normalizeGitHubUrl(inputURL), window.location.href)
  let text: string
  try {
    text = await fetchTextFromUrl(finalURL)
  } catch (err: any) {
    diagnosticsText.value = `Failed to import file from URL:\n${err.message}`
    return
  }
  // Overwrite the content of the currently active tab
  const curName = editorTabContainer.value!.activeTab
  const curTab = fileTabs.value.find(t => t.name === curName)!
  curTab.content = text
  editorRefs[curName]?.setEditorValue(text)
}

/**
 * Import .slang from URL into a new tab (with overwrite warning if name matches)
 */
async function importIntoNewTab() {
  const inputURL = window.prompt('Enter URL to import (.slang file)')
  if (!inputURL) return
  const finalURL = new URL(normalizeGitHubUrl(inputURL), window.location.href)
  let text: string
  try {
    text = await fetchTextFromUrl(finalURL)
  } catch (err: any) {
    diagnosticsText.value = `Failed to import file from URL:\n${err.message}`
    return
  }
  const fileName = finalURL.pathname.split('/').pop() || inputURL
  const existing = fileTabs.value.find(t => t.label === fileName)
  if (existing) {
    if (!window.confirm(`Tab "${fileName}" exists; overwrite?`)) return
    existing.content = text
    editorRefs[existing.name]?.setEditorValue(text)
    editorTabContainer.value!.setActiveTab(existing.name)
    return
  }
  const newName = fileName.replace(/\W+/g, '_')
  fileTabs.value.push({ name: newName, label: fileName, uri: `file:///${fileName}`, content: text })
  await nextTick()
  editorTabContainer.value!.setActiveTab(newName)
  editorRefs[newName]?.setEditorValue(text)
}

const pageLoaded = ref(false);
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

/**
 * Load shader source from external URL and update editor.
 */

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
    pageLoaded.value = true;
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
            onCompile();
        }
    });
    editorTabContainer.value?.setActiveTab("user");
})

async function onShare() {
    if (!shareButton.value) {
        throw new Error("Share button not initialized");
    }
    try {
        const url = new URL(window.location.href.split('?')[0]);
        const compileTarget = targetSelect.value!.getValue();
        url.searchParams.set('target', compileTarget);

        if (contentSource.value === 'demo') {
            url.searchParams.set('demo', selectedDemo.value);
        } else if (contentSource.value === 'url') {
            url.searchParams.set('file', fileURL.value);
        } else {
            // Share all editor tabs (including imported files)
            const files = fileTabs.value.map(tab => ({
                name: tab.label,
                content: editorRefs[tab.name]?.getValue() ?? ''
            }));
            const sharePayload = JSON.stringify({ files });
            const compressed = await compressToBase64URL(sharePayload);
            url.searchParams.set('code', compressed);
        }

        await navigator.clipboard.writeText(url.href);
        tooltip.value!.showTooltip(shareButton.value, 'Link copied to clipboard.');
    } catch (e) {
        tooltip.value!.showTooltip(shareButton.value, 'Failed to copy link to clipboard.');
    }
}

function loadDemo(selectedDemoURL: string) {
    if (selectedDemoURL != "") {
        contentSource.value = 'demo';
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
        .then(async (data) => {
                if (selectedDemoURL.endsWith("module-from-url.slang")) {
                    data = await runURLImports(data);
                    // Activate the newly imported module tab
                    await nextTick();
                    const tabs = fileTabs.value;
                    if (tabs.length > 2) {
                        editorTabContainer.value?.setActiveTab(tabs[tabs.length - 1].name);
                    }
                }
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
                if (diagnosticsText.value == "")
                    diagnosticsText.value += `The shader compiled successfully, ` +
                        `but it cannot run because your browser does not support WebGPU.\n` +
                        `WebGPU is supported in Chrome, Edge, Firefox Nightly and Safari Technology Preview. ` +
                        `On iOS, WebGPU support requires Safari 16.4 or later and must be enabled in settings. ` +
                        `Please check your browser version and enable WebGPU if possible.`;
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

async function doRun() {
    try {
        await tryRun();
    } catch (e: any) {
        diagnosticsText.value = e.message;
    }
}

/**
 * Scan the source for URL-based module void-declarations, fetch each exactly once,
 * populate FS and editor tabs, strip out the declarations, and return cleaned source.
 */
const fetchedURLModules = new Set<string>();
async function runURLImports(sourceText: string): Promise<string> {
    const urlImportRe = /\[playground::URL\(\s*"([^"]+)"\s*\)\]\s*void\s+([A-Za-z_]\w*)\s*\(\s*\)\s*;/g;
    let cleaned = sourceText;
    let m: RegExpExecArray | null;
    while ((m = urlImportRe.exec(sourceText)) !== null) {
        const [, urlStr, modName] = m;
        const finalURL = new URL(normalizeGitHubUrl(urlStr), window.location.href);
        const key = finalURL.toString();
        if (!fetchedURLModules.has(key)) {
            fetchedURLModules.add(key);
            let modText: string;
            try {
                modText = await fetchTextFromUrl(finalURL);
            } catch (err: any) {
                throw new Error(`Failed to fetch module ${modName} from ${urlStr}: ${err.message}`);
            }
            const fileName = finalURL.pathname.split('/').pop() || `${modName}.slang`;
            const existing = fileTabs.value.find(t => t.label === fileName);
            let tabName: string;
            if (existing) {
                existing.content = modText;
                tabName = existing.name;
            } else {
                tabName = fileName.replace(/\W+/g, '_');
                fileTabs.value.push({ name: tabName, label: fileName, uri: `file:///${fileName}`, content: modText });
                await nextTick();
            }
            editorRefs[tabName]?.setEditorValue(modText);
            try {
                compiler?.slangWasmModule.FS.writeFile(
                    new URL(fileTabs.value.find(t => t.name === tabName)!.uri).pathname,
                    modText
                );
            } catch {}
        }
        cleaned = cleaned.replace(m[0], '');
    }
    return cleaned;
}

async function tryRun() {
    smallScreenEditorVisible.value = false;

    if (!renderCanvas.value) {
        throw new Error("WebGPU is not supported in this browser");
    }
    // Use current editor text for shader source
    const userSource = codeEditor.value!.getValue();

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
    uniformComponents.value = getUniformControllers(resourceCommands)

    if (areAnyUniformsRendered.value) {
        tabContainer.value?.setActiveTab("uniforms")
    }

    let callCommands: CallCommand[] | null = null;
    try {
        callCommands = parseCallCommands(ret.reflection);
    }
    catch (error: any) {
        throw new Error("Error while parsing CALL commands: " + error.message);
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
    smallScreenEditorVisible.value = false;

    toggleDisplayMode(null);
    const compileTarget = targetSelect.value!.getValue();

    await updateEntryPointOptions();

    if (selectedEntrypoint.value == "" && !isWholeProgramTarget(compileTarget)) {
        diagnosticsText.value = "Please select the entry point name";
        return;
    }

    if (compiler == null) throw new Error("Compiler doesn't exist");

    if (compileTarget == "SPIRV")
        await compiler.initSpirvTools();

    // compile the compute shader code from input text area
    // Module-from-url directive is handled natively by Slang; compile directly
    const userSource = codeEditor.value!.getValue();
    compileShader(userSource, selectedEntrypoint.value, compileTarget);

    if (compiler.diagnosticsMsg.length > 0) {
        diagnosticsText.value = compiler.diagnosticsMsg;
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
    hashedStrings: HashedStringData,
    reflection: ReflectionJSON,
    threadGroupSizes: { [key: string]: [number, number, number] },
};

export type MaybeShader = Shader | {
    succ: false
};

function compileShader(userSource: string, entryPoint: string, compileTarget: typeof compileTargets[number]): MaybeShader {
    if (compiler == null) throw new Error("No compiler available");
    const compiledResult = compiler.compile(userSource, entryPoint, compileTarget, device.value == null);
    diagnosticsText.value = compiler.diagnosticsMsg;

    // If compile is failed, we just clear the codeGenArea
    if (!compiledResult) {
        codeGenArea.value?.setEditorValue('Compilation returned empty result.');
        return { succ: false };
    }

    let [compiledCode, layout, hashedStrings, reflectionJsonObj, threadGroupSizes] = compiledResult;
    reflectionJson = reflectionJsonObj;

    codeGenArea.value?.setEditorValue(compiledCode);
    codeGenArea.value?.setLanguage(targetLanguageMap[compileTarget]);

    // Update reflection info.
    window.$jsontree.setJson("reflectionDiv", reflectionJson);
    window.$jsontree.refreshAll();

    return { succ: true, code: compiledCode, layout: layout, hashedStrings, reflection: reflectionJson, threadGroupSizes };
}

/**
 * Load shader source from external URL into the user.slang tab.
 */
async function loadFromURL(inputURL: string) {
  try {
    const finalURL = new URL(normalizeGitHubUrl(inputURL), window.location.href);
        const resp = await fetch(finalURL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const data = await resp.text();
        diagnosticsText.value = '';
        codeEditor.value?.setEditorValue(data);
        updateEntryPointOptions();
        compileOrRun();
    } catch (err: any) {
        diagnosticsText.value = `Failed to load shader from URL:\n${inputURL}\nError: ${err.message}`;
    }
}

function restoreFromURL(): boolean {
    const urlParams = new URLSearchParams(window.location.search);
    const target = urlParams.get('target');
    if (target) {
        if (!compileTargets.includes(target as any)) {
            diagnosticsText.value = "Invalid target specified in URL: " + target;
        } else {
            targetSelect.value!.setValue(target as any);
        }
    }

    updateProfileOptions();

    let gotCodeFromUrl = false;

    const fileParam = urlParams.get('file');
    if (fileParam) {
        selectedDemo.value = '';
        // Load user.slang from URL into first tab
        loadFromURL(fileParam);
        gotCodeFromUrl = true;
    }

    let demo = urlParams.get('demo');
    if (demo) {
        if (!demo.endsWith(".slang"))
            demo += ".slang";
        selectedDemo.value = demo;
        loadDemo(demo);
        gotCodeFromUrl = true;
    }

    const code = urlParams.get('code');
    if (code) {
        decompressFromBase64URL(code).then((decompressed) => {
            // Try JSON payload: files array or legacy user/common
            try {
                const data = JSON.parse(decompressed);
                if (data.files && Array.isArray(data.files)) {
                    // Restore dynamic tabs from shared payload
                    fileTabs.value = data.files.map((f: any) => {
                        const name = f.name.replace(/\W+/g, '_');
                        return { name, label: f.name, uri: `file:///${f.name}`, content: f.content };
                    });
                    nextTick(() => {
                        fileTabs.value.forEach(tab => {
                            editorRefs[tab.name]?.setEditorValue(tab.content);
                        });
                        updateEntryPointOptions();
                        compileOrRun();
                    });
                    return;
                }
                // Legacy payload: single user.slang
                if (data.user !== undefined) {
                    const tab0 = fileTabs.value[0];
                    tab0.content = data.user;
                    editorRefs[tab0.name]?.setEditorValue(data.user);
                } else {
                    const tab0 = fileTabs.value[0];
                    tab0.content = decompressed;
                    editorRefs[tab0.name]?.setEditorValue(decompressed);
                }
            } catch {
                const tab0 = fileTabs.value[0];
                tab0.content = decompressed;
                editorRefs[tab0.name]?.setEditorValue(decompressed);
            }
            updateEntryPointOptions();
            compileOrRun();
        });
        gotCodeFromUrl = true;
    }

    return gotCodeFromUrl;
}

async function runIfFullyInitialized() {
    // Wait until the first editor tab is available
    const firstTabName = fileTabs.value[0]?.name;
    if (compiler && slangd && pageLoaded && editorRefs[firstTabName]) {
        (await import("./language-server")).initLanguageServer();

        initialized.value = true;

        const gotCodeFromUrl = restoreFromURL();
        // Populate virtual FS with all open tabs so imports resolve
        fileTabs.value.forEach(tab => {
            try {
                compiler?.slangWasmModule.FS.writeFile(new URL(tab.uri).pathname, tab.content || '');
            } catch {}
        });
        if (!gotCodeFromUrl) {
            const firstContent = editorRefs[firstTabName].getValue();
            if (firstContent == "") {
                loadDemo(defaultShaderURL);
            } else {
                compileOrRun();
            }
        }
    }
}

function logError(message: string) {
    diagnosticsText.value += message + "\n";
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
        <Splitpanes class="slang-theme" v-show="!isSmallScreen">
            <Pane class="leftContainer" size="62">
                <div id="big-screen-navbar"></div>
                <div class="workSpace" id="big-screen-editor"></div>
            </Pane>
            <Pane class="rightContainer">
                <Splitpanes horizontal class="resultSpace">
                    <Pane class="outputSpace" size="69" v-if="device != null" v-show="currentDisplayMode != null">
                    </Pane>
                    <Pane class="codeGenSpace"></Pane>
                </Splitpanes>
            </Pane>
        </Splitpanes>
        <div id="small-screen-container" v-show="isSmallScreen">
            <div id="small-screen-navbar"></div>
            <Splitpanes horizontal class="resultSpace slang-theme" v-show="!smallScreenEditorVisible">
                <Pane id="small-screen-display" size="69" v-if="device != null" v-show="currentDisplayMode != null">
                </Pane>
                <Pane id="small-screen-code-gen"></Pane>
            </Splitpanes>
            <div id="small-screen-editor" v-show="smallScreenEditorVisible"></div>
        </div>
        <Teleport v-if="pageLoaded" defer :to="isSmallScreen ? '#small-screen-navbar' : '#big-screen-navbar'">
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

                <!-- Import buttons: into current tab / new tab -->
                <div class="navbar-standalone-button-item">
                    <button class="svg-btn" title="Import into current tab" @click="importIntoCurrentTab">
                        Import Here
                    </button>
                </div>
                <div class="navbar-standalone-button-item">
                    <button class="svg-btn" title="Import into new tab" @click="importIntoNewTab">
                        Import New
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
                <div class="navbar-standalone-button-item" v-show="isSmallScreen">
                    <button title="Toggle editor" @click="smallScreenEditorVisible = !smallScreenEditorVisible">
                        {{ smallScreenEditorVisible ? "View Results" : "View Source" }}
                    </button>
                </div>
            </div>
        </Teleport>
        <Teleport defer :to="isSmallScreen ? '#small-screen-display' : '.outputSpace'" v-if="device != null">
            <div id="renderOutput" v-show="currentDisplayMode == 'imageMain'">
                <RenderCanvas :device="device" @log-error="logError" @log-output="(log) => { printedText = log }"
                    ref="renderCanvas"></RenderCanvas>
            </div>
            <textarea readonly class="printSpace outputSpace"
                v-show="currentDisplayMode == 'printMain'">{{ printedText }}</textarea>
        </Teleport>
        <Teleport v-if="pageLoaded" defer :to="isSmallScreen ? '#small-screen-code-gen' : '.codeGenSpace'">
            <TabContainer ref="tabContainer">
                <Tab name="code" label="Target Code">
                    <MonacoEditor ref="codeGenArea" readOnlyMode modelUri="generated.slang" />
                </Tab>

                <Tab name="reflection" label="Reflection">
                    <ReflectionView />
                </Tab>

                <Tab name="uniforms" label="Uniforms"
                    v-if="currentDisplayMode == 'imageMain' && areAnyUniformsRendered">
                    <div class="uniformPanel">
                        <div v-for="uniformComponent in uniformComponents">
                            <Slider v-if="uniformComponent.type == 'SLIDER'" :name="uniformComponent.name"
                                v-model:value="uniformComponent.value" :min="uniformComponent.min"
                                :max="uniformComponent.max" />
                            <Colorpick v-if="uniformComponent.type == 'COLOR_PICK'" :name="uniformComponent.name"
                                v-model:value="uniformComponent.value" />
                        </div>
                    </div>
                </Tab>

                <Tab name="diagnostics" label="Diagnostics" v-if="diagnosticsText != ''">
                    <textarea readonly class="diagnosticSpace outputSpace">{{ diagnosticsText }}</textarea>
                </Tab>
            </TabContainer>
        </Teleport>
        <Teleport v-if="pageLoaded" defer :to="isSmallScreen ? '#small-screen-editor' : '#big-screen-editor'">
            <TabContainer ref="editorTabContainer">
                <Tab v-for="tab in fileTabs" :name="tab.name" :label="tab.label" :key="tab.name">
                    <MonacoEditor
                        class="codingSpace"
                        :ref="el => editorRefs[tab.name] = el"
                        :modelUri="tab.uri"
                        @vue:mounted="runIfFullyInitialized"
                        @change="(val) => { tab.content = val; if (tab.name === 'user') contentSource = 'user-code'; }"
                    />
                </Tab>
            </TabContainer>
        </Teleport>
    </div>
    <Help v-show="showHelp" ref="helpModal"></Help>
</template>

<style scoped>
#small-screen-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
}

#small-screen-editor {
    flex-grow: 1;
}

#small-screen-diagnostic {
    height: 250px;
}

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

.printSpace {
    margin-top: 10px;
}

.diagnosticSpace {
    padding-left: 10px;
}

.outputSpace {
    background-color: var(--code-editor-background);
    border: none;
    color: white;
    width: 100%;
    height: 100%;
}

.outputSpace:focus {
    outline: none;
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
    height: 100%;
    overflow-y: scroll;
}
</style>
