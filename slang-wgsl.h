#pragma once

#include <slang.h>

namespace slang
{
namespace wgsl
{

class ComponentType
{

public:

    ComponentType(slang::IComponentType* interface) :
        m_interface(interface) {}

    // TODO: Diagnostics output
    ComponentType* link();

    std::string getEntryPointCode(int entryPointIndex, int targetIndex);

    slang::IComponentType* interface() const {return m_interface;}

    virtual ~ComponentType() = default;
    
private:

    Slang::ComPtr<slang::IComponentType> m_interface;

};

class EntryPoint : public ComponentType
{

public:

    EntryPoint(slang::IEntryPoint* interface) : ComponentType(interface) {} 
    
private:

    slang::IEntryPoint* entryPointInterface() const {
        return static_cast<slang::IEntryPoint*>(interface());
    }

};

class Module : public ComponentType
{

public:

    Module(slang::IModule* interface) : ComponentType(interface) {}
    
    EntryPoint* findEntryPointByName(const std::string& name);

    slang::IModule* moduleInterface() const {
        return static_cast<slang::IModule*>(interface());
    }

};

void createGlobalSession();

Module* loadModuleFromSource(const std::string& slangCode);

ComponentType*
createCompositeComponentType(const std::vector<ComponentType*>& components);


} // namespace wgsl
} // namespace slang
