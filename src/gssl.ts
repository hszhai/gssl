import { v3add, v3cross, v3dot, v3length, v3normalize, v3scale, v3sub, quatFromAxes, type Vec3 } from './math.ts';
import type { Splat, SplatProvenance } from './types.ts';
import { packShade, type Appearance } from './shade.ts';

// ─────────────────────────────────────────────────────────────
// GSSL — the Gaussian-Splat Shading Language (author-facing layer).
//
// shade.ts is the SUBSTRATE: the per-splat appearance bus the renderer consumes.
// GSSL is the LANGUAGE on top: a shader is ONE pure function from a splat's inputs
// (intrinsics + provenance + frame uniforms) to its full appearance — colour,
// opacity, AND the splat-native falloff lanes (flatness, kernel) and footprint.
//
// That last part is what a screen-space pixel shader can't be: a GSSL shader
// shapes the PRIMITIVE'S FOOTPRINT, not just the colour at a pixel. The classic
// models (Gooch, toon, Fresnel, Phong) re-express cleanly here AND gain a
// splat-native axis — e.g. a crisp cel disk, or a ring-kernel rim halo.
//
//   inputs (per splat)        uniforms (per frame)        output (per splat)
//   position, normal,    +    eye, light, time      →     color, opacity,
//   uv, curvature, tangent                                flatness, kernel, stroke
// ─────────────────────────────────────────────────────────────

/** Per-frame "uniforms" shared by every splat the shader runs over. */
export interface Frame {
  eye: Vec3; // camera position (world)
  light: Vec3; // directional light (world, points toward the light)
  time: number; // seconds
}

/** Everything a GSSL shader sees for one splat: its intrinsics + provenance + the
 *  frame uniforms. */
export interface ShadeInputs extends Frame {
  position: Vec3;
  normal: Vec3;
  uv: [number, number];
  curvature: [number, number]; // principal κ₁, κ₂
  tangent: Vec3; // principal-curvature direction (surface grain) — drives strokes
}

/** What a GSSL shader produces: the visible appearance, spanning the colour path
 *  (color/opacity, written into the splat), the shade bus (flatness/kernel), and
 *  the footprint (aniso = in-plane scale multipliers along the splat's own tangent
 *  axes eu/ev). aniso/stroke are the splat-native axis a pixel shader has no
 *  analogue for: they reshape the PRIMITIVE into an oriented stroke. */
export interface ShadeOutput extends Appearance {
  color: Vec3;
  opacity: number;
  // Two ways to reshape the footprint into a stroke (both render via the splat's
  // covariance — no special renderer path):
  //   aniso — scale along the splat's OWN tangent axes (eu/ev). Simple flow.
  //   stroke — lay the splat along an ARBITRARY in-plane world direction `dir`
  //            (e.g. the principal-curvature grain); `long`/`thin` = footprint
  //            multipliers. The general case: curvature-aligned hatching.
  aniso?: [number, number];
  stroke?: { dir: Vec3; long: number; thin: number };
}

/** A GSSL shader is one pure function. Compose, swap, and test them freely. */
export type GsslShader = (i: ShadeInputs) => ShadeOutput;

/** A scalar field over the surface, [0,1] — the selector that composes shaders. */
export type Mask = (i: ShadeInputs) => number;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Layer `top` over `base` by `mask`: the compositing operator that turns the
 *  gallery into a language. Continuous lanes lerp; the discrete kernel is taken
 *  from whichever layer dominates (mask ≥ ½). */
export function over(base: GsslShader, top: GsslShader, mask: Mask): GsslShader {
  return (i) => {
    const m = clamp01(mask(i));
    const b = base(i);
    if (m <= 0) return b;
    const t = top(i);
    const ba = b.aniso ?? [1, 1];
    const ta = t.aniso ?? [1, 1];
    return {
      color: [b.color[0] + (t.color[0] - b.color[0]) * m, b.color[1] + (t.color[1] - b.color[1]) * m, b.color[2] + (t.color[2] - b.color[2]) * m],
      opacity: b.opacity + (t.opacity - b.opacity) * m,
      flatness: b.flatness + (t.flatness - b.flatness) * m,
      kernel: m >= 0.5 ? t.kernel : b.kernel,
      aniso: [ba[0] + (ta[0] - ba[0]) * m, ba[1] + (ta[1] - ba[1]) * m],
    };
  };
}

// ── Masks (the composable selectors) ─────────────────────────────
/** 1 where the surface grazes the view (the silhouette band), 0 facing. */
export const grazingMask = (tau: number): Mask => (i) => {
  const n = i.normal, p = i.position, e = i.eye;
  const vx = e[0] - p[0], vy = e[1] - p[1], vz = e[2] - p[2];
  const vl = Math.hypot(vx, vy, vz) || 1;
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  const nv = Math.abs((n[0] * vx + n[1] * vy + n[2] * vz) / (vl * nl));
  return clamp01((tau - nv) / tau);
};

/** 1 in shadow (facing away from the light), 0 in full light — for hatching. */
export const shadowMask: Mask = (i) => {
  const n = i.normal, l = i.light;
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  const ll = Math.hypot(l[0], l[1], l[2]) || 1;
  return clamp01(1 - Math.max(0, (n[0] * l[0] + n[1] * l[1] + n[2] * l[2]) / (nl * ll)));
};

const DEFAULT_NORMAL: Vec3 = [0, 0, 1];
const DEFAULT_TANGENT: Vec3 = [1, 0, 0];

/** Reorient + scale a splat so its footprint is a stroke of world size
 *  `long`×`thin`×`sigmaN` laid along `dir`, projected into the tangent plane
 *  (⟂ `normal`). Returns false if `dir` is ~parallel to the normal (no in-plane
 *  direction → leave the splat alone). The GSSL footprint primitive. */
export function orientStroke(s: Splat, dir: Vec3, normal: Vec3, long: number, thin: number, sigmaN: number): boolean {
  const inPlane = v3sub(dir, v3scale(normal, v3dot(dir, normal)));
  if (v3length(inPlane) < 1e-5) return false;
  const ex = v3normalize(inPlane); // stroke long axis (in the tangent plane)
  const ey = v3normalize(v3cross(normal, ex)); // across the stroke
  s.rotation = quatFromAxes(ex, ey, normal);
  s.scale = [long, thin, sigmaN];
  return true;
}

function layStroke(s: Splat, stroke: { dir: Vec3; long: number; thin: number }, normal: Vec3, rmean: number, sigmaN: number): boolean {
  return orientStroke(s, stroke.dir, normal, rmean * stroke.long, rmean * stroke.thin, sigmaN);
}

/** Run a shader over every splat — the GSSL "draw call". Writes colour/opacity
 *  (and, when the shader sets `aniso`/`stroke`, the splat's in-plane scale +
 *  rotation) back into the splats and returns the packed shade bus (flatness +
 *  kernel) to hand to the host renderer. `restScale` is the unstretched scale per
 *  splat (snapshot at build) so aniso is applied fresh each frame, not
 *  compounded. One call re-shades the whole object for a frame. */
export function runShader(
  shader: GsslShader,
  splats: Splat[],
  prov: readonly (SplatProvenance | undefined)[],
  frame: Frame,
  restScale?: readonly Vec3[],
): Float32Array {
  const appear: Appearance[] = new Array(splats.length);
  for (let k = 0; k < splats.length; k++) {
    const s = splats[k]!;
    const p = prov[k];
    const normal = p?.normal ?? DEFAULT_NORMAL;
    const out = shader({
      position: s.position,
      normal,
      uv: p?.uv ?? [0, 0],
      curvature: p?.curvature ?? [0, 0],
      tangent: p?.tangent ?? DEFAULT_TANGENT,
      eye: frame.eye,
      light: frame.light,
      time: frame.time,
    });
    s.color = out.color;
    s.opacity = out.opacity;
    if (restScale) {
      const r = restScale[k]!;
      const rmean = (r[0] + r[1]) * 0.5;
      if (out.stroke && layStroke(s, out.stroke, normal, rmean, r[2])) {
        // s.rotation/scale set by layStroke
      } else if (out.aniso) {
        s.scale = [r[0] * out.aniso[0], r[1] * out.aniso[1], r[2]];
      } else {
        s.scale = [r[0], r[1], r[2]]; // reset to rest for the unstretched shaders
      }
    }
    appear[k] = { flatness: out.flatness, kernel: out.kernel };
  }
  return packShade(appear);
}
