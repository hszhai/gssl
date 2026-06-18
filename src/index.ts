// GSSL — the Gaussian-Splat Shading Language. Public API.

// Renderer contract (the shapes a host renderer shares with GSSL)
export type { Splat, SplatProvenance } from './types.ts';
export type { Vec3, Vec4 } from './math.ts';

// Core language: the shader function type, composition operator, masks, runtime
export type { Frame, ShadeInputs, ShadeOutput, GsslShader, Mask } from './gssl.ts';
export { over, grazingMask, shadowMask, orientStroke, runShader } from './gssl.ts';

// Substrate (the shade bus the language compiles to)
export {
  SHADE_FLATNESS, SHADE_KERNEL, SHADE_STRIDE, SHADE_INHERIT,
  KERNEL_GAUSSIAN, KERNEL_RING, KERNEL_BASE_SIGMA, kernelQuadSigma,
  packShade, inkEdgeFlatness, curvatureKernel, silhouetteKernel,
} from './shade.ts';
export type { Kernel, Appearance } from './shade.ts';

// Standard library (the shader gallery)
export {
  gooch, toon, fresnelRim, blinnPhong, brick, hatch, curvatureHatch,
  goochRim, toonRim, GSSL_SHADERS,
} from './shaders.ts';
export type { NamedShader } from './shaders.ts';

// Toon helpers (used by the gallery; handy on their own)
export { quantize, toonShade, toonColor } from './toon.ts';
