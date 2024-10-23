
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

    constructor(module)
    {
        this.slangWasmModule = module;
        this.diagnosticsMsg = "";
        this.shaderType = SlangCompiler.NON_RUNNABLE_SHADER;
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
                this.diagnosticsMsg += "Warning: Only entrypoint with name 'imageMain' or 'printMain' is runnable, ";
                this.diagnosticsMsg += "please correct the entrypoint name and run it.\n";
                this.diagnosticsMsg += "Otherwise specify the entrypoint name in 'Compile Option' and only compile it\n";
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

            var module = slangSession.loadModuleFromSource(shaderSource);
            if(!module) {
                var error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg+=(error.type + " error: " + error.message);
                return null;
            }

            // If no entrypoint is specified, try to find a runnable entry point
            var entryPoint = this.findEntryPoint(module, entryPointName, stage);
            if(!entryPoint) {
                return null;
            }

            var components = new this.slangWasmModule.ComponentTypeList();
            components.push_back(module);
            components.push_back(entryPoint);
            var program = slangSession.createCompositeComponentType(components);
            var linkedProgram = program.link();
            var wgslCode =
                linkedProgram.getEntryPointCode(
                    0 /* entryPointIndex */, 0 /* targetIndex */
                );
            if(wgslCode == "") {
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
            return wgslCode;
        }
    }
};
