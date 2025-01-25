import { SlangCompiler, RUNNABLE_ENTRY_POINT_NAMES } from './compiler.js';
import { fetchWithProgress } from './util.js';

import type { LanguageServer, MainModule } from "./slang-wasm.js";

import type { PublicApi as JJsonPublicApi } from "jjsontree.js/src/ts/api.js"
declare global {
    let $jsontree: JJsonPublicApi
}

declare let RequireJS: {
    require: typeof require
};

export let compiler: SlangCompiler | null = null;
export let slangd: LanguageServer | null = null;

export let moduleLoadingMessage = "";

export function checkShaderType(userSource: string) {
    // we did a pre-filter on the user input source code.
    let shaderTypes = RUNNABLE_ENTRY_POINT_NAMES.filter((entryPoint) => userSource.includes(entryPoint));

    // Only one of the main function should be defined.
    // In this case, we will know that the shader is not runnable, so we can only compile it.
    if (shaderTypes.length !== 1)
        return null;

    return shaderTypes[0];
}

// Event when loading the WebAssembly module
type ReplaceReturnType<T extends (...a: any) => any, TNewReturn> = (...a: Parameters<T>) => TNewReturn;
export type ModuleType = MainModule & Omit<EmscriptenModule, "instantiateWasm"> & {
    instantiateWasm: ReplaceReturnType<EmscriptenModule["instantiateWasm"], Promise<WebAssembly.Exports>>
};

declare global {
    var Module: ModuleType
}

// Define the Module object with a callback for initialization
globalThis.Module = {
    locateFile: function (path: string) {
        if (path.endsWith('.wasm')) {
            return './slang-wasm.wasm'; // Use the gzip compressed file
        }
        return path;
    },
    instantiateWasm: async function (imports: WebAssembly.Imports, receiveInstance: (arg0: WebAssembly.Instance) => void): Promise<WebAssembly.Exports> {
        // Step 1: Fetch the compressed .wasm.gz file
        let progressBar = document.getElementById('progress-bar');
        const wasmBinary = await fetchWithProgress('./slang-wasm.wasm', (loaded, total) => {
            const progress = (loaded / total) * 100;
            if (progressBar == null) progressBar = document.getElementById('progress-bar');
            if (progressBar) progressBar.style.width = `${progress}%`;
        });

        // Step 3: Instantiate the WebAssembly module from the decompressed data
        const { instance } = await WebAssembly.instantiate(wasmBinary, imports);
        receiveInstance(instance);
        return instance.exports;
    },
    onRuntimeInitialized: function () {
        let label = document.getElementById("loadingStatusLabel");
        if (label)
            label.innerText = "Initializing Slang Compiler...";
        try {
            compiler = new SlangCompiler(globalThis.Module);
            let result = compiler.init();
            slangd = globalThis.Module.createLanguageServer();
            if (result.ret) {
                moduleLoadingMessage = "Slang compiler initialized successfully.\n";
                window.dispatchEvent(new CustomEvent('slangLoaded', {}));
            }
            else {
                console.log(result.msg);
                moduleLoadingMessage = "Failed to initialize Slang Compiler.\n";
                if (label)
                    label.innerText = moduleLoadingMessage;
            }
        }
        catch (error: any) {
            if (label)
                label.innerText = error.toString(error);
        }
    }
} satisfies Partial<ModuleType> as any;


RequireJS.require(["./src/slang-wasm.js"]);