import playground;

float4 imageMain(uint2 dispatchThreadID, int2 screenSize)
{
    float2 size = float2(screenSize.x, screenSize.y);
    float2 center = size / 2.0;

    float2 pos = float2(dispatchThreadID.xy);

    float stripSize = screenSize.x / 40;

    const float time = getTime(); // from playgournd
    float dist = distance(pos, center) + time;
    float strip = dist / stripSize % 2.0;

    if (strip < 1.0f)
        return float4(1.0f, 0.0f, 0.0f, 1.0f);
    else
        return float4(0.0f, 1.0f, 1.0f, 1.0f);
}