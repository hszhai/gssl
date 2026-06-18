// ─────────────────────────────────────────────────────────────
// The shade bus — GSSL's WIRE FORMAT (the substrate the language compiles to).
//
// A host renderer keeps GLOBAL knobs (one flatness/kernel for the whole frame).
// The shade bus instead carries a per-splat appearance program: lane `L` of splat
// `i` lives at `i·SHADE_STRIDE + L`, in the renderer's draw order. That is what
// lets every splat rasterize differently in one draw call — a shading language
// attaching a program per primitive rather than per scene.
//
//   L0 flatness: 0 = smooth Gaussian splat, 1 = flat-topped disk (crisp NPR edge).
//   L1 kernel:   which falloff family the splat paints with (see KERNEL_*).
//
// A lane left at SHADE_INHERIT (NaN) falls back to the host's global value for
// that splat, so a scene can shade some splats and leave the rest on the default.
// ─────────────────────────────────────────────────────────────

export const SHADE_FLATNESS = 0; // lane offset: falloff shape (continuous)
export const SHADE_KERNEL = 1; // lane offset: falloff family (KERNEL_* enum)
export const SHADE_STRIDE = 2; // floats per splat (grows as lanes are added)

/** A lane value meaning "use the host renderer's global value for this splat". */
export const SHADE_INHERIT = NaN;

// ── Kernel family (L1) ──────────────────────────────────────────
// The falloff every 3DGS renderer hardcodes is KERNEL_GAUSSIAN. Selecting it per
// splat is the axis vanilla splatting can't express. (Plain consts, not a TS
// enum — type-stripping forbids enums.) Kernels only resolve on splats large
// enough to show the profile.
export const KERNEL_GAUSSIAN = 0; // exp(-½m²) — the classic EWA splat
export const KERNEL_RING = 1; // hollow annulus — bokeh donuts, cells, rim-only marks
export type Kernel = typeof KERNEL_GAUSSIAN | typeof KERNEL_RING;

// The bounding quad must cover the kernel's support, or the fragment falloff gets
// clipped at the quad rim. A Gaussian is dead by 3σ (exp(-4.5)≈0.01); the ring
// peaks at 2σ and its tail needs ~5σ to fade out.
export const KERNEL_BASE_SIGMA = 3;
export function kernelQuadSigma(kernel: number): number {
  return Math.round(kernel) === KERNEL_RING ? 5 : KERNEL_BASE_SIGMA;
}

export interface Appearance {
  /** Falloff shape: 0 = smooth Gaussian splat, 1 = flat-topped disk (crisp edge). */
  flatness: number;
  /** Falloff family: KERNEL_GAUSSIAN | KERNEL_RING. Default Gaussian. */
  kernel: Kernel;
}

/** Pack per-splat appearances into the shade bus (host draw order). */
export function packShade(items: Appearance[]): Float32Array {
  const buf = new Float32Array(items.length * SHADE_STRIDE);
  for (let i = 0; i < items.length; i++) {
    const base = i * SHADE_STRIDE;
    buf[base + SHADE_FLATNESS] = items[i]!.flatness;
    buf[base + SHADE_KERNEL] = items[i]!.kernel;
  }
  return buf;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ── Lane nodes ──────────────────────────────────────────────────
// Small pure functions mapping provenance/state to a lane value — the composable
// building blocks a shader reaches for.

/** Wet ink keeps a soft Gaussian edge; dry ink reads crisp. flatness = dryness. */
export function inkEdgeFlatness(wetness: number): number {
  return 1 - clamp01(wetness);
}

/** Provenance → kernel: the surface's Gaussian curvature (κ₁·κ₂) picks the
 *  falloff family. Saddle / negatively-curved regions become hollow rings;
 *  convex / flat regions stay solid discs. Structure chooses the look. */
export function curvatureKernel(k1: number, k2: number): Kernel {
  return k1 * k2 < 0 ? KERNEL_RING : KERNEL_GAUSSIAN;
}

/** View-dependent provenance → kernel: splats grazing the view (|n·v| < τ, the
 *  occluding contour) become rings, so the object grows a halo rim that slides as
 *  the camera orbits; splats facing the eye stay solid discs. */
export function silhouetteKernel(nDotV: number, tau: number): Kernel {
  return nDotV < tau ? KERNEL_RING : KERNEL_GAUSSIAN;
}
