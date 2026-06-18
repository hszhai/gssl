import type { Vec3, Vec4 } from './math.ts';

// ─────────────────────────────────────────────────────────────
// The RENDERER CONTRACT. GSSL is renderer-agnostic: these are the only shapes a
// host renderer has to share with it. A `Splat` is the intrinsic primitive a
// GSSL shader writes appearance into; `SplatProvenance` is the per-splat surface
// info a shader reads. Every provenance field is optional — runShader supplies a
// sane default — so a host can provide as little as positions and still shade.
// ─────────────────────────────────────────────────────────────

/** The intrinsic render primitive: a 3D Gaussian. */
export interface Splat {
  position: Vec3;
  scale: Vec3; // σx, σy, σz (ellipsoid radii in world units)
  rotation: Vec4; // quaternion [x, y, z, w]
  color: Vec3; // linear rgb
  opacity: number; // [0, 1]
}

/** Per-splat surface provenance a shader may read (all optional). */
export interface SplatProvenance {
  normal?: Vec3;
  uv?: [number, number];
  curvature?: [number, number]; // principal κ₁, κ₂
  tangent?: Vec3; // principal-curvature direction (surface grain)
}
