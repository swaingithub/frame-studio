import type { AdjustValues } from '../adjustments/registry'

/**
 * GLSL source for the single-pass photo/video filter pipeline, assembled from
 * the shared adjustment registry concept. All uniform values are normalized
 * by host code (see pipeline.ts) before upload.
 */

export const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  // 3-vertex fullscreen triangle, no buffers needed (WebGL2 gl_VertexID)
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  vUV = p;
}`

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform mat3 uUVMatrix;     // output uv (y-down) -> source uv (y-down)
uniform vec2 uInvSource;    // 1/source pixel size, for neighbor taps
uniform vec2 uOutSize;      // output size in px

uniform float uExposure;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uTemperature;
uniform float uTint;
uniform float uSaturation;
uniform float uVibrance;
uniform float uSharpness;
uniform float uClarity;
uniform float uNoiseReduction;
uniform float uVignette;
uniform float uGrain;

// Tone curve: five master knots + parametric shadows/darks/lights/highlights (−1..1).
uniform vec4 uCurveY;
uniform float uCurveY4;
uniform vec4 uParametric;

// HSL mixer: 8 hue bands, packed as two vec4s each (−1..1).
uniform vec4 uHslHue0;
uniform vec4 uHslHue1;
uniform vec4 uHslSat0;
uniform vec4 uHslSat1;
uniform vec4 uHslLum0;
uniform vec4 uHslLum1;

// Chroma key (green screen): 0/1, key color, chroma radius, edge softness, spill suppression.
uniform float uKeyEnabled;
uniform vec3 uKeyColor;
uniform float uKeySimilarity;
uniform float uKeySmoothness;
uniform float uKeySpill;

// Shape mask: 0=none,1=linear,2=circle,3=rect,4=mirror,5=heart,6=star.
uniform float uMaskShape;
uniform float uMaskX;
uniform float uMaskY;
uniform float uMaskW;
uniform float uMaskH;
uniform float uMaskRotation;
uniform float uMaskFeather;
uniform float uMaskInvert;

// AI background removal: mask texture (alpha = subject confidence), 0/1.
uniform sampler2D uBgTex;
uniform float uBgEnabled;

in vec2 vUV;
out vec4 fragColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float lumaOf(vec3 c) { return dot(c, LUMA); }

/** Chroma of a color in the Cb/Cr plane (≈ [-0.5, 0.5], 0.5 = neutral). */
vec2 chromaOf(vec3 c) {
  float cb = -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;
  float cr = 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;
  return vec2(cb, cr);
}

vec3 sampleSrc(vec2 uvYD) {
  // uv (y-down) → texture uv (y-up): flip both ends
  vec2 texUV = vec2(uvYD.x, 1.0 - uvYD.y);
  if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
    return vec3(0.0);
  }
  return texture(uTex, texUV).rgb;
}

float hashNoise(vec2 p) {
  p = fract(p * vec2(127.34, 311.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float curveKnot(int i) {
  if (i == 0) return uCurveY.x;
  if (i == 1) return uCurveY.y;
  if (i == 2) return uCurveY.z;
  if (i == 3) return uCurveY.w;
  return uCurveY4;
}

float applyCurve(float x) {
  x = clamp(x, 0.0, 1.0);
  float t = x * 4.0;
  int i = int(min(3.0, floor(t)));
  float f = t - float(i);
  f = f * f * (3.0 - 2.0 * f);
  return mix(curveKnot(i), curveKnot(i + 1), f);
}

float parametricLift(float l) {
  float shadows = 1.0 - smoothstep(0.0, 0.5, l);
  float darks = smoothstep(0.0, 0.35, l) * (1.0 - smoothstep(0.35, 0.7, l));
  float lights = smoothstep(0.3, 0.65, l) * (1.0 - smoothstep(0.65, 1.0, l));
  float highs = smoothstep(0.5, 1.0, l);
  return uParametric.x * 0.28 * shadows
       + uParametric.y * 0.22 * darks
       + uParametric.z * 0.22 * lights
       + uParametric.w * 0.28 * highs;
}

vec3 rgbToHsl(vec3 c) {
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  float l = (maxc + minc) * 0.5;
  float d = maxc - minc;
  float s = d < 1e-5 ? 0.0 : d / max(1e-5, 1.0 - abs(2.0 * l - 1.0));
  float h = 0.0;
  if (d > 1e-5) {
    if (maxc == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
    if (h < 0.0) h += 1.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  float h = hsl.x;
  float s = clamp(hsl.y, 0.0, 1.0);
  float l = clamp(hsl.z, 0.0, 1.0);
  if (s < 1e-5) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0 / 3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0 / 3.0)
  );
}

float circDist(float a, float b) {
  float d = abs(a - b);
  return min(d, 1.0 - d);
}

float hueBand(float h, float center) {
  return 1.0 - smoothstep(0.02, 0.09, circDist(h, center));
}

vec3 applyHslMixer(vec3 c) {
  vec3 hsl = rgbToHsl(c);
  const float centers[8] = float[8](0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.75, 0.9167);
  float hues[8];
  hues[0] = uHslHue0.x; hues[1] = uHslHue0.y; hues[2] = uHslHue0.z; hues[3] = uHslHue0.w;
  hues[4] = uHslHue1.x; hues[5] = uHslHue1.y; hues[6] = uHslHue1.z; hues[7] = uHslHue1.w;
  float sats[8];
  sats[0] = uHslSat0.x; sats[1] = uHslSat0.y; sats[2] = uHslSat0.z; sats[3] = uHslSat0.w;
  sats[4] = uHslSat1.x; sats[5] = uHslSat1.y; sats[6] = uHslSat1.z; sats[7] = uHslSat1.w;
  float lums[8];
  lums[0] = uHslLum0.x; lums[1] = uHslLum0.y; lums[2] = uHslLum0.z; lums[3] = uHslLum0.w;
  lums[4] = uHslLum1.x; lums[5] = uHslLum1.y; lums[6] = uHslLum1.z; lums[7] = uHslLum1.w;

  float hShift = 0.0;
  float sMul = 0.0;
  float lAdd = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = hueBand(hsl.x, centers[i]);
    hShift += hues[i] * w;
    sMul += sats[i] * w;
    lAdd += lums[i] * w;
    wsum += w;
  }
  if (wsum < 1e-4) return c;
  hShift /= wsum;
  sMul /= wsum;
  lAdd /= wsum;
  hsl.x = fract(hsl.x + hShift * 0.18 + 1.0);
  hsl.y = clamp(hsl.y * (1.0 + sMul * 0.9), 0.0, 1.0);
  hsl.z = clamp(hsl.z + lAdd * 0.25, 0.0, 1.0);
  return hslToRgb(hsl);
}

/**
 * Shape-mask coverage in output UV. 1 = keep, 0 = reveal nothing.
 * Feather is a soft ramp measured in UV, so edges stay soft at any resolution.
 */
float maskAlpha(vec2 uv) {
  if (uMaskShape < 0.5) return 1.0;
  vec2 hs = max(vec2(0.001), vec2(uMaskW, uMaskH) * 0.5);
  float f = max(0.001, uMaskFeather);
  // Mirror is a content fold, handled at sample time — always fully covered.
  if (uMaskShape > 3.5 && uMaskShape < 4.5) return 1.0;

  vec2 p = uv - vec2(uMaskX, uMaskY);
  float a = radians(-uMaskRotation);
  float cs = cos(a);
  float sn = sin(a);
  p = mat2(cs, -sn, sn, cs) * p;

  float d;
  if (uMaskShape < 1.5) {
    // Linear: a soft-edged band centred on the mask position.
    d = abs(p.x) - hs.x;
  } else if (uMaskShape < 2.5) {
    // Ellipse (w = h gives a circle).
    float r = length(p / hs);
    d = (r - 1.0) * min(hs.x, hs.y);
  } else if (uMaskShape < 3.5) {
    // Rectangle.
    vec2 q = abs(p) - hs;
    d = max(q.x, q.y);
  } else if (uMaskShape < 5.5) {
    // Heart: (x² + y² − 1)³ − x²y³ ≤ 0, normalized into the mask box.
    vec2 q = p / hs;
    q.x *= 1.15;
    q.y = -q.y + 0.12;
    float t = q.x * q.x + q.y * q.y - 0.85;
    d = (t * t * t - 0.4 * q.x * q.x * q.y * q.y * q.y) * 0.45;
  } else {
    // 5-point star in polar space.
    float ang = atan(p.y, p.x) + 1.5708;
    float rad = length(p / hs);
    float star = 0.55 + 0.45 * cos(5.0 * ang);
    d = (rad - star) * min(hs.x, hs.y);
  }

  float m = 1.0 - smoothstep(-f, f, d);
  return uMaskInvert > 0.5 ? 1.0 - m : m;
}

void main() {
  vec2 uvYD = vec2(vUV.x, 1.0 - vUV.y);
  // Mirror mask folds the frame around its vertical centre.
  vec2 sampleUV = uvYD;
  if (uMaskShape > 3.5 && uMaskShape < 4.5) {
    sampleUV.x = 0.5 - abs(sampleUV.x - 0.5);
  }
  vec2 srcYD = (uUVMatrix * vec3(sampleUV, 1.0)).xy;
  vec3 c = sampleSrc(srcYD);
  float srcL = lumaOf(c);

  // 0. Chroma key — computed on the untouched source so grading the subject
  //    never shifts what drops out. Alpha rides through the whole pipeline.
  float keyA = 1.0;
  float keyD = 1.0;
  if (uKeyEnabled > 0.5) {
    keyD = distance(chromaOf(c), chromaOf(uKeyColor));
    keyA = smoothstep(uKeySimilarity, uKeySimilarity + max(0.01, uKeySmoothness), keyD);
    // Spill suppression: neutralize the key hue on kept pixels near the edge.
    if (uKeySpill > 0.001 && keyA > 0.0) {
      float prox = (1.0 - smoothstep(uKeySimilarity, uKeySimilarity + max(0.02, uKeySmoothness) * 1.5, keyD)) * keyA;
      c = mix(c, vec3(lumaOf(c)), uKeySpill * prox * 0.85);
    }
  }

  // 1. Noise reduction — gentle 5-tap box blend
  if (uNoiseReduction > 0.0) {
    vec3 blur = (
      sampleSrc(srcYD + vec2(-1.0, 0.0) * uInvSource) +
      sampleSrc(srcYD + vec2( 1.0, 0.0) * uInvSource) +
      sampleSrc(srcYD + vec2( 0.0,-1.0) * uInvSource) +
      sampleSrc(srcYD + vec2( 0.0, 1.0) * uInvSource) + c
    ) * 0.2;
    c = mix(c, blur, uNoiseReduction * 0.85);
  }

  // 2. White balance
  float t = uTemperature;
  c.r *= 1.0 + 0.22 * t;
  c.b *= 1.0 - 0.18 * t;
  c.g *= 1.0 + 0.03 * t;
  c.g *= 1.0 - 0.10 * uTint;
  c.r *= 1.0 - 0.04 * uTint;
  c.b *= 1.0 - 0.04 * uTint;

  // 3. Exposure (±1.6 stops)
  c *= exp2(uExposure * 1.6);

  // 4. Zone corrections on smooth luma masks
  float l = lumaOf(c);
  float highMask = smoothstep(0.35, 0.95, l);
  float shadowMask = 1.0 - smoothstep(0.05, 0.65, l);
  float whiteMask = smoothstep(0.55, 1.0, l);
  float blackMask = 1.0 - smoothstep(0.0, 0.45, l);
  c += uHighlights * 0.35 * highMask;
  c += uShadows * 0.30 * shadowMask;
  c += uWhites * 0.25 * whiteMask;
  c += uBlacks * 0.25 * blackMask;

  // 5. Contrast around mid-gray
  c = (c - 0.5) * (1.0 + 0.6 * uContrast) + 0.5;

  // 5b. Parametric tone + master curve (industry-standard photo-lab path)
  c += parametricLift(lumaOf(c));
  c = vec3(applyCurve(c.r), applyCurve(c.g), applyCurve(c.b));

  // 6. Saturation & vibrance
  float l2 = lumaOf(c);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l2), c, 1.0 + 0.9 * uSaturation);
  c = mix(vec3(lumaOf(c)), c, 1.0 + 0.8 * uVibrance * (1.0 - clamp(sat, 0.0, 1.0)));

  // 6b. HSL mixer (per-hue hue/sat/luma)
  c = applyHslMixer(c);

  // 7. Clarity — local contrast on a wide-radius luminance estimate
  if (abs(uClarity) > 0.001) {
    vec2 r = uInvSource * 6.0;
    float bl = (
      lumaOf(sampleSrc(srcYD + vec2( r.x,  r.y))) +
      lumaOf(sampleSrc(srcYD + vec2(-r.x,  r.y))) +
      lumaOf(sampleSrc(srcYD + vec2( r.x, -r.y))) +
      lumaOf(sampleSrc(srcYD + vec2(-r.x, -r.y)))
    ) * 0.25;
    c += (srcL - bl) * uClarity * 0.6 * vec3(1.0);
  }

  // 8. Sharpness — 1-texel unsharp mask
  if (uSharpness > 0.001) {
    vec3 n = (
      sampleSrc(srcYD + vec2(-1.0, 0.0) * uInvSource) +
      sampleSrc(srcYD + vec2( 1.0, 0.0) * uInvSource) +
      sampleSrc(srcYD + vec2( 0.0,-1.0) * uInvSource) +
      sampleSrc(srcYD + vec2( 0.0, 1.0) * uInvSource)
    ) * 0.25;
    c += (c - n) * uSharpness * 1.3;
  }

  // 9. Vignette
  if (abs(uVignette) > 0.001) {
    float d = length(uvYD - vec2(0.5)) / length(vec2(0.5));
    c *= 1.0 - uVignette * 0.7 * smoothstep(0.35, 0.85, d);
  }

  // 10. Grain — deterministic per-source-pixel mono noise
  if (uGrain > 0.001) {
    float g = hashNoise(floor(srcYD * 2048.0));
    c += (g - 0.5) * uGrain * 0.25;
  }

  // Premultiplied-alpha output: keyed and masked fragments carry alpha so 2D
  // compositing (drawImage) blends them correctly.
  float outA = keyA * maskAlpha(uvYD);
  // AI background removal: multiply by the segmentation mask (soft edges —
  // the model outputs per-pixel subject confidence).
  if (uBgEnabled > 0.5) {
    outA *= texture(uBgTex, uvYD).a;
  }
  c *= outA;
  fragColor = vec4(clamp(c, 0.0, 1.0), outA);
}`

/** Normalized (0..1) uniform values for the fragment shader. */
export function shaderUniforms(a: AdjustValues): Record<string, number> {
  const n = (v: number): number => v / 100
  return {
    uExposure: n(a.exposure),
    uContrast: n(a.contrast),
    uHighlights: n(a.highlights),
    uShadows: n(a.shadows),
    uWhites: n(a.whites),
    uBlacks: n(a.blacks),
    uTemperature: n(a.temperature),
    uTint: n(a.tint),
    uSaturation: n(a.saturation),
    uVibrance: n(a.vibrance),
    uSharpness: n(a.sharpness),
    uClarity: n(a.clarity),
    uNoiseReduction: n(a.noiseReduction),
    uVignette: n(a.vignette),
    uGrain: n(a.grain),
  }
}
