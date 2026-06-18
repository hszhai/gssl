import type { Splat, SplatProvenance, Vec3 } from '../src/index.ts';

// A provenance-rich sphere of splats: every shader input (normal, uv, curvature,
// tangent) is well-defined, so the whole gallery — including the uv-space brick
// and the curvature-grain hatching — has real data to shade against.

export interface SphereCloud {
  splats: Splat[];
  prov: SplatProvenance[];
  restScale: Vec3[];
}

export function makeSphere(latBands = 110, lonBands = 220, radius = 1): SphereCloud {
  const splats: Splat[] = [];
  const prov: SplatProvenance[] = [];
  const restScale: Vec3[] = [];
  const s = radius * (Math.PI / latBands) * 1.05; // disc radius ≈ row spacing
  const thin = s * 0.3; // thickness along the normal

  for (let i = 1; i < latBands; i++) { // skip the exact poles (degenerate)
    const theta = (i / latBands) * Math.PI; // polar [0,π]
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let j = 0; j < lonBands; j++) {
      const phi = (j / lonBands) * 2 * Math.PI; // azimuth [0,2π]
      const sp = Math.sin(phi), cp = Math.cos(phi);
      const n: Vec3 = [st * cp, ct, st * sp]; // unit normal
      const pos: Vec3 = [n[0] * radius, n[1] * radius, n[2] * radius];
      // meridian tangent (∂pos/∂θ) — the surface grain strokes run along
      const tan: Vec3 = [ct * cp, -st, ct * sp];
      splats.push({ position: pos, scale: [s, s, thin], rotation: [0, 0, 0, 1], color: [0, 0, 0], opacity: 1 });
      prov.push({ normal: n, uv: [theta, phi], curvature: [1 / radius, 1 / radius], tangent: tan });
      restScale.push([s, s, thin]);
    }
  }
  return { splats, prov, restScale };
}
