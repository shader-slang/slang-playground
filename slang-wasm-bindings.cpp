#include "try-slang-external-includes-begin.h"
#include <emscripten/bind.h>
#include <slang-com-ptr.h>
#include "try-slang-external-includes-end.h"
#include "slang-wasm.h"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(slang)
{

    function(
        "createGlobalSession",
        &slang::wgsl::createGlobalSession
    );

    function(
        "createCompositeComponentType",
        &slang::wgsl::createCompositeComponentType,
        return_value_policy::take_ownership()
    );

    function(
        "loadModuleFromSource",
        &slang::wgsl::loadModuleFromSource,
        return_value_policy::take_ownership()
    );

    class_<slang::wgsl::ComponentType>("ComponentType")
        .function(
            "link",
            &slang::wgsl::ComponentType::link,
            return_value_policy::take_ownership()
        )
        .function(
            "getEntryPointCode",
            &slang::wgsl::ComponentType::getEntryPointCode
        );

    class_<slang::wgsl::Module, base<slang::wgsl::ComponentType>>("Module")
        .function(
            "findEntryPointByName",
            &slang::wgsl::Module::findEntryPointByName,
            return_value_policy::take_ownership()
        );

    class_<slang::wgsl::EntryPoint, base<slang::wgsl::ComponentType>>("EntryPoint");

    register_vector<slang::wgsl::ComponentType*>("ComponentTypeList");

}
