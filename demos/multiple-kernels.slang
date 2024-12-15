import playground;

[RAND(131072)]
RWStructuredBuffer<float> buf;

// Fills buffer with a sine wave
[shader("compute")]
[numthreads(64, 1, 1)]
void fillBuffer(uint2 dispatchThreadId : SV_DispatchThreadID)
{
    uint idx = dispatchThreadId.x;
    buf[idx] = sin(float(idx) / 1000.0);
}

//! CALL(fillBuffer, SIZE_OF(buf))

float4 imageMain(uint2 dispatchThreadID, int2 screenSize)
{
    uint idx = dispatchThreadID.x + dispatchThreadID.y * screenSize.x;

    float rand = buf[idx % 131072];

    return float4(rand, rand, rand, 1.0);
}