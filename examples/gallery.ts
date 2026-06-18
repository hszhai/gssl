import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runShader, GSSL_SHADERS, type Vec3 } from '../src/index.ts';
import { makeSphere } from './sphere.ts';
import { rasterize, mat4LookAt, mat4Perspective } from './raster.ts';
import { encodePNG } from './png.ts';

// ─────────────────────────────────────────────────────────────
// The GSSL gallery — renders every stdlib shader on a sphere to a PNG, plus a
// 3×3 montage. The visual proof for the README: each classic model PLUS the
// splat-native lane it reaches for (crisp cel disks, ring-kernel rim halos,
// curvature-grain strokes). Self-contained: `node examples/gallery.ts`.
// ─────────────────────────────────────────────────────────────

const TILE = 320;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out'); // gitignored: individual tiles (regenerable)
const docsDir = join(here, '..', 'docs'); // committed: the montage for the README
mkdirSync(outDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

const eye: Vec3 = [1.7, 1.15, 2.4];
// Light to the side (not behind the camera) so the lit→shadow terminator falls
// across the VISIBLE hemisphere — otherwise the tonal shaders (hatching) only
// vary on the back face and read as blank spheres.
const light: Vec3 = [-0.55, 0.4, 0.28];
const bg: [number, number, number] = [0.58, 0.58, 0.62]; // neutral so both ink and lit shaders read
const view = mat4LookAt(eye, [0, 0, 0], [0, 1, 0]);
const proj = mat4Perspective(Math.PI / 4, 1, 0.05, 50);

/** y-up RGBA → top-down (PNG order). */
function flipY(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(rgba.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// montage grid (3×3 with a gutter)
const cols = 3, rows = Math.ceil(GSSL_SHADERS.length / cols), gut = 10;
const mW = cols * TILE + (cols + 1) * gut, mH = rows * TILE + (rows + 1) * gut;
const montage = new Uint8ClampedArray(mW * mH * 4);
for (let i = 0; i < montage.length; i += 4) { montage[i] = 20; montage[i + 1] = 20; montage[i + 2] = 24; montage[i + 3] = 255; }

GSSL_SHADERS.forEach((entry, k) => {
  const { splats, prov, restScale } = makeSphere(); // fresh cloud per shader (shaders mutate scale/rotation)
  const bus = runShader(entry.shade, splats, prov, { eye, light, time: 0 }, restScale);
  const img = flipY(rasterize(splats, view, proj, TILE, TILE, bg, bus), TILE, TILE);
  writeFileSync(join(outDir, `${slug(entry.name)}.png`), encodePNG(img, TILE, TILE));

  const col = k % cols, r = Math.floor(k / cols);
  const ox = gut + col * (TILE + gut), oy = gut + r * (TILE + gut);
  for (let y = 0; y < TILE; y++) {
    const dst = ((oy + y) * mW + ox) * 4;
    montage.set(img.subarray(y * TILE * 4, (y + 1) * TILE * 4), dst);
  }
  console.log(`  ${entry.name} → ${slug(entry.name)}.png`);
});

const montagePng = encodePNG(montage, mW, mH);
writeFileSync(join(outDir, 'gallery.png'), montagePng);
writeFileSync(join(docsDir, 'gallery.png'), montagePng); // committed for the README
console.log(`gallery: ${GSSL_SHADERS.length} shaders → out/ (+ docs/gallery.png montage ${mW}×${mH})`);
