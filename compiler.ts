import {SpirvTools, default as spirvTools} from "./spirv-tools.js";
import { ModuleType } from './try-slang.js';
import type { ComponentType, EmbindString, GlobalSession, Module, ProgramLayout, Session, ThreadGroupSize, VariableLayoutReflection } from './slang-wasm.js';
import { playgroundSource } from "./playgroundShader.js";
declare let RequireJS: {
    require: typeof require
};

export function isWholeProgramTarget(compileTarget: string) {
    return compileTarget == "METAL" || compileTarget == "SPIRV";
}

const imageMainSource = `
import user;
import playground;

RWStructuredBuffer<int>             outputBuffer;

[format("rgba8")]
WTexture2D                          outputTexture;

[shader("compute")]
[numthreads(16, 16, 1)]
void imageMain(uint3 dispatchThreadID : SV_DispatchThreadID)
{
    uint width = 0;
    uint height = 0;
    outputTexture.GetDimensions(width, height);

    float4 color = imageMain(dispatchThreadID.xy, int2(width, height));

    if (dispatchThreadID.x >= width || dispatchThreadID.y >= height)
        return;

    outputTexture.Store(dispatchThreadID.xy, color);
}
`;


const printMainSource = `
import user;
import playground;

RWStructuredBuffer<int>               outputBuffer;

[format("rgba8")]
WTexture2D                          outputTexture;

[shader("compute")]
[numthreads(1, 1, 1)]
void printMain(uint3 dispatchThreadID : SV_DispatchThreadID)
{
    printMain();
}
`;
type BindingDescriptor = {
    storageTexture: {
        access: "write-only" | "read-write",
        format: GPUTextureFormat,
    }
} | {
    texture: {}
} | {
    buffer: {
        type: "uniform" | "storage"
    }
}

export type Bindings = Map<string, GPUBindGroupLayoutEntry>

export type ReflectionJSON = {
    "entryPoints": {
        "name": string,
        "semanticName": string,
        "type": unknown
    }[],
    "parameters": {
        "binding": unknown,
        "name": string,
        "type": unknown,
        "userAttribs"?: {
            "arguments": any[],
            "name": string,
        }[],
    }[],
}


export class SlangCompiler {
    static SLANG_STAGE_VERTEX = 1;
    static SLANG_STAGE_FRAGMENT = 5;
    static SLANG_STAGE_COMPUTE = 6;

    static RENDER_SHADER = 0;
    static PRINT_SHADER = 1;
    static NON_RUNNABLE_SHADER = 2;

    globalSlangSession: GlobalSession | null = null;
    // slangSession = null;

    compileTargetMap: { name: string, value: number }[] | null = null;

    slangWasmModule;
    diagnosticsMsg;
    shaderType;

    spirvToolsModule: SpirvTools | null = null;

    mainModules: Map<string, { source: EmbindString }> = new Map();

    constructor(module: ModuleType) {
        this.slangWasmModule = module;
        this.diagnosticsMsg = "";
        this.shaderType = SlangCompiler.NON_RUNNABLE_SHADER;
        this.mainModules.set('imageMain', { source: imageMainSource });
        this.mainModules.set('printMain', { source: printMainSource });
        FS.createDataFile("/", "user.slang", new DataView(new ArrayBuffer(0)), true, true, false);
        FS.createDataFile("/", "playground.slang", new DataView(new ArrayBuffer(0)), true, true, false);
    }

    init() {
        try {
            this.globalSlangSession = this.slangWasmModule.createGlobalSession();
            this.compileTargetMap = this.slangWasmModule.getCompileTargets();

            if (!this.globalSlangSession || !this.compileTargetMap) {
                const error = this.slangWasmModule.getLastError();
                return { ret: false, msg: (error.type + " error: " + error.message) };
            }
            else {
                return { ret: true, msg: "" };
            }
        } catch (e) {
            console.error(e);
            return { ret: false, msg: '' + e };
        }
    }

    findCompileTarget(compileTargetStr: string) {
        if (this.compileTargetMap == null)
            throw new Error("No compile targets to find")
        for (let i = 0; i < this.compileTargetMap.length; i++) {
            const target = this.compileTargetMap[i];
            if (target.name == compileTargetStr)
                return target.value;
        }
        return 0;
    }

    // In our playground, we only allow to run shaders with two entry points: renderMain and printMain
    findRunnableEntryPoint(module: Module) {
        const runnableEntryPointNames = ['imageMain', 'printMain'];
        for (let i = 0; i < runnableEntryPointNames.length; i++) {
            const entryPointName = runnableEntryPointNames[i];
            let entryPoint = module.findAndCheckEntryPoint(entryPointName, SlangCompiler.SLANG_STAGE_COMPUTE);
            if (entryPoint) {
                if (i == 0)
                    this.shaderType = SlangCompiler.RENDER_SHADER;
                else
                    this.shaderType = SlangCompiler.PRINT_SHADER;
                return entryPoint;
            }
        }

        return null;
    }

    findEntryPoint(module: Module, entryPointName: string | null, stage: number) {
        if (entryPointName == null || entryPointName == "") {
            const entryPoint = this.findRunnableEntryPoint(module);
            if (!entryPoint) {
                this.diagnosticsMsg += "Warning: The current shader code is not runnable because 'imageMain' or 'printMain' functions are not found.\n";
                this.diagnosticsMsg += "Use the 'Compile' button to compile it to different targets.\n";
            }
            return entryPoint;
        }
        else {
            const entryPoint = module.findAndCheckEntryPoint(entryPointName, stage);
            if (!entryPoint) {
                const error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }
            return entryPoint;
        }
    }

    async initSpirvTools() {
        if (!this.spirvToolsModule)
        {
            this.spirvToolsModule = await spirvTools();
        }
    }

    spirvDisassembly(spirvBinary: any) {
        if (!this.spirvToolsModule)
            throw new Error("Spirv tools not initialized")
        let disAsmCode = this.spirvToolsModule.dis(
            spirvBinary,
            this.spirvToolsModule.SPV_ENV_UNIVERSAL_1_3,
            this.spirvToolsModule.SPV_BINARY_TO_TEXT_OPTION_INDENT |
            this.spirvToolsModule.SPV_BINARY_TO_TEXT_OPTION_FRIENDLY_NAMES
        );


        if (disAsmCode == "Error") {
            this.diagnosticsMsg += ("SPIRV disassembly error");
            disAsmCode = "";
        }

        return disAsmCode;
    }

    // If user code defines imageMain or printMain, we will know the entry point name because they're
    // already defined in our pre-built module. So we will add those one of those entry points to the
    // dropdown list. Then, we will find whether user code also defines other entry points, if it has
    // we will also add them to the dropdown list.
    findDefinedEntryPoints(shaderSource: string): string[] {
        let result: string[] = [];
        if (shaderSource.match("imageMain")) {
            result.push("imageMain");
        }
        if (shaderSource.match("printMain")) {
            result.push("printMain");
        }
        let slangSession: Session | null | undefined;
        try {
            slangSession = this.globalSlangSession?.createSession(
                this.findCompileTarget("SPIRV"));
            if (!slangSession) {
                return [];
            }
            let module: Module | null = null;

            module = slangSession.loadModuleFromSource(shaderSource, "user", "/user.slang");
            if (!module) {
                return result;
            }

            const count = module.getDefinedEntryPointCount();
            for (let i = 0; i < count; i++) {
                const entryPoint = module.getDefinedEntryPoint(i);
                result.push(entryPoint.getName());
            }
        } catch (e) {
            return [];
        }
        finally {
            if (slangSession)
                slangSession.delete();
        }
        return result;
    }

    // If user entrypoint name imageMain or printMain, we will load the pre-built main modules because they
    // are defined in those modules. Otherwise, we will only need to load the user module and find the entry
    // point in the user module.
    shouldLoadMainModule(entryPointName: string) {
        return entryPointName == "imageMain" || entryPointName == "printMain";
    }

    // Since we will not let user to change the entry point code, we can precompile the entry point module
    // and reuse it for every compilation.

    compileEntryPointModule(slangSession: Session, moduleName: string) {
        let source = this.mainModules.get(moduleName)?.source;
        if(source == undefined) {
            throw new Error(`Could not get module ${moduleName}`)
        }
        let module: Module | null = slangSession.loadModuleFromSource(source, moduleName, '/' + moduleName + '.slang');

        if (!module) {
            const error = this.slangWasmModule.getLastError();
            console.error(error.type + " error: " + error.message);
            this.diagnosticsMsg += (error.type + " error: " + error.message);
            return null;
        }

        // we use the same entry point name as module name
        let entryPoint = this.findEntryPoint(module, moduleName, SlangCompiler.SLANG_STAGE_COMPUTE);
        if (!entryPoint)
            return null;

        return { module: module, entryPoint: entryPoint };

    }

    getPrecompiledProgram(slangSession: Session, moduleName: string) {
        if (moduleName != "printMain" && moduleName != "imageMain")
            return null;

        let mainModule = this.compileEntryPointModule(slangSession, moduleName);

        this.shaderType = SlangCompiler.RENDER_SHADER;
        return mainModule;
    }

    addActiveEntryPoints(slangSession: Session, shaderSource: string, entryPointName: string, isWholeProgram: boolean, userModule: Module, componentList: Module[]) {
        if (entryPointName == "" && !isWholeProgram) {
            this.diagnosticsMsg += ("error: No entry point specified");
            return false;
        }

        // For now, we just don't allow user to define imageMain or printMain as entry point name for simplicity
        const count = userModule.getDefinedEntryPointCount();
        for (let i = 0; i < count; i++) {
            const name = userModule.getDefinedEntryPoint(i).getName();
            if (name == "imageMain" || name == "printMain") {
                this.diagnosticsMsg += ("error: Entry point name 'imageMain' or 'printMain' is reserved");
                return false;
            }
        }

        // If entry point is provided, we know for sure this is not a whole program compilation,
        // so we will just go to find the correct module to include in the compilation.
        if (entryPointName != "") {
            if (this.shouldLoadMainModule(entryPointName)) {
                // we use the same entry point name as module name
                const mainProgram = this.getPrecompiledProgram(slangSession, entryPointName);
                if (!mainProgram)
                    return false;

                this.shaderType = entryPointName == "imageMain" ?
                    SlangCompiler.RENDER_SHADER : SlangCompiler.PRINT_SHADER;

                componentList.push(mainProgram.module);
                componentList.push(mainProgram.entryPoint);
            }
            else {
                // we know the entry point is from user module
                const entryPoint = this.findEntryPoint(userModule, entryPointName, SlangCompiler.SLANG_STAGE_COMPUTE);
                if (!entryPoint)
                    return false;

                componentList.push(entryPoint);
            }
        }
        // otherwise, it's a whole program compilation, we will find all active entry points in the user code
        // and pre-built modules.
        else {
            const results = this.findDefinedEntryPoints(shaderSource);
            for (let i = 0; i < results.length; i++) {
                if (results[i] == "imageMain" || results[i] == "printMain") {
                    const mainProgram = this.getPrecompiledProgram(slangSession, results[i]);
                    if (!mainProgram)
                        return false;
                    componentList.push(mainProgram.module);
                    componentList.push(mainProgram.entryPoint);
                    return true;
                }
                else {
                    const entryPoint = this.findEntryPoint(userModule, results[i], SlangCompiler.SLANG_STAGE_COMPUTE);
                    if (!entryPoint)
                        return false;

                    componentList.push(entryPoint);
                }
            }
        }
        return true;
    }

    getBindingDescriptor(index: number, programReflection: ProgramLayout, parameter: VariableLayoutReflection): BindingDescriptor|null {
        const globalLayout = programReflection.getGlobalParamsTypeLayout();

        if(globalLayout == null) {
            throw new Error("Could not get layout")
        }

        const bindingType = globalLayout.getDescriptorSetDescriptorRangeType(0, index);

        // Special case.. TODO: Remove this as soon as the reflection API properly reports write-only textures.
        if (parameter.getName() == "outputTexture") {
            return { storageTexture: { access: "write-only", format: "rgba8unorm" } };
        }

        if (bindingType == this.slangWasmModule.BindingType.Texture) {
            return { texture: {} };
        }
        else if (bindingType == this.slangWasmModule.BindingType.MutableTexture) {
            return { storageTexture: { access: "read-write", format: "r32float" } };
        }
        else if (bindingType == this.slangWasmModule.BindingType.ConstantBuffer) {
            return { buffer: { type: 'uniform' } };
        }
        else if (bindingType == this.slangWasmModule.BindingType.MutableTypedBuffer) {
            return { buffer: { type: 'storage' } };
        }
        else if (bindingType == this.slangWasmModule.BindingType.MutableRawBuffer) {
            return { buffer: { type: 'storage' } };
        }
        return null;
    }

    getResourceBindings(linkedProgram: ComponentType): Bindings {
        const reflection: ProgramLayout | null = linkedProgram.getLayout(0); // assume target-index = 0

        if(reflection == null) {
            throw new Error("Could not get reflection!")
        }

        const count = reflection.getParameterCount();

        let resourceDescriptors = new Map();
        for (let i = 0; i < count; i++) {
            const parameter = reflection.getParameterByIndex(i);
            if(parameter == null) {
                throw new Error("Invalid state!")
            }
            const name = parameter.getName();
            let binding = {
                binding: parameter.getBindingIndex(),
                visibility: GPUShaderStage.COMPUTE,
            };

            const resourceInfo = this.getBindingDescriptor(parameter.getBindingIndex(), reflection, parameter);

            // extend binding with resourceInfo
            if (resourceInfo)
                Object.assign(binding, resourceInfo);

            resourceDescriptors.set(name, binding);
        }

        return resourceDescriptors;
    }

    loadModule(slangSession: Session, moduleName: string, source: string, componentTypeList: Module[]) {
        let module: Module | null = slangSession.loadModuleFromSource(source, moduleName, "/" + moduleName + ".slang");
        if (!module) {
            const error = this.slangWasmModule.getLastError();
            console.error(error.type + " error: " + error.message);
            this.diagnosticsMsg += (error.type + " error: " + error.message);
            return false;
        }
        componentTypeList.push(module);
        return true;
    }

    compile(shaderSource: string, entryPointName: string, compileTargetStr: string): null | [string, Bindings, any, ReflectionJSON, ThreadGroupSize | {x: number, y: number, z: number}] {
        this.diagnosticsMsg = "";

        let shouldLinkPlaygroundModule = (shaderSource.match(/printMain|imageMain/) != null);

        const compileTarget = this.findCompileTarget(compileTargetStr);
        let isWholeProgram = isWholeProgramTarget(compileTargetStr);

        if (!compileTarget) {
            this.diagnosticsMsg = "unknown compile target: " + compileTargetStr;
            return null;
        }

        try {
            if(this.globalSlangSession == null) {
                throw new Error("Slang session not available. Maybe the compiler hasn't been initialized yet?")
            }
            let slangSession = this.globalSlangSession.createSession(compileTarget);
            if (!slangSession) {
                let error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }

            let components: Module[] = [];

            let userModuleIndex = 0;
            if (shouldLinkPlaygroundModule) {
                if (!this.loadModule(slangSession, "playground", playgroundSource, components))
                    return null;
                userModuleIndex++;
            }
            if (!this.loadModule(slangSession, "user", shaderSource, components))
                return null;
            if (this.addActiveEntryPoints(slangSession, shaderSource, entryPointName, isWholeProgram, components[userModuleIndex], components) == false)
                return null;
            let program: ComponentType = slangSession.createCompositeComponentType(components);
            let linkedProgram:ComponentType = program.link();
            let hashedStrings = linkedProgram.loadStrings();

            let outCode: string;
            if (compileTargetStr == "SPIRV") {
                const spirvCode = linkedProgram.getTargetCodeBlob(
                    0 /* targetIndex */
                );
                outCode = this.spirvDisassembly(spirvCode);
            }
            else {
                if (isWholeProgram)
                    outCode = linkedProgram.getTargetCode(0);
                else
                    outCode = linkedProgram.getEntryPointCode(
                        0 /* entryPointIndex */, 0 /* targetIndex */);
            }

            let bindings = this.getResourceBindings(linkedProgram);

            // Also read the shader work-group size.
            const entryPointReflection = linkedProgram.getLayout(0)?.findEntryPointByName(entryPointName);
            let threadGroupSize = entryPointReflection ? entryPointReflection.getComputeThreadGroupSize() :
                { x: 1, y: 1, z: 1 };

            if (outCode == "") {
                let error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }

            let reflectionJson = linkedProgram.getLayout(0)?.toJsonObject();

            if (slangSession)
                slangSession.delete();
            if (!outCode || outCode == "")
                return null;

            return [outCode, bindings, hashedStrings, reflectionJson, threadGroupSize];
        } catch (e) {
            console.error(e);
            // typescript is missing the type for WebAssembly.Exception
            if(typeof e === 'object' && e !== null && e.constructor.name === 'Exception') {
                this.diagnosticsMsg += "Slang internal error occurred.\n";
            } else if (e instanceof Error) {
                this.diagnosticsMsg += e.message;
            }
            return null;
        }
    }
};
