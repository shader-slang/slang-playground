
class SlangCompiler
{
    static SLANG_STAGE_VERTEX = 1;
    static SLANG_STAGE_FRAGMENT = 5;
    static SLANG_STAGE_COMPUTE = 6;

    globalSlangSession = null;
    slangSession = null;

    slangWasmModule;

    diagnosticsMsg;
    constructor(module)
    {
        this.slangWasmModule = module;
        this.diagnosticsMsg = "";
    }

    init()
    {
        try {
            this.globalSlangSession = this.slangWasmModule.createGlobalSession();
            if(!this.globalSlangSession)
            {
                var error = Slang.getLastError();
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
                return entryPoint;
            }
            else
            {
                var error = this.slangWasmModule.getLastError();
                console.error(error.type + " error: " + error.message);
                this.diagnosticsMsg+=(error.type + " error: " + error.message);
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
        }
    }

    compile(shaderSource, entryPointName, stage)
    {
        try {
            var slangSession = this.globalSlangSession.createSession();
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
