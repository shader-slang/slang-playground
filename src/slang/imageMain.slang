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

    float4 color = imageMain(dispatchThreadID.xy, int2(width, height));

    if (dispatchThreadID.x >= width || dispatchThreadID.y >= height)
        return;

    outputTexture.Store(dispatchThreadID.xy, color);
}
