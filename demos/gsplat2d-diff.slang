import playground;

#define BLOB_BUFFER_SIZE 184320

#define ADAM_ETA 0.002
#define ADAM_BETA_1 0.9
#define ADAM_BETA_2 0.999
#define ADAM_EPSILON 1e-8

// The "//!" directives instruct slang-playground to allocate and initialize the buffers 
// with the appropriate data.
//

//! @blobsBuffer: RAND(184320)
RWStructuredBuffer<float> blobsBuffer;

//! @derivBuffer: ZEROS(184320)
RWStructuredBuffer<Atomic<uint>> derivBuffer;

//! @adamFirstMoment: ZEROS(184320)
RWStructuredBuffer<float> adamFirstMoment;

//! @adamSecondMoment: ZEROS(184320)
RWStructuredBuffer<float> adamSecondMoment;

//! @targetTexture: URL("static/jeep.jpg")
Texture2D<float4> targetTexture;

#define GAUSSIANS_PER_BLOCK 256
#define WG_X 16
#define WG_Y 16
#define NUM_FIELDS 9

groupshared uint blobs[GAUSSIANS_PER_BLOCK];
groupshared Atomic<uint> blobCountAT;
groupshared uint blobCount;

groupshared uint maxCount[WG_X * WG_Y];
groupshared float4 finalVal[WG_X * WG_Y];

groupshared float reductionBuffer[WG_X * WG_Y];

// Some types to hold state info on the 'blobs' buffer.
// This makes it easy to make sure we're not accidentally using the buffer
// in the wrong state.
//
// The actual data is in the 'blobs' object.
//
struct InitializedShortList { int _dummy = 0; };
struct FilledShortList { int _dummy = 0; };
struct PaddedShortList { int _dummy = 0; };
struct SortedShortList { int _dummy = 0; };

/*// Axis-aligned bounding box.
struct AABB
{
    float2 minVal;
    float2 maxVal;

    __init(float2 minVal, float2 maxVal)
    {
        this.minVal = minVal;
        this.maxVal = maxVal;
    }

    bool intersects(AABB other)
    {
        return !(other.minVal.x > this.maxVal.x
            || other.maxVal.x < this.minVal.x
            || other.maxVal.y < this.minVal.y
            || other.minVal.y > this.maxVal.y);
    }
};*/

// Oriented bounding box.
struct OBB
{
    float2 center;
    float2x2 rotation;
    float2 scale;

    bool intersects(OBB other)
    {
        float2 canonicalPts[4] = float2[4](float2(-1, -1), float2(1, -1), float2(1, 1), float2(-1, 1));

        float2x2 inv_rotation = inverse(rotation);
        float2x2 other_inv_rotation = inverse(other.rotation);
        float2 pts[4];
        for (int i = 0; i < 4; i++)
            pts[i] = center + float2(
                                  dot(inv_rotation[0], (canonicalPts[i] * scale)),
                                  dot(inv_rotation[1], (canonicalPts[i] * scale)));
    
        float2 otherPts[4];
        for (int i = 0; i < 4; i++)
            otherPts[i] = other.center + float2(
                dot(other_inv_rotation[0], (canonicalPts[i] * other.scale)),
                dot(other_inv_rotation[1], (canonicalPts[i] * other.scale)));

        return !(arePtsSeparatedAlongAxes(pts, otherPts, rotation) ||
                 arePtsSeparatedAlongAxes(pts, otherPts, other.rotation));
    }

    static bool arePtsSeparatedAlongAxes(float2[4] pts, float2[4] otherPts, float2x2 axes)
    {
        // If any set of points are entirely on one side of the other, they are separated.
        //
        for (int i = 0; i < 2; i++)
        {
            float2 axis = axes[i];
            float2 proj = float2(dot(pts[0], axis), dot(pts[0], axis));
            float2 otherProj = float2(dot(otherPts[0], axis), dot(otherPts[0], axis));

            for (int j = 1; j < 4; j++)
            {
                proj.x = min(proj.x, dot(pts[j], axis));
                proj.y = max(proj.y, dot(pts[j], axis));

                otherProj.x = min(otherProj.x, dot(otherPts[j], axis));
                otherProj.y = max(otherProj.y, dot(otherPts[j], axis));
            }

            if (proj.y < otherProj.x || otherProj.y < proj.x)
                return true;
        }

        return false;
    }

    __init(float2 center, float2x2 rotation, float2 scale)
    {
        this.center = center;
        this.rotation = rotation;
        this.scale = scale;
    }
};

[Differentiable]
vector<float, N> smoothStep<let N : int>(vector<float, N> x, vector<float, N> minval, vector<float, N> maxval)
{
    vector<float, N> y = clamp((x - minval) / (maxval - minval), 0.f, 1.f);
    return y * y * (3.f - 2.f * y);
}

[Differentiable]
float smoothStep(float x, float minval, float maxval)
{
    float y = clamp((x - minval) / (maxval - minval), 0.f, 1.f);
    return y * y * (3.f - 2.f * y);
}

[Differentiable]
float4 preMult(float4 pixel)
{
    return float4(pixel.rgb * pixel.a, pixel.a);
}

[Differentiable]
float4 alphaBlend(float4 pixel, float4 gval)
{
    gval = preMult(gval);

    return float4(
        pixel.rgb + gval.rgb * pixel.a,
        pixel.a * (1 - gval.a));
}

float4 undoAlphaBlend(float4 pixel, float4 gval)
{
    gval = preMult(gval);

    var oldPixelAlpha = pixel.a / (1 - gval.a);
    return float4(
        pixel.rgb - gval.rgb * oldPixelAlpha,
        oldPixelAlpha);
}

struct PixelState : IDifferentiable
{
    float4 value;
    uint finalCount;
};

[Differentiable]
PixelState transformPixelState(PixelState pixel, float4 gval)
{
    var newState = alphaBlend(pixel.value, gval);

    if (pixel.value.a < 1.f / 255.f)
        return { pixel.value, pixel.finalCount };

    return { newState, pixel.finalCount + 1 };
}

PixelState undoPixelState(PixelState nextState, uint index, float4 gval)
{
    if (index > nextState.finalCount)
        return { nextState.value, nextState.finalCount };
    
    return { undoAlphaBlend(nextState.value, gval), nextState.finalCount - 1 };
}

[BackwardDerivative(loadFloat_bwd)]
float loadFloat(uint idx, uint localDispatchIdx)
{
    return blobsBuffer[idx];
}

void atomicAccumulate(float val, uint idx)
{
    if (val == 0.f)
        return; // No need to accumulate zero

    // AtomicCAS-based accumulation (WGSL has no floating-point atomics)
    for (;;)
    {
        uint oldInt = derivBuffer[idx].load();
        float oldFloat = asfloat(oldInt);

        float newFloat = oldFloat + val;

        uint newInt = asuint(newFloat);

        if (derivBuffer[idx].compareExchange(oldInt, newInt) == oldInt)
            break;
    }
}

void loadFloat_bwd(uint idx, uint localDispatchIdx, float dOut)
{
    // Clamp the gradients to avoid any weird problems with the optimization.
    if (abs(dOut) < 10.f)
        reductionBuffer[localDispatchIdx] = dOut;
    else
        reductionBuffer[localDispatchIdx] = 10.f * sign(dOut);
    
    GroupMemoryBarrierWithGroupSync();
    
    // Binary reduction
    for (uint stride = (WG_X * WG_Y) / 2; stride > 0; stride /= 2)
    {
        if (localDispatchIdx < stride)
            reductionBuffer[localDispatchIdx] += reductionBuffer[localDispatchIdx + stride];

        GroupMemoryBarrierWithGroupSync();
    }

    if (localDispatchIdx == 0)
        atomicAccumulate(reductionBuffer[0], idx);
}

[Differentiable]
float2x2 inverse(float2x2 mat)
{
    float2x2 output;

    float det = determinant(mat);
    output[0][0] = mat[1][1] / det;
    output[0][1] = -mat[0][1] / det;
    output[1][0] = -mat[1][0] / det;
    output[1][1] = mat[0][0] / det;

    return output;
}

struct Gaussian2D : IDifferentiable
{
    float2 center;
    float2x2 sigma;
    float3 color;
    float opacity;

    [Differentiable]
    static Gaussian2D load(uint idx, uint localIdx)
    {
        uint total = Gaussian2D.count();
        Gaussian2D gaussian;

        gaussian.center = smoothStep(
            float2(
                loadFloat(total * 0 + idx, localIdx),
                loadFloat(total * 1 + idx, localIdx)),
            float2(0, 0),
            float2(1, 1));

        gaussian.sigma[0][0] = smoothStep(
            loadFloat(total * 2 + idx, localIdx) * 0.8f, 0.f, 1.f) + 0.005f;
        gaussian.sigma[1][1] = smoothStep(
            loadFloat(total * 3 + idx, localIdx) * 0.8f, 0.f, 1.f) + 0.005f;

        float aniso = (smoothStep(
            loadFloat(total * 4 + idx, localIdx) * 0.6f, 0.f, 1.f) - 0.5f) * 1.65f;
        
        gaussian.sigma[0][1] = sqrt(gaussian.sigma[0][0] * gaussian.sigma[1][1]) * aniso;
        gaussian.sigma[1][0] = sqrt(gaussian.sigma[0][0] * gaussian.sigma[1][1]) * aniso;

        
        gaussian.color = smoothStep(
            float3(
                loadFloat(total * 5 + idx, localIdx) * 0.8f,
                loadFloat(total * 6 + idx, localIdx) * 0.8f,
                loadFloat(total * 7 + idx, localIdx) * 0.8f),
            float3(0, 0, 0),
            float3(1, 1, 1));

        gaussian.opacity = smoothStep(
            loadFloat(total * 8 + idx, localIdx) * 0.9f + 0.1f, 0, 1);

        // Scale the sigma so the blobs aren't too large
        gaussian.sigma *= 0.0001;

        return gaussian;
    }

    static uint count()
    {
        uint elementCount = (uint)BLOB_BUFFER_SIZE;
        return elementCount / NUM_FIELDS;
    }

    [Differentiable]
    float4 eval(float2 uv)
    {
        float2x2 invCov = inverse(sigma);
        float2 diff = uv - center;
        float power = -0.5f * ((diff.x * diff.x * invCov[0][0]) +
                              (diff.y * diff.y * invCov[1][1]) +
                              (diff.x * diff.y * invCov[0][1]) +
                              (diff.y * diff.x * invCov[1][0]));
        
        float weight = min(.99f, opacity * exp(power));
        return float4(color, weight);
    }

    OBB bounds()
    {
        // Calculate eigenvectors for the 2x2 matrix.
        float2x2 cov = sigma;

        float a = cov[0][0];
        float b = cov[0][1];
        float c = cov[1][0];
        float d = cov[1][1];

        float n_stddev = 4.f;

        if (abs(b) < 1e-6 || abs(c) < 1e-6)
        {
            // The covariance matrix is diagonal (or close enough..) , so the eigenvectors are the x and y axes.
            float2x2 eigenvectors = float2x2(float2(1, 0), float2(0, 1));
            float2 scale = float2(sqrt(a), sqrt(d));

            return OBB(center, eigenvectors, scale * n_stddev);
        }
        else
        {
            float trace = a + d;
            float det = a * d - b * c;

            float lambda1 = 0.5 * (trace + sqrt(trace * trace - 4 * det));
            float lambda2 = 0.5 * (trace - sqrt(trace * trace - 4 * det));

            float2x2 eigenvectors;
            eigenvectors[0] = float2(lambda1 - d, c) / length(float2(lambda1 - d, c));
            eigenvectors[1] = float2(b, lambda2 - a) / length(float2(b, lambda2 - a));

            // Calculate the scale of the OBB
            float2 scale = float2(sqrt(lambda1), sqrt(lambda2));

            return OBB(center, eigenvectors, scale * n_stddev);
        }
    }
};

PaddedShortList padBuffer(FilledShortList, uint localIdx)
{
    GroupMemoryBarrierWithGroupSync();

    var maxN = blobCount;
    for (uint i = localIdx; i < GAUSSIANS_PER_BLOCK; i += (WG_X * WG_Y))
    {
        if (i >= maxN)
            blobs[i] = uint::maxValue;
    }

    return { 0 };
}

SortedShortList bitonicSort(PaddedShortList, uint localIdx)
{
    GroupMemoryBarrierWithGroupSync();

    uint maxN = blobCount;
    for (uint k = 2; k <= GAUSSIANS_PER_BLOCK; k *= 2)
    {
        for (uint j = k / 2; j > 0; j /= 2)
        {
            for (uint i = localIdx; i < GAUSSIANS_PER_BLOCK; i += WG_X * WG_Y)
            {
                uint l = i ^ j;
                if (l > i)
                {
                    if ((((i & k) == 0) && (blobs[i] > blobs[l])) ||
                        (((i & k) != 0) && (blobs[i] < blobs[l])))
                    {
                        // Swap
                        var temp = blobs[i];
                        blobs[i] = blobs[l];
                        blobs[l] = temp;
                    }
                }
            }

            GroupMemoryBarrierWithGroupSync();
        }
    }

    return { 0 };
}

FilledShortList coarseRasterize(InitializedShortList sList, OBB tileBounds, uint localIdx)
{
    GroupMemoryBarrierWithGroupSync();

    Gaussian2D gaussian;
    uint numGaussians = Gaussian2D.count();
    for (uint i = localIdx; i < numGaussians; i += (WG_X * WG_Y))
    {
        gaussian = Gaussian2D.load(i, localIdx);
        OBB bounds = gaussian.bounds();
        if (bounds.intersects(tileBounds))
        {
            blobs[blobCountAT++] = i;
        }
    }

    GroupMemoryBarrierWithGroupSync();

    blobCount = blobCountAT.load();

    return { 0 };
}

[Differentiable]
float4 eval(uint blob_id, no_diff float2 uv, uint localIdx)
{
    Gaussian2D gaussian = Gaussian2D.load(blob_id, localIdx);
    return gaussian.eval(uv);
}

[BackwardDerivative(fineRasterize_bwd)]
float4 fineRasterize(SortedShortList, uint localIdx, no_diff float2 uv)
{
    GroupMemoryBarrierWithGroupSync();

    PixelState pixelState = PixelState(float4(0, 0, 0, 1), 0);
    uint count = blobCount;
    for (uint i = 0; i < count; i++)
        pixelState = transformPixelState(pixelState, eval(blobs[i], uv, localIdx));

    maxCount[localIdx] = pixelState.finalCount;
    finalVal[localIdx] = pixelState.value;
    return pixelState.value;
}

[ForceInline]
uint workgroupUniformLoad(Ptr<uint> val)
{
    __target_switch
    {
    case wgsl:
        __intrinsic_asm "workgroupUniformLoad(&blobCount_0)";
    }
}

void fineRasterize_bwd(SortedShortList, uint localIdx, float2 uv, float4 dOut)
{
    GroupMemoryBarrierWithGroupSync();

    PixelState pixelState = { finalVal[localIdx], maxCount[localIdx] };

    PixelState.Differential dColor = { dOut };
    uint count = workgroupUniformLoad(&blobCount);
    for (uint _i = count; _i > 0; _i--)
    {
        uint i = _i - 1;
        var blobID = blobs[i];
        var gval = eval(blobID, uv, localIdx);
        var prevState = undoPixelState(pixelState, i+1, gval);

        var dpState = diffPair(prevState);
        var dpGVal = diffPair(gval);

        bwd_diff(transformPixelState)(dpState, dpGVal, dColor);
        bwd_diff(eval)(blobID, uv, localIdx, dpGVal.getDifferential());

        pixelState = prevState;
        dColor = dpState.getDifferential();
    }
}

InitializedShortList initShortList(uint2 dispatchThreadID)
{
    GroupMemoryBarrierWithGroupSync();

    if (dispatchThreadID.x % WG_X == 0 && dispatchThreadID.y % WG_Y == 0)
    {
        blobCount = 0; blobCountAT = 0;
    }

    return { 0 };
}

[Differentiable]
float4 splatBlobs(uint2 dispatchThreadID, int2 imageSize)
{
    uint globalID = dispatchThreadID.x + dispatchThreadID.y * imageSize.x;

    float2 uv = float2(dispatchThreadID) / float2(imageSize);

    uint2 tileID = uint2(dispatchThreadID.x / WG_X, dispatchThreadID.y / WG_Y);

    float2 tileLow = float2(tileID) * float2(WG_X, WG_Y) / float2(imageSize);
    float2 tileHigh = tileLow + (float2(WG_X, WG_Y) / float2(imageSize));

    float2 tileCenter = (tileLow + tileHigh) / 2;
    float2x2 tileRotation = float2x2(1, 0, 0, 1);
    float2 tileScale = (tileHigh - tileLow) / 2;

    OBB tileBounds = OBB(tileCenter, tileRotation, tileScale);

    InitializedShortList sList = initShortList(dispatchThreadID);

    uint2 localID = dispatchThreadID % uint2(WG_X, WG_Y);
    uint localIdx = localID.x + localID.y * WG_X;

    // Short-list blobs that overlap with the current pixel
    FilledShortList filledSList = coarseRasterize(sList, tileBounds, localIdx);

    // Pad the unused space in the buffer
    PaddedShortList paddedSList = padBuffer(filledSList, localIdx);

    // Sort the short list
    SortedShortList sortedList = bitonicSort(paddedSList, localIdx);

    // Perform per-pixel fine rasterization
    float4 color = fineRasterize(sortedList, localIdx, uv);

    // Blend with background
    return float4(color.rgb * (1.0 - color.a) + color.a, 1.0);
}

[Differentiable]
float loss(uint2 dispatchThreadID, int2 imageSize)
{
    // Splat the blobs and calculate the color for this pixel.
    float4 color = splatBlobs(dispatchThreadID, imageSize);

    float4 targetColor;
    float weight;
    if (dispatchThreadID.x >= imageSize.x || dispatchThreadID.y >= imageSize.y)
    {
        return 0.f;
    }
    else
    {
        uint2 flippedCoords = uint2(dispatchThreadID.x, imageSize.y - dispatchThreadID.y);
        targetColor = no_diff targetTexture[flippedCoords];
        return dot(color.rgb - targetColor.rgb, color.rgb - targetColor.rgb);
    }

    return 0.f;
}

[shader("compute")]
[numthreads(64, 1, 1)]
void clearDerivativesMain(uint2 dispatchThreadID : SV_DispatchThreadID)
{
    if (dispatchThreadID.x >= BLOB_BUFFER_SIZE)
        return;
    
    derivBuffer[dispatchThreadID.x].store(asuint(0.f));
}

[shader("compute")]
[numthreads(16, 16, 1)]
void computeDerivativesMain(uint2 dispatchThreadID : SV_DispatchThreadID)
{
    uint dimX;
    uint dimY;
    targetTexture.GetDimensions(dimX, dimY);

    int2 targetImageSize = int2(dimX, dimY);

    // Backprop (will write derivatives to the derivBuffer)
    bwd_diff(loss)(dispatchThreadID, targetImageSize, 1.f / (targetImageSize.x * targetImageSize.y));
}

[shader("compute")]
[numthreads(256, 1, 1)]
void updateBlobsMain(uint2 dispatchThreadID: SV_DispatchThreadID)
{
    var globalID = dispatchThreadID.x;
    if (globalID >= BLOB_BUFFER_SIZE)
        return;

    // Read & reset the derivative
    float g_t = asfloat(derivBuffer[globalID].load());
    derivBuffer[globalID] = asuint(0.f);

    float g_t_2 = g_t * g_t;

    // 
    // Perform a gradient update using Adam optimizer rules for
    // a smoother optimization.
    // 

    float m_t_prev = adamFirstMoment[globalID];
    float v_t_prev = adamSecondMoment[globalID];
    float m_t = ADAM_BETA_1 * m_t_prev + (1 - ADAM_BETA_1) * g_t;
    float v_t = ADAM_BETA_2 * v_t_prev + (1 - ADAM_BETA_2) * g_t_2;

    adamFirstMoment[globalID] = m_t;
    adamSecondMoment[globalID] = v_t;

    float m_t_hat = m_t / (1 - ADAM_BETA_1);
    float v_t_hat = v_t / (1 - ADAM_BETA_2);

    float update = (ADAM_ETA / (sqrt(v_t_hat) + ADAM_EPSILON)) * m_t_hat;

    blobsBuffer[globalID] -= update;
}

// Sequence of additional kernel calls to be performed before imageMain
// By default, imageMain is always the last kernel to be dispatched
// 
// "//! CALL" is a slang-playground directive that helps us queue up additional kernels
//
//! CALL(clearDerivativesMain, SIZE_OF(blobsBuffer))
//! CALL(computeDerivativesMain, SIZE_OF(targetTexture))
//! CALL(updateBlobsMain, SIZE_OF(blobsBuffer))
//

float4 imageMain(uint2 dispatchThreadID, uint2 screenSize)
{
    return splatBlobs(dispatchThreadID, screenSize);
}