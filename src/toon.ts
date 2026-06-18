import { v3dot, v3normalize, type Vec3 } from './math.ts';

// Toon / cel shading helpers (used by the `toon` shader in the stdlib gallery).

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Quantize an intensity in [0,1] into `bands` discrete levels. */
export function quantize(intensity: number, bands: number): number {
  const t = clamp01(intensity);
  const level = Math.min(bands - 1, Math.floor(t * bands));
  return level / (bands - 1);
}

/** Banded Lambert: ambient + (1−ambient)·quantized(n·l). */
export function toonShade(normal: Vec3, lightDir: Vec3, bands: number, ambient = 0.15): number {
  const d = Math.max(0, v3dot(v3normalize(normal), v3normalize(lightDir)));
  return ambient + (1 - ambient) * quantize(d, bands);
}

/** Banded Lambert applied to a base albedo. */
export function toonColor(normal: Vec3, lightDir: Vec3, base: Vec3, bands: number, ambient = 0.15): Vec3 {
  const s = toonShade(normal, lightDir, bands, ambient);
  return [base[0] * s, base[1] * s, base[2] * s];
}
