'use strict';

var Slang;

var TrySlang = {
    iterate: function() {
        try {
            var slangCode = document.getElementById("input").value;
            var module = Slang.loadModuleFromSource(slangCode);
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
        Slang.createGlobalSession();
        TrySlang.iterate();
    },
};
