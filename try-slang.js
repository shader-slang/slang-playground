'use strict';

var Slang;

var TrySlang = {
    iterate: function() {

        try {
            var slangCode = document.getElementById("input").value;
            var module = Slang.loadModuleFromSource(slangCode);
            if(!module) {
                var error = Slang.error();
                console.error(error.type + " error: " + error.message);
                return;
            }
            var entryPoint = module.findEntryPointByName("computeMain");
            var components = new Slang.ComponentTypeList();
            components.push_back(module);
            components.push_back(entryPoint);
            var program = Slang.createCompositeComponentType(components);
            var linkedProgram = program.link();
            var wgslCode =
                linkedProgram.getEntryPointCode(
                    0 /* entryPointIndex */, 0 /* targetIndex */
                );
            if(wgslCode == "") {
                var error = Slang.error();
                console.error(error.type + " error: " + error.message);
                return;
            }
            document.getElementById("output").value = wgslCode;
        } finally {
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
        }
    },
};


var Module = {
    onRuntimeInitialized: function() {
        Slang = Module;
        if(Slang.createGlobalSession() != Slang.SLANG_OK) {
            console.error("Failed to create global session");
        }
        TrySlang.iterate();
    },
};
