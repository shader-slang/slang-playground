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
