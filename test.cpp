#include <iostream>
#include <vector>
#include <string>
#include <slang.h>
#include <slang-com-ptr.h>
#include "slang-wgsl.h"


void test()
{
    slang::wgsl::createGlobalSession();

    std::string source1 = R"(

        RWStructuredBuffer<int>               outputBuffer;

        [shader("compute")]
        void computeMain(int3 dispatchThreadID : SV_DispatchThreadID)
        {
            int idx = dispatchThreadID.x * 32 + dispatchThreadID.y;
            outputBuffer[idx] = idx;
        }
    )";


    std::string source2 = R"(

        [shader("vertex")]
        float4 vertexMain(float3 position)
        {
            float4 output = float4(position, 1.0);
            return output;
        }

        [shader("fragment")]
        float4 fragMain(): SV_TARGET
        {
            return float4(1, 0, 0, 1);
        }
    )";

    slang::wgsl::Module* module1 = slang::wgsl::loadModuleFromSource(source1.c_str());
    if (module1 == nullptr)
    {
        std::cout << "Failed to load module1" << std::endl;
        return;
    }

    slang::wgsl::EntryPoint* entryPoint1 = module1->findEntryPointByName("computeMain", SLANG_STAGE_COMPUTE);
    if (entryPoint1 == nullptr)
    {
        std::cout << "Failed to find entry point in module 1" << std::endl;
        return;
    }


    slang::wgsl::Module* module2 = slang::wgsl::loadModuleFromSource(source2.c_str());
    if (module2 == nullptr)
    {
        std::cout << "Failed to load module1" << std::endl;
        return;
    }

    slang::wgsl::EntryPoint* entryPoint2 = module2->findEntryPointByName("vertexMain", SLANG_STAGE_VERTEX);
    if (entryPoint2 == nullptr)
    {
        std::cout << "Failed to find entry point in module 1" << std::endl;
        return;
    }
}

int main()
{
    test();
    return 0;
}
