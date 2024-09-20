#include "try-slang-external-includes-begin.h"
#include <vector>
#include <string>
#include <slang.h>
#include <slang-com-ptr.h>
#include "try-slang-external-includes-end.h"
#include "slang-wgsl.h"

using namespace slang;

namespace
{

    struct GlobalSession
    {
        slang::IGlobalSession* globalSession;
        slang::ISession* session;
    };

    class ComBaseObject
    {
    public:
        ComBaseObject& operator=(const ComBaseObject&) { return *this; }

        ComBaseObject(const ComBaseObject&)
            : m_refCount(0)
        {
        }

        ComBaseObject()
            : m_refCount(0)
        {
        }

        virtual ~ComBaseObject() {}

    protected:

        uint32_t _releaseImpl()
        {
            const uint32_t count = --m_refCount;
            if (count == 0)
            {
                delete this;
            }
            return count;
        }

        uint32_t m_refCount;
    };

    class BlobBase : public ISlangBlob, public ISlangCastable, public ComBaseObject
    {
    public:

        SlangResult queryInterface(SlangUUID const& uuid, void** outObject) override
        {
            void* intf = getInterface(uuid);
            if (intf)
            {
                ++m_refCount;
                *outObject = intf;
                return SLANG_OK;
            }
            return SLANG_E_NO_INTERFACE;
        }

        uint32_t addRef() override { return ++m_refCount; }
        uint32_t release() override { return _releaseImpl(); }

        virtual void* castAs(const SlangUUID& guid) override
        {
            if (auto intf = getInterface(guid))
            {
                return intf;
            }
            return getObject(guid);
        }

    protected:
        ISlangUnknown* getInterface(const Slang::Guid& guid)
        {
            if (guid == ISlangUnknown::getTypeGuid() || guid == ISlangBlob::getTypeGuid())
            {
                return static_cast<ISlangBlob*>(this);
            }
            if (guid == ISlangCastable::getTypeGuid())
            {
                return static_cast<ISlangCastable*>(this);
            }
            return nullptr;
        }

        void* getObject(const Slang::Guid& /* guid */)
        {
            return nullptr;
        }

    };

    class UnownedBlob : public BlobBase
    {
    public:
        virtual SLANG_NO_THROW void const* SLANG_MCALL getBufferPointer()
		{
			return m_data;
		}
        virtual SLANG_NO_THROW size_t SLANG_MCALL getBufferSize() { return m_size; }

        static Slang::ComPtr<ISlangBlob> create(const void* data, size_t size)
        {
            return Slang::ComPtr<ISlangBlob>(new UnownedBlob(data, size));
        }

    private:
        explicit UnownedBlob(const void* data, size_t size)
            : m_data(data)
            , m_size(size)
        {
        }

        const void* m_data;
        size_t m_size;
    };

} // namespace

namespace slang
{
namespace wgsl
{



::GlobalSession* g_globalSession;

void
createGlobalSession()
{
    if (g_globalSession)
        return;

    IGlobalSession* globalSession = nullptr;
    {
        SlangResult result = slang::createGlobalSession(&globalSession);
        if (result != SLANG_OK)
        {
            // TODO: Throw some error based on 'result'
            return;
        }
    }

    ISession* session = nullptr;
    {
        SessionDesc sessionDesc = {};
        sessionDesc.structureSize = sizeof(sessionDesc);
        SlangInt constexpr targetCount {1};
        TargetDesc targets[targetCount] = {};
        {
            TargetDesc & target {targets[0]};
            target.structureSize = sizeof(target);
            target.format = SLANG_WGSL;
        }
        sessionDesc.targets = targets;
        sessionDesc.targetCount = targetCount;
        SlangResult const result {globalSession->createSession(sessionDesc, &session)};
        if (result != SLANG_OK)
        {
            // TODO: Throw some error based on 'result'
            return;
        }
    }

    g_globalSession = new GlobalSession;
    g_globalSession->globalSession = globalSession;
    g_globalSession->session = session;
}

Module* loadModuleFromSource(std::string const& slangCode)
{
    if (g_globalSession == nullptr)
    {
        // TODO: Throw "not initialized" error
        return {};
    }
    ISession* session = g_globalSession->session;

    Slang::ComPtr<IModule> module;
    {
        char const*const name {""};
        char const*const path {""};
        Slang::ComPtr<slang::IBlob> diagnosticsBlob;
        Slang::ComPtr<ISlangBlob> slangCodeBlob =
			UnownedBlob::create(slangCode.c_str(), slangCode.size());
        module =
			session->loadModuleFromSource(
				name, path, slangCodeBlob, diagnosticsBlob.writeRef()
			);
        if (!module)
            return {};
    }

    return new Module(module);
}

EntryPoint* Module::findEntryPointByName(const std::string& name)
{
    Slang::ComPtr<IEntryPoint> entryPoint;
	{
		SlangResult const result {
			moduleInterface()->
            findEntryPointByName(name.c_str(), entryPoint.writeRef())
		};
        if (result != SLANG_OK)
        {
            // TODO: Throw some error based on 'result'
            return nullptr;
        }
	}

    return new EntryPoint(entryPoint);
}

ComponentType*
createCompositeComponentType(const std::vector<ComponentType*>& components)
{
    if (g_globalSession == nullptr)
    {
        // TODO: Throw "not initialized" error
        return {};
    }
    ISession* session = g_globalSession->session;

	Slang::ComPtr<IComponentType> composite;
	{
        std::vector<IComponentType*> nativeComponents(components.size());
        for (
            size_t componentIndex {0};
            componentIndex < components.size();
            componentIndex++
            )
            nativeComponents[componentIndex] = components[componentIndex]->interface();
        SlangResult const result {
            session->createCompositeComponentType(
                nativeComponents.data(),
                (SlangInt)nativeComponents.size(),
                composite.writeRef()
            )
        };
        if (result != SLANG_OK)
        {
            // TODO: Throw some error based on 'result'
            return {};
        }
	}

    return new ComponentType(composite);
}

ComponentType* ComponentType::link()
{

    Slang::ComPtr<IComponentType> linkedProgram;
	{
		Slang::ComPtr<ISlangBlob> diagnosticBlob;
		SlangResult const result {
			interface()->link(
                linkedProgram.writeRef(), diagnosticBlob.writeRef()
            )
		};
        if (result != SLANG_OK)
            return {};
	}

    return new ComponentType(linkedProgram);
}

std::string
ComponentType::getEntryPointCode(int entryPointIndex, int targetIndex)
{

    if (g_globalSession == nullptr)
    {
        // TODO: Throw "not initialized" error
        return {};
    }
    ISession* session = g_globalSession->session;

	{
		Slang::ComPtr<IBlob> kernelBlob;
		Slang::ComPtr<ISlangBlob> diagnosticBlob;
		interface()->getEntryPointCode(
			entryPointIndex,
			targetIndex,
			kernelBlob.writeRef(),
			diagnosticBlob.writeRef()
			);
		std::string wgslCode =
			std::string(
				(char*)kernelBlob->getBufferPointer(),
				(char*)kernelBlob->getBufferPointer() + kernelBlob->getBufferSize()
				);
		return wgslCode;
	}

    return {};
}

} // namespace wgsl
} // namespace slang
