import { type SpirvTools, default as spirvTools } from "./spirv-tools.js";
import type { ComponentType, EmbindString, GlobalSession, MainModule, Module, ProgramLayout, Session, ThreadGroupSize, VariableLayoutReflection } from './slang-wasm.js';
import playgroundSource from "./slang/playground.slang?raw";
import imageMainSource from "./slang/imageMain.slang?raw";
import printMainSource from "./slang/printMain.slang?raw";
import { ACCESS_MAP, getTextureFormat, sizeFromFormat, webgpuFormatfromSlangFormat, type HashedStringData, type ScalarType, type SlangFormat } from "./util.js";

export function isWholeProgramTarget(compileTarget: string) {
    return compileTarget == "METAL" || compileTarget == "SPIRV" || compileTarget == "WGSL";
}

export const RUNNABLE_ENTRY_POINT_NAMES = ['imageMain', 'printMain'] as const;
export type RunnableShaderType = typeof RUNNABLE_ENTRY_POINT_NAMES[number];
export type ShaderType = RunnableShaderType | null;

const RUNNABLE_ENTRY_POINT_SOURCE_MAP: { [key in RunnableShaderType]: string } = {
    'imageMain': imageMainSource,
    'printMain': printMainSource,
};

export type Bindings = Map<string, GPUBindGroupLayoutEntry>;

export type ReflectionBinding = {
    "kind": "uniform",
    "offset": number,
    "size": number,
} | {
    "kind": "descriptorTableSlot",
    "index": number,
};

export type ReflectionType = {
    "kind": "struct",
    "name": string,
    "fields": ReflectionParameter[]
} | {
    "kind": "vector",
    "elementCount": 2 | 3 | 4,
    "elementType": ReflectionType,
} | {
    "kind": "scalar",
    "scalarType": ScalarType,
} | {
    "kind": "resource",
    "baseShape": "structuredBuffer",
    "access"?: "readWrite",
    "resultType": ReflectionType,
} | {
    "kind": "resource",
    "baseShape": "texture2D",
    "access"?: "readWrite" | "write",
    "resultType": ReflectionType,
};

export type ReflectionParameter = {
    "binding": ReflectionBinding,
    "format"?: SlangFormat,
    "name": string,
    "type": ReflectionType,
    "userAttribs"?: ReflectionUserAttribute[],
}

export type ReflectionJSON = {
    "entryPoints": ReflectionEntryPoint[],
    "parameters": ReflectionParameter[],
    "hashedStrings": { [str: string]: number },
};

export type ReflectionEntryPoint = {
    "name": string,
    "parameters": ReflectionParameter[],
    "stage": string,
    "threadGroupSize": [number, number, number],
    "userAttribs"?: ReflectionUserAttribute[],
};

export type ReflectionUserAttribute = {
    "arguments": (number | string)[],
    "name": string,
};


export class SlangCompiler {
    static SLANG_STAGE_VERTEX = 1;
    static SLANG_STAGE_FRAGMENT = 5;
    static SLANG_STAGE_COMPUTE = 6;

    globalSlangSession: GlobalSession | null = null;

    compileTargetMap: { name: string, value: number }[] | null = null;

    slangWasmModule: MainModule;
    diagnosticsMsg;
    shaderType: ShaderType;

    spirvToolsModule: SpirvTools | null = null;

    mainModules: Map<string, { source: EmbindString }> = new Map();

    constructor(module: MainModule) {
        this.slangWasmModule = module;
        this.diagnosticsMsg = "";
        this.shaderType = null;
        for (let runnableEntryPoint of RUNNABLE_ENTRY_POINT_NAMES) {
            this.mainModules.set(runnableEntryPoint, { source: RUNNABLE_ENTRY_POINT_SOURCE_MAP[runnableEntryPoint] });
        }

        module.FS.createDataFile("/", "user.slang", new DataView(new ArrayBuffer(0)), true, true, false);
        module.FS.createDataFile("/", "playground.slang", new DataView(new ArrayBuffer(0)), true, true, false);
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
            throw new Error("No compile targets to find");
        for (let i = 0; i < this.compileTargetMap.length; i++) {
            const target = this.compileTargetMap[i];
            if (target.name == compileTargetStr)
                return target.value;
        }
        return 0;
    }

    // In our playground, we only allow to run shaders with two entry points: renderMain and printMain
    findRunnableEntryPoint(module: Module) {
        for (let entryPointName of RUNNABLE_ENTRY_POINT_NAMES) {
            let entryPoint = module.findAndCheckEntryPoint(entryPointName, SlangCompiler.SLANG_STAGE_COMPUTE);
            if (entryPoint) {
                this.shaderType = entryPointName;
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
        if (!this.spirvToolsModule) {
            this.spirvToolsModule = await spirvTools();
        }
    }

    spirvDisassembly(spirvBinary: any) {
        if (!this.spirvToolsModule)
            throw new Error("Spirv tools not initialized");
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
        let runnable: string[] = [];
        for (let entryPointName of RUNNABLE_ENTRY_POINT_NAMES) {
            if (shaderSource.match(entryPointName)) {
                runnable.push(entryPointName);
            }
        }
        let slangSession: Session | null | undefined;
        try {
            slangSession = this.globalSlangSession?.createSession(
                this.findCompileTarget("SPIRV"));
            if (!slangSession) {
                return [];
            }
            let module: Module | null = null;
            if (runnable.length > 0) {
                slangSession.loadModuleFromSource(playgroundSource, "playground", "/playground.slang");
            }
            module = slangSession.loadModuleFromSource(shaderSource, "user", "/user.slang");
            if (!module) {
                const error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
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
        result.push(...runnable);
        return result;
    }

    // If user entrypoint name imageMain or printMain, we will load the pre-built main modules because they
    // are defined in those modules. Otherwise, we will only need to load the user module and find the entry
    // point in the user module.
    isRunnableEntryPoint(entryPointName: string): entryPointName is RunnableShaderType {
        return RUNNABLE_ENTRY_POINT_NAMES.includes(entryPointName as any);
    }

    // Since we will not let user to change the entry point code, we can precompile the entry point module
    // and reuse it for every compilation.

    compileEntryPointModule(slangSession: Session, moduleName: string) {
        let source = this.mainModules.get(moduleName)?.source;
        if (source == undefined) {
            throw new Error(`Could not get module ${moduleName}`);
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
        if (!this.isRunnableEntryPoint(moduleName))
            return null;

        let mainModule = this.compileEntryPointModule(slangSession, moduleName);

        this.shaderType = moduleName;
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
            if (this.isRunnableEntryPoint(name)) {
                this.diagnosticsMsg += `error: Entry point name ${name} is reserved`;
                return false;
            }
        }

        // If entry point is provided, we know for sure this is not a whole program compilation,
        // so we will just go to find the correct module to include in the compilation.
        if (entryPointName != "" && !isWholeProgram) {
            if (this.isRunnableEntryPoint(entryPointName)) {
                // we use the same entry point name as module name
                const mainProgram = this.getPrecompiledProgram(slangSession, entryPointName);
                if (!mainProgram)
                    return false;

                this.shaderType = entryPointName;

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
                if (this.isRunnableEntryPoint(results[i])) {
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

    getBindingDescriptor(name: string, parameterReflection: ReflectionParameter): Partial<GPUBindGroupLayoutEntry> {
        if (parameterReflection.type.kind == "resource") {
            if (parameterReflection.type.baseShape == "texture2D") {
                let slangAccess = parameterReflection.type.access;
                if (slangAccess == undefined) {
                    return { texture: {} };
                }
                let access = ACCESS_MAP[slangAccess];

                let scalarType: ScalarType;
                let componentCount: 1 | 2 | 3 | 4;
                if (parameterReflection.type.resultType.kind == "scalar") {
                    componentCount = 1;
                    scalarType = parameterReflection.type.resultType.scalarType;
                } else if (parameterReflection.type.resultType.kind == "vector") {
                    componentCount = parameterReflection.type.resultType.elementCount;
                    if (parameterReflection.type.resultType.elementType.kind != "scalar") throw new Error(`Unhandled inner type for ${name}`)
                    scalarType = parameterReflection.type.resultType.elementType.scalarType;
                } else {
                    throw new Error(`Unhandled inner type for ${name}`)
                }

                let format: GPUTextureFormat;
                if (parameterReflection.format) {
                    format = webgpuFormatfromSlangFormat(parameterReflection.format);
                } else {
                    try {
                        format = getTextureFormat(componentCount, scalarType, access);
                    } catch (e) {
                        if (e instanceof Error)
                            throw new Error(`Could not get texture format for ${name}: ${e.message}`)
                        else
                            throw new Error(`Could not get texture format for ${name}`)
                    }
                }

                return { storageTexture: { access, format } };
            } else if (parameterReflection.type.baseShape == "structuredBuffer") {
                return { buffer: { type: 'storage' } };
            } else {
                let _: never = parameterReflection.type;
                console.error(`Could not generate binding for ${name}`)
                return {}
            }
        } else if (parameterReflection.binding.kind == "uniform") {
            return { buffer: { type: 'uniform' } };
        } else {
            console.error(`Could not generate binding for ${name}`)
            return {}
        }
    }

    getResourceBindings(reflectionJson: ReflectionJSON): Bindings {
        let resourceDescriptors: Bindings = new Map();
        for (let parameter of reflectionJson.parameters) {
            const name = parameter.name;
            let binding = {
                binding: parameter.binding.kind == "descriptorTableSlot" ? parameter.binding.index : 0,
                visibility: GPUShaderStage.COMPUTE,
            };

            let parameterReflection = reflectionJson.parameters.find((p) => p.name == name)

            if (parameterReflection == undefined) {
                throw new Error("Could not find parameter in reflection JSON")
            }

            const resourceInfo = this.getBindingDescriptor(name, parameterReflection);

            // extend binding with resourceInfo
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

    compile(shaderSource: string, entryPointName: string, compileTargetStr: string, noWebGPU: boolean): null | [string, Bindings, HashedStringData, ReflectionJSON, { [key: string]: [number, number, number] }] {
        this.diagnosticsMsg = "";

        let shouldLinkPlaygroundModule = RUNNABLE_ENTRY_POINT_NAMES.some((entry_point) => shaderSource.match(entry_point) != null);

        const compileTarget = this.findCompileTarget(compileTargetStr);
        let isWholeProgram = isWholeProgramTarget(compileTargetStr);

        if (!compileTarget) {
            this.diagnosticsMsg = "unknown compile target: " + compileTargetStr;
            return null;
        }

        try {
            if (this.globalSlangSession == null) {
                throw new Error("Slang session not available. Maybe the compiler hasn't been initialized yet?");
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
            let linkedProgram: ComponentType = program.link();

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

            let reflectionJson: ReflectionJSON = linkedProgram.getLayout(0)?.toJsonObject();
            let hashedStrings: HashedStringData = reflectionJson.hashedStrings ? Object.fromEntries(Object.entries(reflectionJson.hashedStrings).map(entry => entry.reverse())) : {};

            let bindings: Bindings = noWebGPU ? new Map() : this.getResourceBindings(reflectionJson);

            // remove incorrect uniform bindings
            let has_uniform_been_binded = false;
            for (let parameterReflection of reflectionJson.parameters) {
                if (parameterReflection.binding.kind != "uniform") continue;

                has_uniform_been_binded = true;
                bindings.delete(parameterReflection.name);
            }

            if (has_uniform_been_binded) {
                bindings.set("uniformInput", {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                });
            }

            // Also read the shader work-group sizes.
            let threadGroupSizes: { [key: string]: [number, number, number] } = {};
            for (const entryPoint of reflectionJson.entryPoints) {
                threadGroupSizes[entryPoint.name] = entryPoint.threadGroupSize;
            }

            if (outCode == "") {
                let error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }

            if (slangSession)
                slangSession.delete();
            if (!outCode || outCode == "")
                return null;

            return [outCode, bindings, hashedStrings, reflectionJson, threadGroupSizes];
        } catch (e) {
            console.error(e);
            // typescript is missing the type for WebAssembly.Exception
            if (typeof e === 'object' && e !== null && e.constructor.name === 'Exception') {
                this.diagnosticsMsg += "Slang internal error occurred.\n";
            } else if (e instanceof Error) {
                this.diagnosticsMsg += e.message;
            }
            return null;
        }
    }
};