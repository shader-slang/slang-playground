function isWholeProgramTarget(compileTarget)
{
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

    if (dispatchThreadID.x >= width || dispatchThreadID.y >= height)
        return;

    float4 color = imageMain(dispatchThreadID.xy, int2(width, height));

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

    mainModules = new Map();

    // store the string hash if appears in the shader code
    hashedString = null;

    constructor(module)
    {
        this.slangWasmModule = module;
        this.diagnosticsMsg = "";
        this.shaderType = SlangCompiler.NON_RUNNABLE_SHADER;
        this.mainModules['imageMain'] = {source: imageMainSource};
        this.mainModules['printMain'] = {source: printMainSource};
        FS.createDataFile("/", "user.slang", "", true, true);
        FS.createDataFile("/", "playground.slang", "", true, true);
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

    // If user code defines imageMain or printMain, we will know the entry point name because they're
    // already defined in our pre-built module. So we will add those one of those entry points to the
    // dropdown list. Then, we will find whether user code also defines other entry points, if it has
    // we will also add them to the dropdown list.
    findDefinedEntryPoints(shaderSource)
    {
        var result = [];
        try {
            var slangSession = this.globalSlangSession.createSession(
                this.compileTargetMap.findCompileTarget("SPIRV"));
            if(!slangSession) {
                return [];
            }

            if (shaderSource.match("imageMain"))
                result.push("imageMain")

            if (shaderSource.match("printMain"))
                result.push("printMain")

            var module = slangSession.loadModuleFromSource(shaderSource, "user", "/user.slang");
            if(!module) {
                return result;
            }

            var count = module.getDefinedEntryPointCount();
            for (var i = 0; i < count; i++)
            {
                var entryPoint = module.getDefinedEntryPoint(i);
                const entryPointName = entryPoint.getName();

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

    // If user entrypoint name imageMain or printMain, we will load the pre-built main modules because they
    // are defined in those modules. Otherwise, we will only need to load the user module and find the entry
    // point in the user module.
    shouldLoadMainModule(entryPointName)
    {
        return entryPointName == "imageMain" || entryPointName == "printMain";
    }

    // Since we will not let user to change the entry point code, we can precompile the entry point module
    // and reuse it for every compilation.

    compileEntryPointModule(slangSession, moduleName)
    {
        var module = slangSession.loadModuleFromSource(this.mainModules[moduleName].source, moduleName, '/' + moduleName + '.slang');

        if (!module) {
            var error = this.slangWasmModule.getLastError();
            console.error(error.type + " error: " + error.message);
            this.diagnosticsMsg+=(error.type + " error: " + error.message);
            return null;
        }

        // we use the same entry point name as module name
        var entryPoint = this.findEntryPoint(module, moduleName, SlangCompiler.SLANG_STAGE_COMPUTE);
        if (!entryPoint)
            return null;

        return {module: module, entryPoint: entryPoint};

    }

    getPrecompiledProgram(slangSession, moduleName)
    {
        if (moduleName != "printMain" && moduleName != "imageMain")
            return null;

        let mainModule = this.compileEntryPointModule(slangSession, moduleName);

        this.shaderType = SlangCompiler.RENDER_SHADER;
        return mainModule;
    }

    addActiveEntryPoints(slangSession, shaderSource, entryPointName, isWholeProgram, userModule, componentList)
    {
        if (entryPointName == "" && !isWholeProgram)
        {
            this.diagnosticsMsg+=("error: No entry point specified");
            return false;
        }

        if (isWholeProgram)
            return false;

        // For now, we just don't allow user to define imageMain or printMain as entry point name for simplicity
        var count = userModule.getDefinedEntryPointCount();
        for (var i = 0; i < count; i++)
        {
            var name = userModule.getDefinedEntryPoint(i).getName();
            if (name == "imageMain" || name == "printMain")
            {
                this.diagnosticsMsg+=("error: Entry point name 'imageMain' or 'printMain' is reserved");
                return false;
            }
        }

        // If entry point is provided, we know for sure this is not a whole program compilation,
        // so we will just go to find the correct module to include in the compilation.
        if (entryPointName != "")
        {
            if (this.shouldLoadMainModule(entryPointName))
            {
                // we use the same entry point name as module name
                var mainProgram = this.getPrecompiledProgram(slangSession, entryPointName);
                if (!mainProgram)
                    return false;

                this.shaderType = entryPointName == "imageMain" ?
                    SlangCompiler.RENDER_SHADER : SlangCompiler.PRINT_SHADER;

                componentList.push_back(mainProgram.module);
                componentList.push_back(mainProgram.entryPoint);
            }
            else
            {
                // we know the entry point is from user module
                var entryPoint = this.findEntryPoint(userModule, entryPointName, SlangCompiler.SLANG_STAGE_COMPUTE);
                if (!entryPoint)
                    return false;

                componentList.push_back(entryPoint);
            }
        }
    }

    loadModule(slangSession, moduleName, source, componentTypeList)
    {
        var module = slangSession.loadModuleFromSource(source, moduleName, "/"+ moduleName + ".slang");
        if(!module) {
            var error = this.slangWasmModule.getLastError();
            console.error(error.type + " error: " + error.message);
            this.diagnosticsMsg+=(error.type + " error: " + error.message);
            return false;
        }
        componentTypeList.push_back(module);
        return true;
    }

    compile(shaderSource, entryPointName, compileTargetStr, stage)
    {
        this.diagnosticsMsg = "";
        if (this.hashedString)
        {
            this.hashedString.delete();
            this.hashedString = null;
        }

        const compileTarget = this.compileTargetMap.findCompileTarget(compileTargetStr);
        let isWholeProgram = isWholeProgramTarget(compileTargetStr);

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

            var components = new this.slangWasmModule.ComponentTypeList();

            let shouldLinkPlaygroundModule = (shaderSource.match(/printMain|imageMain/) != null);
            var userModuleIndex = 0;
            if (shouldLinkPlaygroundModule)
            {
                if (!this.loadModule(slangSession, "playground", playgroundSource, components))
                    return null;
                userModuleIndex++;
            }
            if (!this.loadModule(slangSession, "user", shaderSource, components))
                return null;
            if (!isWholeProgram)
            {
                if (this.addActiveEntryPoints(slangSession, shaderSource, entryPointName, isWholeProgram, components.get(userModuleIndex), components) == false)
                    return null;
            }
            var program = slangSession.createCompositeComponentType(components);
            var linkedProgram = program.link();
            this.hashedString = linkedProgram.loadStrings();

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

            if (outCode == "")
            {
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

            if (components)
            {
                for (let i = 0; i < components.size(); i++)
                {
                    components.get(i).delete();
                }
                components.delete();
            }

            if (slangSession) {
                slangSession.delete();
            }
            return outCode;
        }
    }
};
