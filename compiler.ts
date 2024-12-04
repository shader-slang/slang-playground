function isWholeProgramTarget(compileTarget: string) {
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

type Bindings = Map<string, GPUBindGroupLayoutEntry>


class SlangCompiler {
    static SLANG_STAGE_VERTEX = 1;
    static SLANG_STAGE_FRAGMENT = 5;
    static SLANG_STAGE_COMPUTE = 6;

    static RENDER_SHADER = 0;
    static PRINT_SHADER = 1;
    static NON_RUNNABLE_SHADER = 2;

    globalSlangSession = null;
    slangSession = null;

    compileTargetMap: {name: string, value: unknown} | null = null;

    slangWasmModule;
    diagnosticsMsg;
    shaderType;

    spirvToolsModule = null;

    mainModules: Map<string, { source: string }> = new Map();

    constructor(module: any) {
        this.slangWasmModule = module;
        this.diagnosticsMsg = "";
        this.shaderType = SlangCompiler.NON_RUNNABLE_SHADER;
        this.mainModules.set('imageMain', { source: imageMainSource });
        this.mainModules.set('printMain', { source: printMainSource });
        FS.createDataFile("/", "user.slang", "", true, true);
        FS.createDataFile("/", "playground.slang", "", true, true);
    }

    init() {
        try {
            this.globalSlangSession = this.slangWasmModule.createGlobalSession();
            this.compileTargetMap = this.slangWasmModule.getCompileTargets();

            if (!this.globalSlangSession || !this.compileTargetMap) {
                var error = this.slangWasmModule.getLastError();
                return { ret: false, msg: (error.type + " error: " + error.message) };
            }
            else {
                return { ret: true, msg: "" };
            }
        } catch (e) {
            console.log(e);
            return { ret: false, msg: '' + e };
        }
    }

    findCompileTarget(compileTargetStr: string) {
        if(this.compileTargetMap == null)
            throw new Error("No compile targets to find")
        for (var i = 0; i < this.compileTargetMap.length; i++) {
            var target = this.compileTargetMap[i];
            if (target.name == compileTargetStr)
                return target.value;
        }
        return 0;
    }

    // In our playground, we only allow to run shaders with two entry points: renderMain and printMain
    findRunnableEntryPoint(module: { findAndCheckEntryPoint: (arg0: string, arg1: number) => any; }) {
        const runnableEntryPointNames = ['imageMain', 'printMain'];
        for (var i = 0; i < runnableEntryPointNames.length; i++) {
            var entryPointName = runnableEntryPointNames[i];
            var entryPoint = module.findAndCheckEntryPoint(entryPointName, SlangCompiler.SLANG_STAGE_COMPUTE);
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

    findEntryPoint(module: { findAndCheckEntryPoint: (arg0: any, arg1: any) => any; }, entryPointName: string | null, stage: number) {
        if (entryPointName == null || entryPointName == "") {
            var entryPoint = this.findRunnableEntryPoint(module);
            if (!entryPoint) {
                this.diagnosticsMsg += "Warning: The current shader code is not runnable because 'imageMain' or 'printMain' functions are not found.\n";
                this.diagnosticsMsg += "Use the 'Compile' button to compile it to different targets.\n";
            }
            return entryPoint;
        }
        else {
            var entryPoint = module.findAndCheckEntryPoint(entryPointName, stage);
            if (!entryPoint) {
                var error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }
            return entryPoint;
        }
    }

    async initSpirvTools() {
        if (!this.spirvToolsModule) {
            const spirvTools = import("./spirv-tools.js");
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
    findDefinedEntryPoints(shaderSource: string) {
        var result: any[] = [];
        if (shaderSource.match("imageMain")) {
            return ["imageMain"];
        }
        if (shaderSource.match("printMain")) {
            return ["printMain"];
        }

        try {
            var slangSession = this.globalSlangSession.createSession(
                this.findCompileTarget("SPIRV"));
            if (!slangSession) {
                return [];
            }
            var module = null;

            module = slangSession.loadModuleFromSource(shaderSource, "user", "/user.slang");
            if (!module) {
                return result;
            }

            var count = module.getDefinedEntryPointCount();
            for (var i = 0; i < count; i++) {
                var entryPoint = module.getDefinedEntryPoint(i);
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

    compileEntryPointModule(slangSession: { loadModuleFromSource: (arg0: any, arg1: any, arg2: string) => any; }, moduleName: string) {
        var module = slangSession.loadModuleFromSource(this.mainModules.get(moduleName)?.source, moduleName, '/' + moduleName + '.slang');

        if (!module) {
            var error = this.slangWasmModule.getLastError();
            console.error(error.type + " error: " + error.message);
            this.diagnosticsMsg += (error.type + " error: " + error.message);
            return null;
        }

        // we use the same entry point name as module name
        var entryPoint = this.findEntryPoint(module, moduleName, SlangCompiler.SLANG_STAGE_COMPUTE);
        if (!entryPoint)
            return null;

        return { module: module, entryPoint: entryPoint };

    }

    getPrecompiledProgram(slangSession: any, moduleName: string) {
        if (moduleName != "printMain" && moduleName != "imageMain")
            return null;

        let mainModule = this.compileEntryPointModule(slangSession, moduleName);

        this.shaderType = SlangCompiler.RENDER_SHADER;
        return mainModule;
    }

    addActiveEntryPoints(slangSession: any, shaderSource: any, entryPointName: string, isWholeProgram: boolean, userModule: { getDefinedEntryPointCount: () => any; getDefinedEntryPoint: (arg0: number) => { (): any; new(): any; getName: { (): any; new(): any; }; }; }, componentList: any[]) {
        if (entryPointName == "" && !isWholeProgram) {
            this.diagnosticsMsg += ("error: No entry point specified");
            return false;
        }

        // For now, we just don't allow user to define imageMain or printMain as entry point name for simplicity
        var count = userModule.getDefinedEntryPointCount();
        for (var i = 0; i < count; i++) {
            var entrypoint = userModule.getDefinedEntryPoint(i);
            var name = userModule.getDefinedEntryPoint(i).getName();
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
                var mainProgram = this.getPrecompiledProgram(slangSession, entryPointName);
                if (!mainProgram)
                    return false;

                this.shaderType = entryPointName == "imageMain" ?
                    SlangCompiler.RENDER_SHADER : SlangCompiler.PRINT_SHADER;

                componentList.push(mainProgram.module);
                componentList.push(mainProgram.entryPoint);
            }
            else {
                // we know the entry point is from user module
                var entryPoint = this.findEntryPoint(userModule, entryPointName, SlangCompiler.SLANG_STAGE_COMPUTE);
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
                    var mainProgram = this.getPrecompiledProgram(slangSession, results[i]);
                    if (!mainProgram)
                        return false;
                    componentList.push(mainProgram.module);
                    componentList.push(mainProgram.entryPoint);
                    return true;
                }
                else {
                    var entryPoint = this.findEntryPoint(userModule, results[i], SlangCompiler.SLANG_STAGE_COMPUTE);
                    if (!entryPoint)
                        return false;

                    componentList.push(entryPoint);
                }
            }
        }
        return true;
    }

    getBindingDescriptor(index: any, programReflection: { getGlobalParamsTypeLayout: () => any; }, parameter: { getName: () => string; }): BindingDescriptor {
        const globalLayout = programReflection.getGlobalParamsTypeLayout();

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
        throw new Error(`Binding type ${bindingType} not supported`)
    }

    getResourceBindings(linkedProgram: { getLayout: (arg0: number) => any; }): Bindings {
        const reflection = linkedProgram.getLayout(0); // assume target-index = 0

        const count = reflection.getParameterCount();

        var resourceDescriptors = new Map();
        for (let i = 0; i < count; i++) {
            const parameter = reflection.getParameterByIndex(i);
            const name = parameter.getName();
            var binding = {
                binding: parameter.getBindingIndex(),
                visibility: GPUShaderStage.COMPUTE,
            };

            const resourceInfo = this.getBindingDescriptor(parameter.getBindingIndex(), reflection, parameter);

            // extend binding with resourceInfo
            Object.assign(binding, resourceInfo);

            resourceDescriptors.set(name, binding);
        }

        return resourceDescriptors;
    }

    loadModule(slangSession: { loadModuleFromSource: (arg0: any, arg1: any, arg2: string) => any; }, moduleName: string, source: string, componentTypeList: any[]) {
        var module = slangSession.loadModuleFromSource(source, moduleName, "/" + moduleName + ".slang");
        if (!module) {
            var error = this.slangWasmModule.getLastError();
            console.error(error.type + " error: " + error.message);
            this.diagnosticsMsg += (error.type + " error: " + error.message);
            return false;
        }
        componentTypeList.push(module);
        return true;
    }

    compile(shaderSource: string, entryPointName: string, compileTargetStr: string): null | [any, Bindings, any, any, any] {
        this.diagnosticsMsg = "";

        let shouldLinkPlaygroundModule = (shaderSource.match(/printMain|imageMain/) != null);

        const compileTarget = this.findCompileTarget(compileTargetStr);
        let isWholeProgram = isWholeProgramTarget(compileTargetStr);

        if (!compileTarget) {
            this.diagnosticsMsg = "unknown compile target: " + compileTargetStr;
            return null;
        }

        try {
            let slangSession = this.globalSlangSession.createSession(compileTarget);
            if (!slangSession) {
                let error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }

            let components: any[] = [];

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
            let program = slangSession.createCompositeComponentType(components);
            let linkedProgram = program.link();
            let hashedStrings = linkedProgram.loadStrings();

            let outCode = null;
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
            const entryPointReflection = linkedProgram.getLayout(0).findEntryPointByName(entryPointName);
            let threadGroupSize = entryPointReflection ? entryPointReflection.getComputeThreadGroupSize() :
                { x: 1, y: 1, z: 1 };

            if (outCode == "") {
                let error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }

            let reflectionJson = linkedProgram.getLayout(0).toJsonObject();

            if (slangSession)
                slangSession.delete();
            if (!outCode || outCode == "")
                return null;

            return [outCode, bindings, hashedStrings, reflectionJson, threadGroupSize];
        } catch (e) {
            console.log(e);
            return null;
        }
    }
};
