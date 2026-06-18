import { v3add, v3dot, v3normalize, v3scale, v3sub, type Vec3 } from './math.ts';
import { toonColor } from './toon.ts';
import { KERNEL_GAUSSIAN, KERNEL_RING } from './shade.ts';
import { over, grazingMask, type GsslShader } from './gssl.ts';

// ─────────────────────────────────────────────────────────────
// The GSSL standard library — classic shading models re-created as GSSL shaders
// to show the language spans the canon. Each is a pure (inputs → appearance)
// function, and each reaches for a splat-native lane (kernel / flatness / stroke)
// a screen-space shader cannot — so it's the model PLUS something only splats do.
// ─────────────────────────────────────────────────────────────

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Gooch cool-to-warm (Gooch et al. 1998). Diffuse maps a cool→warm ramp instead
 *  of dark→light — the classic technical-illustration look. */
export const gooch: GsslShader = (i) => {
  const n = v3normalize(i.normal);
  const l = v3normalize(i.light);
  const t = 0.5 * (1 + v3dot(n, l)); // [-1,1] → [0,1]
  const cool: Vec3 = [0.08, 0.12, 0.46];
  const warm: Vec3 = [0.86, 0.62, 0.18];
  return { color: lerp3(cool, warm, t), opacity: 1, flatness: 0, kernel: KERNEL_GAUSSIAN };
};

/** Cel / toon: quantized Lambert into bands, with flatness=1 so each splat is a
 *  flat-topped disk — the fills read crisp and posterized, not feathered. */
export const toon: GsslShader = (i) => {
  const albedo: Vec3 = [0.92, 0.52, 0.34];
  const color = toonColor(v3normalize(i.normal), v3normalize(i.light), albedo, 4, 0.16);
  return { color, opacity: 1, flatness: 1, kernel: KERNEL_GAUSSIAN };
};

/** Fresnel rim: a view-dependent grazing glow (pow(1−|n·v|, k)). The rim band
 *  switches to the ring kernel for a splat-native halo a pixel shader can't make. */
export const fresnelRim: GsslShader = (i) => {
  const n = v3normalize(i.normal);
  const v = v3normalize(v3sub(i.eye, i.position));
  const f = Math.pow(1 - Math.abs(v3dot(n, v)), 3);
  const base: Vec3 = [0.10, 0.13, 0.20];
  const glow: Vec3 = [0.5, 0.9, 1.0];
  const onRim = f > 0.55;
  return {
    color: lerp3(base, glow, clamp01(f)),
    opacity: 1,
    flatness: onRim ? 0.5 : 0,
    kernel: onRim ? KERNEL_RING : KERNEL_GAUSSIAN,
  };
};

/** Blinn-Phong: ambient + Lambert diffuse + a specular highlight (n·h)^s. */
export const blinnPhong: GsslShader = (i) => {
  const n = v3normalize(i.normal);
  const l = v3normalize(i.light);
  const v = v3normalize(v3sub(i.eye, i.position));
  const diff = Math.max(0, v3dot(n, l));
  const h = v3normalize(v3add(l, v));
  const spec = Math.pow(Math.max(0, v3dot(n, h)), 48);
  const albedo: Vec3 = [0.72, 0.26, 0.24];
  const lit = v3scale(albedo, 0.13 + 0.85 * diff);
  return { color: v3add(lit, [spec * 0.9, spec * 0.9, spec * 0.9]), opacity: 1, flatness: 0, kernel: KERNEL_GAUSSIAN };
};

const fract = (x: number) => x - Math.floor(x);

/** The Orange Book procedural brick (OpenGL Shading Language), rebuilt in GSSL.
 *  Laid in UV space (provenance) so it wraps the surface cleanly. Per-splat point
 *  sample → a splat-resolution mosaic; the twist: brick faces go flat-topped
 *  (crisp tiles), mortar stays soft Gaussian (recedes). */
export const brick: GsslShader = (i) => {
  const BRICK: [number, number] = [0.5, 0.28]; // cell size (v, u) in radians
  const PCT: [number, number] = [0.86, 0.8]; // brick fraction of the cell (rest = mortar)
  let px = i.uv[1] / BRICK[0]; // azimuth → columns
  let py = i.uv[0] / BRICK[1]; // polar → rows
  if (fract(py * 0.5) > 0.5) px += 0.5; // offset alternate courses by half a brick
  px = fract(px);
  py = fract(py);
  const isBrick = px < PCT[0] && py < PCT[1]; // step(position, BrickPct)
  const brickCol: Vec3 = [0.61, 0.19, 0.13];
  const mortarCol: Vec3 = [0.76, 0.74, 0.68];
  const nl = Math.max(0, v3dot(v3normalize(i.normal), v3normalize(i.light)));
  const light = 0.28 + 0.72 * nl; // ambient + Lambert
  return {
    color: v3scale(isBrick ? brickCol : mortarCol, light),
    opacity: 1,
    flatness: isBrick ? 1 : 0, // crisp brick faces, soft mortar
    kernel: KERNEL_GAUSSIAN,
  };
};

/** Pen-and-ink HATCHING — the splat-native one. Each splat becomes an oriented
 *  stroke (anisotropic footprint along its eu tangent), so the marks follow the
 *  surface flow; strokes lengthen, darken and thin into shadow while lit areas
 *  stay round paper. A pixel shader can recolour a fragment but cannot turn the
 *  primitive into a brush stroke aligned to the geometry — the axis only splats
 *  have. */
export const hatch: GsslShader = (i) => {
  const n = v3normalize(i.normal);
  const l = v3normalize(i.light);
  const shadow = 1 - Math.max(0, v3dot(n, l)); // 0 lit → 1 shadow
  const paper: Vec3 = [0.93, 0.9, 0.83];
  const ink: Vec3 = [0.08, 0.08, 0.11];
  return {
    color: [paper[0] + (ink[0] - paper[0]) * shadow, paper[1] + (ink[1] - paper[1]) * shadow, paper[2] + (ink[2] - paper[2]) * shadow],
    opacity: 1,
    flatness: 1, // crisp stroke edge
    kernel: KERNEL_GAUSSIAN,
    aniso: [1 + 5.5 * shadow, 1 - 0.82 * shadow], // lit: round; shadow: long + thin = a stroke
  };
};

/** CURVATURE HATCHING — the stroke-system payoff. Each splat becomes a stroke
 *  laid along the surface's principal-curvature grain (provenance.tangent), so
 *  the marks follow the form's actual structure rather than a parameter axis.
 *  A tonal field (Lambert) drives length + darkness: lit areas are short, faint;
 *  shadow grows long, dark strokes — engraving that wraps the geometry. */
export const curvatureHatch: GsslShader = (i) => {
  const n = v3normalize(i.normal);
  const l = v3normalize(i.light);
  const tone = 1 - Math.max(0, v3dot(n, l)); // 0 lit → 1 shadow
  const paper: Vec3 = [0.94, 0.91, 0.84];
  const ink: Vec3 = [0.07, 0.07, 0.1];
  return {
    color: [paper[0] + (ink[0] - paper[0]) * tone, paper[1] + (ink[1] - paper[1]) * tone, paper[2] + (ink[2] - paper[2]) * tone],
    opacity: 1,
    flatness: 1,
    kernel: KERNEL_GAUSSIAN,
    stroke: { dir: i.tangent, long: 1 + 6 * tone, thin: 1 - 0.82 * tone }, // along the grain
  };
};

// ── Composed shaders — proof the operator makes a language, not a menu ──────
// The SAME `over(_, fresnelRim, grazingMask)` recipe layered onto two different
// bases: a cool-to-warm body or a cel body, each gaining the ring-kernel halo.
export const goochRim: GsslShader = over(gooch, fresnelRim, grazingMask(0.5));
export const toonRim: GsslShader = over(toon, fresnelRim, grazingMask(0.45));

export interface NamedShader {
  name: string;
  shade: GsslShader;
}

/** The gallery, in display order. */
export const GSSL_SHADERS: NamedShader[] = [
  { name: 'Gooch', shade: gooch },
  { name: 'Toon', shade: toon },
  { name: 'Fresnel rim', shade: fresnelRim },
  { name: 'Blinn-Phong', shade: blinnPhong },
  { name: 'Brick', shade: brick },
  { name: 'Hatch (strokes)', shade: hatch },
  { name: 'Curvature hatch', shade: curvatureHatch },
  { name: 'Gooch ⊕ Rim', shade: goochRim },
  { name: 'Toon ⊕ Rim', shade: toonRim },
];
