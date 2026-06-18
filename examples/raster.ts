import { v3cross, v3dot, v3normalize, v3sub, quatToMat3, type Vec3, type Vec4 } from '../src/math.ts';
import { SHADE_FLATNESS, SHADE_KERNEL, SHADE_STRIDE, kernelQuadSigma, KERNEL_BASE_SIGMA } from '../src/shade.ts';
import type { Splat } from '../src/types.ts';

// ─────────────────────────────────────────────────────────────
// A tiny CPU software rasterizer for the examples — NOT part of the published
// GSSL core (the core is renderer-agnostic). It's the minimum needed to turn a
// shaded splat cloud into a PNG: EWA projection + the per-splat kernel falloff
// (flatness / ring) the shade bus carries + back-to-front `over` blending.
// Mirrors the offline rasterizer in the reference renderer (emerging-splats).
// ─────────────────────────────────────────────────────────────

export type Mat4 = Float32Array; // 16 elements, column-major

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const zAxis = v3normalize(v3sub(eye, target));
  const xAxis = v3normalize(v3cross(up, zAxis));
  const yAxis = v3cross(zAxis, xAxis);
  return new Float32Array([
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -v3dot(xAxis, eye), -v3dot(yAxis, eye), -v3dot(zAxis, eye), 1,
  ]);
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Per-fragment falloff, mirroring the GPU fragment shader. */
function kernelAlpha(m2: number, flatness: number, kernel: number): number {
  if (kernel === 1) { // KERNEL_RING
    const m = Math.sqrt(m2);
    const halfw = 0.9 + (0.3 - 0.9) * flatness;
    const d = (m - 2.0) / halfw;
    return Math.exp(-0.5 * d * d);
  }
  const gaussA = Math.exp(-0.5 * m2);
  const flatA = 1 - smoothstep(6, 9, m2);
  return gaussA + (flatA - gaussA) * flatness;
}

const NEAR_CULL = -0.2;
const DILATE = 0.15;

/** Render shaded splats to a y-up RGBA8 buffer. */
export function rasterize(
  splats: Splat[],
  view: Mat4,
  proj: Mat4,
  width: number,
  height: number,
  background: [number, number, number],
  shade?: Float32Array | null,
): Uint8ClampedArray {
  const N = width * height;
  const fr = new Float32Array(N), fg = new Float32Array(N), fb = new Float32Array(N);
  fr.fill(background[0]); fg.fill(background[1]); fb.fill(background[2]);

  interface P { depth: number; cx: number; cy: number; cnX: number; cnY: number; cnZ: number; radius: number; r: number; g: number; b: number; opacity: number; flatness: number; kernel: number; }
  const projected: P[] = [];

  for (let i = 0; i < splats.length; i++) {
    const s = splats[i]!;
    if (s.opacity < 0.004) continue;
    const cam = transformPoint(view, s.position);
    const z = cam[2];
    if (z > NEAR_CULL) continue;

    const Rw = quatToMat3(s.rotation as Vec4);
    const sx = s.scale[0], sy = s.scale[1], sz = s.scale[2];
    const w00 = view[0]!, w01 = view[4]!, w02 = view[8]!;
    const w10 = view[1]!, w11 = view[5]!, w12 = view[9]!;
    const w20 = view[2]!, w21 = view[6]!, w22 = view[10]!;
    const c0 = w00 * Rw[0]! + w01 * Rw[3]! + w02 * Rw[6]!, c1 = w00 * Rw[1]! + w01 * Rw[4]! + w02 * Rw[7]!, c2 = w00 * Rw[2]! + w01 * Rw[5]! + w02 * Rw[8]!;
    const c3 = w10 * Rw[0]! + w11 * Rw[3]! + w12 * Rw[6]!, c4 = w10 * Rw[1]! + w11 * Rw[4]! + w12 * Rw[7]!, c5 = w10 * Rw[2]! + w11 * Rw[5]! + w12 * Rw[8]!;
    const c6 = w20 * Rw[0]! + w21 * Rw[3]! + w22 * Rw[6]!, c7 = w20 * Rw[1]! + w21 * Rw[4]! + w22 * Rw[7]!, c8 = w20 * Rw[2]! + w21 * Rw[5]! + w22 * Rw[8]!;
    const rs0 = c0 * sx, rs1 = c1 * sy, rs2 = c2 * sz;
    const rs3 = c3 * sx, rs4 = c4 * sy, rs5 = c5 * sz;
    const rs6 = c6 * sx, rs7 = c7 * sy, rs8 = c8 * sz;
    const sig00 = rs0 * rs0 + rs1 * rs1 + rs2 * rs2;
    const sig01 = rs0 * rs3 + rs1 * rs4 + rs2 * rs5;
    const sig02 = rs0 * rs6 + rs1 * rs7 + rs2 * rs8;
    const sig11 = rs3 * rs3 + rs4 * rs4 + rs5 * rs5;
    const sig12 = rs3 * rs6 + rs4 * rs7 + rs5 * rs8;
    const sig22 = rs6 * rs6 + rs7 * rs7 + rs8 * rs8;

    const focalX = proj[0]! * width * 0.5;
    const focalY = proj[5]! * height * 0.5;
    const z2 = z * z;
    const j00 = focalX / z, j02 = -focalX * cam[0] / z2;
    const j11 = focalY / z, j12 = -focalY * cam[1] / z2;
    let cxx = j00 * j00 * sig00 + 2 * j00 * j02 * sig02 + j02 * j02 * sig22;
    const cxy = j00 * j11 * sig01 + j00 * j12 * sig02 + j02 * j11 * sig12 + j02 * j12 * sig22;
    let cyy = j11 * j11 * sig11 + 2 * j11 * j12 * sig12 + j12 * j12 * sig22;
    cxx += DILATE; cyy += DILATE;

    const det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) < 1e-8) continue;
    const cnX = cyy / det, cnY = -cxy / det, cnZ = cxx / det;
    const trace = cxx + cyy;
    const disc = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) + 4 * cxy * cxy));
    const radius = 3 * Math.sqrt(Math.max((trace + disc) * 0.5, 0));

    const clipW = proj[3]! * cam[0] + proj[7]! * cam[1] + proj[11]! * cam[2] + proj[15]!;
    if (Math.abs(clipW) < 1e-6) continue;
    const ndcX = (proj[0]! * cam[0] + proj[4]! * cam[1] + proj[8]! * cam[2] + proj[12]!) / clipW;
    const ndcY = (proj[1]! * cam[0] + proj[5]! * cam[1] + proj[9]! * cam[2] + proj[13]!) / clipW;

    let flatness = 0, kernel = 0;
    if (shade) {
      const b = i * SHADE_STRIDE;
      const f = shade[b + SHADE_FLATNESS]; if (f === f) flatness = f!;
      const k = shade[b + SHADE_KERNEL]; if (k === k) kernel = k!;
    }
    projected.push({
      depth: -z, cx: (ndcX * 0.5 + 0.5) * width, cy: (ndcY * 0.5 + 0.5) * height,
      cnX, cnY, cnZ, radius, r: s.color[0], g: s.color[1], b: s.color[2], opacity: s.opacity, flatness, kernel,
    });
  }
  projected.sort((a, b) => b.depth - a.depth);

  for (const p of projected) {
    const R = Math.ceil(p.radius * (kernelQuadSigma(p.kernel) / KERNEL_BASE_SIGMA));
    const x0 = Math.max(0, Math.floor(p.cx - R)), x1 = Math.min(width - 1, Math.ceil(p.cx + R));
    const y0 = Math.max(0, Math.floor(p.cy - R)), y1 = Math.min(height - 1, Math.ceil(p.cy + R));
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - p.cy;
      const rowBase = py * width;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - p.cx;
        const m2 = p.cnX * dx * dx + 2 * p.cnY * dx * dy + p.cnZ * dy * dy;
        let a = kernelAlpha(m2, p.flatness, p.kernel) * p.opacity;
        if (a < 0.003) continue;
        if (a > 1) a = 1;
        const idx = rowBase + px, ia = 1 - a;
        fr[idx] = p.r * a + fr[idx]! * ia;
        fg[idx] = p.g * a + fg[idx]! * ia;
        fb[idx] = p.b * a + fb[idx]! * ia;
      }
    }
  }

  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    out[i * 4] = fr[i]! * 255; out[i * 4 + 1] = fg[i]! * 255; out[i * 4 + 2] = fb[i]! * 255; out[i * 4 + 3] = 255;
  }
  return out; // y-up
}
