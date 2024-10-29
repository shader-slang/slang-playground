function isWholeProgramTarget(compileTarget)
{
    return compileTarget == "METAL" || compileTarget == "SPIRV";
}

class SlangCompiler
{
    static SLANG_STAGE_VERTEX = 1;
    static SLANG_STAGE_FRAGMENT = 5;
    static SLANG_STAGE_COMPUTE = 6;

    static RENDER_SHADER = 0;
    static PRINT_SHADER = 1;
    static NON_RUNNABLE_SHADER = 2;

    globalSlangSession = null;
    slangSession = null;

    compileTargetMap = null;

    slangWasmModule;
    diagnosticsMsg;
    shaderType;

    spirvToolsModule = null;

    constructor(module)
    {
        this.slangWasmModule = module;
        this.diagnosticsMsg = "";
        this.shaderType = SlangCompiler.NON_RUNNABLE_SHADER;
        FS.createDataFile("/", "user.slang", "", true, true);
    }

    init()
    {
        try {
            this.globalSlangSession = this.slangWasmModule.createGlobalSession();
            this.compileTargetMap = this.slangWasmModule.getCompileTargets();

            if(!this.globalSlangSession || !this.compileTargetMap)
            {
                var error = this.slangWasmModule.getLastError();
                return {ret: false, msg: (error.type + " error: " + error.message)};
            }
            else
            {
                return {ret: true, msg: ""};
            }
        } catch (e) {
            console.log(e);
            return {ret: false, msg: '' + e};
        }
    }

    // In our playground, we only allow to run shaders with two entry points: renderMain and printMain
    findRunnableEntryPoint(module)
    {
        const runnableEntryPointNames = ['imageMain', 'printMain'];
        for (var i = 0; i < runnableEntryPointNames.length; i++)
        {
            var entryPointName = runnableEntryPointNames[i];
            var entryPoint = module.findAndCheckEntryPoint(entryPointName, SlangCompiler.SLANG_STAGE_COMPUTE);
            if(entryPoint)
            {
                if (i == 0)
                    this.shaderType = SlangCompiler.RENDER_SHADER;
                else
                    this.shaderType = SlangCompiler.PRINT_SHADER;
                return entryPoint;
            }
        }

        return null;
    }

    findEntryPoint(module, entryPointName, stage)
    {
        if (entryPointName == null || entryPointName == "")
        {
            var entryPoint = this.findRunnableEntryPoint(module);
            if (!entryPoint)
            {
                this.diagnosticsMsg += "Warning: The current shader code is not runnable because 'imageMain' or 'printMain' functions are not found.\n";
                this.diagnosticsMsg += "Use the 'Compile' button to compile it to different targets.\n";
            }
            return entryPoint;
        }
        else
        {
            var entryPoint = module.findAndCheckEntryPoint(entryPointName, stage);
            if(!entryPoint) {
                var error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }
            return entryPoint;
        }
    }

    async initSpirvTools()
    {
        if (!this.spirvToolsModule)
        {
            const spirvTools = BrowserCJS.require("./spirv-tools.js");
            this.spirvToolsModule = await spirvTools();
        }
    }

    spirvDisassembly(spirvBinary)
    {

        const disAsmCode = this.spirvToolsModule.dis(
                spirvBinary,
                this.spirvToolsModule.SPV_ENV_UNIVERSAL_1_3,
                this.spirvToolsModule.SPV_BINARY_TO_TEXT_OPTION_INDENT |
                this.spirvToolsModule.SPV_BINARY_TO_TEXT_OPTION_FRIENDLY_NAMES
            );


        if (disAsmCode == "Error")
        {
            this.diagnosticsMsg += ("SPIRV disassembly error");
            disAsmCode = "";
        }

        return disAsmCode;
    }

    findDefinedEntryPoints(shaderSource)
    {
        var result = [];
        try {
            var slangSession = this.globalSlangSession.createSession(
                this.compileTargetMap.findCompileTarget("SPIRV"));
            if(!slangSession) {
                return [];
            }

            var module = slangSession.loadModuleFromSource(shaderSource, "user", "/user.slang");
            if(!module) {
                return [];
            }

            var count = module.getDefinedEntryPointCount();
            for (var i = 0; i < count; i++)
            {
                var entryPoint = module.getDefinedEntryPoint(i);
                result.push(entryPoint.getName());
                entryPoint.delete();
            }
        } catch (e) {
            return [];
        }
        finally {
            if(module) {
                module.delete();
            }
            if (slangSession) {
                slangSession.delete();
            }
        }
        return result;
    }

    compile(shaderSource, entryPointName, compileTargetStr, stage)
    {
        this.diagnosticsMsg = "";
        const compileTarget = this.compileTargetMap.findCompileTarget(compileTargetStr);

        if(!compileTarget) {
            this.diagnosticsMsg = "unknown compile target: " + compileTargetStr;
            return null;
        }

        try {
            var slangSession = this.globalSlangSession.createSession(compileTarget);
            if(!slangSession) {
                var error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }

            var module = slangSession.loadModuleFromSource(shaderSource, "user", "/user.slang");
            if(!module) {
                var error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg+=(error.type + " error: " + error.message);
                return null;
            }

            var components = new this.slangWasmModule.ComponentTypeList();
            components.push_back(module);

            let isWholeProgram = isWholeProgramTarget(compileTargetStr);
            if (!isWholeProgram)
            {
                // If no entrypoint is specified, try to find a runnable entry point
                var entryPoint = this.findEntryPoint(module, entryPointName, stage);
                if(!entryPoint) {
                    return null;
                }

                components.push_back(entryPoint);
            }
            var program = slangSession.createCompositeComponentType(components);
            var linkedProgram = program.link();

            var outCode;
            if (compileTargetStr == "SPIRV")
            {
                const spirvCode = linkedProgram.getTargetCodeBlob(
                            0 /* targetIndex */
                );
                outCode = this.spirvDisassembly(spirvCode);
            }
            else
            {
                if (isWholeProgram)
                    outCode = linkedProgram.getTargetCode(0);
                else
                    outCode = linkedProgram.getEntryPointCode(
                        0 /* entryPointIndex */, 0 /* targetIndex */);
            }

            if(outCode == "") {
                var error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg += (error.type + " error: " + error.message);
                return null;
            }
        } catch (e) {
            console.log(e);
            return null;
        }
        finally {
            if(linkedProgram) {
                linkedProgram.delete();
            }
            if(program) {
                program.delete();
            }
            if(entryPoint) {
                entryPoint.delete();
            }
            if(module) {
                module.delete();
            }
            if (slangSession) {
                slangSession.delete();
            }
            return outCode;
        }
    }
};
