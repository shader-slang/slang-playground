// This example demonstrates a slang-playground feature that populates a texture by loading the image from a URL.

import playground;

//! @myImage: URL("static/jeep.jpg")
Texture2D<float4> myImage;

float4 imageMain(uint2 dispatchThreadID, int2 screenSize)
{
    uint imageW;
    uint imageH;
    myImage.GetDimensions(imageW, imageH);

    uint2 scaled = (uint2)floor(float2(dispatchThreadID.xy) / screenSize.y * float2(imageW, imageH));
    uint2 flipped = uint2(scaled.x, imageH - scaled.y);

    float4 imageColor = myImage[flipped];
    return imageColor;
}