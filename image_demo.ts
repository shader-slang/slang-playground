const imageDemoCode =
`
import playground;

[playground::URL("static/jeep.jpg")]
Texture2D<float4> myImage;
float4 imageMain(uint2 dispatchThreadID, int2 screenSize)
{
    float2 size = float2(screenSize.x, screenSize.y);
    float2 center = size / 2.0;

    float2 pos = float2(dispatchThreadID.xy);

    float stripSize = screenSize.x / 40;

    float dist = distance(pos, center) + getTime() * 3;
    float strip = dist / stripSize % 2.0;

    uint imageW;
    uint imageH;
    myImage.GetDimensions(imageW, imageH);

    uint2 scaled = (uint2)floor(float2(dispatchThreadID.xy) / float2(screenSize) * float2(imageW, imageH));
    uint2 flipped = uint2(scaled.x, imageH - scaled.y);

    float4 imageColor = myImage[flipped] * 0.8;

    if (strip < 1.0f)
        return imageColor;
    else
        return float4(0.8f - imageColor.x, 0.8f - imageColor.y, 0.8f - imageColor.z, 1.0f);
}
`;