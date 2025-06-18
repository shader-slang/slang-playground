// This example demonstrates a slang-playground feature that retrieves importable slang modules through URLs.
#define AA 2

import playground;

[playground::MOUSE_POSITION]
uniform float4 iMouse;

[playground::TIME]
uniform float iTime;

[playground::URL("https://gist.githubusercontent.com/natevm/42e671ebe2aab5699022b5010a144db3/raw/93cb56290465f356f48155df7d317b2c3f1fb2ac/utils.slang")]
void loadUtils();

import utils;

//------------------------------------------------------------------

float2 map(in float3 pos)
{
    using namespace sdf;

    float2 res = float2(pos.y, 0.0);

    // bounding box
    if (sdBox(pos - float3(-2.0, 0.3, 0.25), float3(0.3, 0.3, 1.0)) < res.x)
    {
        res = opU(res, float2(sdSphere(pos - float3(-2.0, 0.25, 0.0), 0.25), 26.9));
        res = opU(res, float2(sdRhombus((pos - float3(-2.0, 0.25, 1.0)).xzy, 0.15, 0.25, 0.04, 0.08), 17.0));
    }

    // bounding box
    if (sdBox(pos - float3(0.0, 0.3, -1.0), float3(0.35, 0.3, 2.5)) < res.x)
    {
        res = opU(res, float2(sdCappedTorus((pos - float3(0.0, 0.30, 1.0)) * float3(1, -1, 1), float2(0.866025, -0.5), 0.25, 0.05), 25.0));
        res = opU(res, float2(sdBoxFrame(pos - float3(0.0, 0.25, 0.0), float3(0.3, 0.25, 0.2), 0.025), 16.9));
        res = opU(res, float2(sdCone(pos - float3(0.0, 0.45, -1.0), float2(0.6, 0.8), 0.45), 55.0));
        res = opU(res, float2(sdCappedCone(pos - float3(0.0, 0.25, -2.0), 0.25, 0.25, 0.1), 13.67));
        res = opU(res, float2(sdSolidAngle(pos - float3(0.0, 0.00, -3.0), float2(3, 4) / 5.0, 0.4), 49.13));
    }

    // bounding box
    if (sdBox(pos - float3(1.0, 0.3, -1.0), float3(0.35, 0.3, 2.5)) < res.x)
    {
        res = opU(res, float2(sdTorus((pos - float3(1.0, 0.30, 1.0)).xzy, float2(0.25, 0.05)), 7.1));
        res = opU(res, float2(sdBox(pos - float3(1.0, 0.25, 0.0), float3(0.3, 0.25, 0.1)), 3.0));
        res = opU(res, float2(sdCapsule(pos - float3(1.0, 0.00, -1.0), float3(-0.1, 0.1, -0.1), float3(0.2, 0.4, 0.2), 0.1), 31.9));
        res = opU(res, float2(sdCylinder(pos - float3(1.0, 0.25, -2.0), float2(0.15, 0.25)), 8.0));
        res = opU(res, float2(sdHexPrism(pos - float3(1.0, 0.2, -3.0), float2(0.2, 0.05)), 18.4));
    }

    // bounding box
    if (sdBox(pos - float3(-1.0, 0.35, -1.0), float3(0.35, 0.35, 2.5)) < res.x)
    {
        res = opU(res, float2(sdPyramid(pos - float3(-1.0, -0.6, -3.0), 1.0), 13.56));
        res = opU(res, float2(sdOctahedron(pos - float3(-1.0, 0.15, -2.0), 0.35), 23.56));
        res = opU(res, float2(sdTriPrism(pos - float3(-1.0, 0.15, -1.0), float2(0.3, 0.05)), 43.5));
        res = opU(res, float2(sdEllipsoid(pos - float3(-1.0, 0.25, 0.0), float3(0.2, 0.25, 0.05)), 43.17));
        res = opU(res, float2(sdHorseshoe(pos - float3(-1.0, 0.25, 1.0), float2(cos(1.3), sin(1.3)), 0.2, 0.3, float2(0.03, 0.08)), 11.5));
    }

    // bounding box
    if (sdBox(pos - float3(2.0, 0.3, -1.0), float3(0.35, 0.3, 2.5)) < res.x)
    {
        res = opU(res, float2(sdOctogonPrism(pos - float3(2.0, 0.2, -3.0), 0.2, 0.05), 51.8));
        res = opU(res, float2(sdCylinder(pos - float3(2.0, 0.14, -2.0), float3(0.1, -0.1, 0.0), float3(-0.2, 0.35, 0.1), 0.08), 31.2));
        res = opU(res, float2(sdCappedCone(pos - float3(2.0, 0.09, -1.0), float3(0.1, 0.0, 0.0), float3(-0.2, 0.40, 0.1), 0.15, 0.05), 46.1));
        res = opU(res, float2(sdRoundCone(pos - float3(2.0, 0.15, 0.0), float3(0.1, 0.0, 0.0), float3(-0.1, 0.35, 0.1), 0.15, 0.05), 51.7));
        res = opU(res, float2(sdRoundCone(pos - float3(2.0, 0.20, 1.0), 0.2, 0.1, 0.3), 37.0));
    }

    return res;
}

float2 raycast(in float3 ro, in float3 rd)
{
    using namespace isect;

    float2 res = float2(-1.0, -1.0);

    float tmin = 1.0;
    float tmax = 20.0;

    // raytrace floor plane
    float tp1 = (0.0 - ro.y) / rd.y;
    if (tp1 > 0.0)
    {
        tmax = min(tmax, tp1);
        res = float2(tp1, 1.0);
    }
    // else return res;

    // raymarch primitives
    float2 tb = iBox(ro - float3(0.0, 0.4, -0.5), rd, float3(2.5, 0.41, 3.0));
    if (tb.x < tb.y && tb.y > 0.0 && tb.x < tmax)
    {
        // return float2(tb.x,2.0);
        tmin = max(tb.x, tmin);
        tmax = min(tb.y, tmax);

        float t = tmin;
        for (int i = 0; i < 70 && t < tmax; i++)
        {
            float2 h = map(ro + rd * t);
            if (abs(h.x) < (0.0001 * t))
            {
                res = float2(t, h.y);
                break;
            }
            t += h.x;
        }
    }

    return res;
}

// https://iquilezles.org/articles/rmshadows
float calcSoftshadow(in float3 ro, in float3 rd, in float mint, in float tmax)
{
    // bounding volume
    float tp = (0.8 - ro.y) / rd.y; if (tp > 0.0) tmax = min(tmax, tp);

    float res = 1.0;
    float t = mint;
    for (int i = 0; i < 24; i++)
    {
        float h = map(ro + rd * t).x;
        float s = clamp(8.0 * h / t, 0.0, 1.0);
        res = min(res, s);
        t += clamp(h, 0.01, 0.2);
        if (res < 0.004 || t > tmax) break;
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
}

// https://iquilezles.org/articles/normalsSDF
float3 calcNormal(in float3 pos)
{
#if 0
    float2 e = float2(1.0,-1.0)*0.5773*0.0005;
    return normalize( e.xyy*map( pos + e.xyy ).x + 
					  e.yyx*map( pos + e.yyx ).x + 
					  e.yxy*map( pos + e.yxy ).x + 
					  e.xxx*map( pos + e.xxx ).x );
#else
    // inspired by tdhooper and klems - a way to prevent the compiler from inlining map() 4 times
    float3 n = float3(0.0);
    for (int i = 0; i < 4; i++)
    {
        float3 e = 0.5773 * (2.0 * float3((((i + 3) >> 1) & 1), ((i >> 1) & 1), (i & 1)) - 1.0);
        n += e * map(pos + 0.0005 * e).x;
        // if( n.x+n.y+n.z>100.0 ) break;
    }
    return normalize(n);
#endif
}

// https://iquilezles.org/articles/nvscene2008/rwwtt.pdf
float calcAO(in float3 pos, in float3 nor)
{
    float occ = 0.0;
    float sca = 1.0;
    for (int i = 0; i < 5; i++)
    {
        float h = 0.01 + 0.12 * float(i) / 4.0;
        float d = map(pos + h * nor).x;
        occ += (h - d) * sca;
        sca *= 0.95;
        if (occ > 0.35) break;
    }
    return clamp(1.0 - 3.0 * occ, 0.0, 1.0) * (0.5 + 0.5 * nor.y);
}

// https://iquilezles.org/articles/checkerfiltering
float checkersGradBox(in float2 p, in float2 dpdx, in float2 dpdy)
{
    // filter kernel
    float2 w = abs(dpdx) + abs(dpdy) + 0.001;
    // analytical integral (box filter)
    float2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
    // xor pattern
    return 0.5 - 0.5 * i.x * i.y;
}

float3 render(in float3 ro, in float3 rd, in float3 rdx, in float3 rdy)
{
    // background
    float3 col = float3(0.7, 0.7, 0.9) - max(rd.y, 0.0) * 0.3;

    // raycast scene
    float2 res = raycast(ro, rd);
    float t = res.x;
    float m = res.y;
    if (m > -0.5)
    {
        float3 pos = ro + t * rd;
        float3 nor = (m < 1.5) ? float3(0.0, 1.0, 0.0) : calcNormal(pos);
        float3 ref = reflect(rd, nor);

        // material
        col = 0.2 + 0.2 * sin(m * 2.0 + float3(0.0, 1.0, 2.0));
        float ks = 1.0;

        if (m < 1.5)
        {
            // project pixel footprint into the plane
            float3 dpdx = ro.y * (rd / rd.y - rdx / rdx.y);
            float3 dpdy = ro.y * (rd / rd.y - rdy / rdy.y);

            float f = checkersGradBox(3.0 * pos.xz, 3.0 * dpdx.xz, 3.0 * dpdy.xz);
            col = 0.15 + f * float3(0.05);
            ks = 0.4;
        }

        // lighting
        float occ = calcAO(pos, nor);

        float3 lin = float3(0.0);

        // sun
        {
            float3 lig = normalize(float3(-0.5, 0.4, -0.6));
            float3 hal = normalize(lig - rd);
            float dif = clamp(dot(nor, lig), 0.0, 1.0);
            // if( dif>0.0001 )
            dif *= calcSoftshadow(pos, lig, 0.02, 2.5);
            float spe = pow(clamp(dot(nor, hal), 0.0, 1.0), 16.0);
            spe *= dif;
            spe *= 0.04 + 0.96 * pow(clamp(1.0 - dot(hal, lig), 0.0, 1.0), 5.0);
            // spe *= 0.04+0.96*pow(clamp(1.0-sqrt(0.5*(1.0-dot(rd,lig))),0.0,1.0),5.0);
            lin += col * 2.20 * dif * float3(1.30, 1.00, 0.70);
            lin += 5.00 * spe * float3(1.30, 1.00, 0.70) * ks;
        }
        // sky
        {
            float dif = sqrt(clamp(0.5 + 0.5 * nor.y, 0.0, 1.0));
            dif *= occ;
            float spe = smoothstep(-0.2, 0.2, ref.y);
            spe *= dif;
            spe *= 0.04 + 0.96 * pow(clamp(1.0 + dot(nor, rd), 0.0, 1.0), 5.0);
            // if( spe>0.001 )
            spe *= calcSoftshadow(pos, ref, 0.02, 2.5);
            lin += col * 0.60 * dif * float3(0.40, 0.60, 1.15);
            lin += 2.00 * spe * float3(0.40, 0.60, 1.30) * ks;
        }
        // back
        {
            float dif = clamp(dot(nor, normalize(float3(0.5, 0.0, 0.6))), 0.0, 1.0) * clamp(1.0 - pos.y, 0.0, 1.0);
            dif *= occ;
            lin += col * 0.55 * dif * float3(0.25, 0.25, 0.25);
        }
        // sss
        {
            float dif = pow(clamp(1.0 + dot(nor, rd), 0.0, 1.0), 2.0);
            dif *= occ;
            lin += col * 0.25 * dif * float3(1.00, 1.00, 1.00);
        }

        col = lin;

        col = lerp(col, float3(0.7, 0.7, 0.9), 1.0 - exp(-0.0001 * t * t * t));
    }

    return float3(clamp(col, 0.0, 1.0));
}


float3x3 setCamera(in float3 ro, in float3 ta, float cr)
{
    float3 cw = normalize(ta - ro);
    float3 cp = float3(sin(cr), cos(cr), 0.0);
    float3 cu = normalize(cross(cw, cp));
    float3 cv = (cross(cu, cw));
    return transpose(float3x3(cu, cv, cw));
}

float4 imageMain(uint2 dispatchThreadID, int2 screenSize)
{
    float2 fragCoord = float2(dispatchThreadID.xy);
    float4 fragColor = float4(0.f);
    float2 iResolution = float2(screenSize.xy);
    float2 mo = iMouse.xy / iResolution.xy;
    float time = 32.0 + iTime * 1.5;

    // camera
    float3 ta = float3(0.25, -0.75, -0.75);
    float3 ro = ta + float3(4.5 * cos(0.1 * time + 7.0 * mo.x), 2.2, 4.5 * sin(0.1 * time + 7.0 * mo.x));
    // camera-to-world transformation
    float3x3 ca = setCamera(ro, ta, 0.0);

    float3 tot = float3(0.0);
#if AA > 1
    for (int m = 0; m < AA; m++)
        for (int n = 0; n < AA; n++)
        {
            // pixel coordinates
            float2 o = float2(float(m), float(n)) / float(AA) - 0.5;
            float2 p = (2.0 * (fragCoord + o) - iResolution.xy) / iResolution.y;
#else
    float2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
#endif

            // focal length
            const float fl = 2.5;

            // ray direction
            float3 rd = mul(ca,  normalize(float3(p, fl)));

            // ray differentials
            float2 px = (2.0 * (fragCoord + float2(1.0, 0.0)) - iResolution.xy) / iResolution.y;
            float2 py = (2.0 * (fragCoord + float2(0.0, 1.0)) - iResolution.xy) / iResolution.y;
            float3 rdx = mul(ca,  normalize(float3(px, fl)));
            float3 rdy = mul(ca,  normalize(float3(py, fl)));

            // render
            float3 col = render(ro, rd, rdx, rdy);

            // gain
            // col = col*3.0/(2.5+col);

            // gamma
            col = pow(col, float3(0.4545));

            tot += col;
#if AA > 1
        }
    tot /= float(AA * AA);
#endif

    fragColor = float4(tot, 1.0);
    return fragColor;
}