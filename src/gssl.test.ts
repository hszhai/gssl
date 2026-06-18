import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gooch, toon, fresnelRim, blinnPhong, brick, hatch, curvatureHatch, GSSL_SHADERS } from './shaders.ts';
import { KERNEL_GAUSSIAN, KERNEL_RING } from './shade.ts';
import { over, grazingMask, type GsslShader, type ShadeInputs } from './gssl.ts';
import type { Vec3 } from './math.ts';

const base = (over: Partial<ShadeInputs>): ShadeInputs => ({
  position: [0, 0, 0], normal: [0, 0, 1], uv: [0, 0], curvature: [0, 0], tangent: [1, 0, 0],
  eye: [0, 0, 5], light: [0, 0, 1], time: 0, ...over,
});

test('gooch: facing the light → warm, facing away → cool', () => {
  const lit = gooch(base({ normal: [0, 0, 1], light: [0, 0, 1] })); // n·l = 1 → warm
  const dark = gooch(base({ normal: [0, 0, -1], light: [0, 0, 1] })); // n·l = -1 → cool
  assert.ok(lit.color[0] > dark.color[0], 'warm should be redder than cool');
  assert.ok(dark.color[2] > lit.color[2], 'cool should be bluer than warm');
});

test('toon: crisp cel (flatness 1) and a finite set of bands over a normal sweep', () => {
  assert.equal(toon(base({})).flatness, 1);
  assert.equal(toon(base({})).kernel, KERNEL_GAUSSIAN);
  const seen = new Set<string>();
  for (let i = 0; i <= 200; i++) {
    const ang = (i / 200) * Math.PI;
    const n: Vec3 = [Math.sin(ang), 0, Math.cos(ang)];
    const c = toon(base({ normal: n, light: [0, 0, 1] })).color;
    seen.add(c.map((x) => x.toFixed(4)).join(','));
  }
  assert.ok(seen.size <= 4, `cel should posterize to ≤4 bands, got ${seen.size}`);
});

test('fresnelRim: facing → disc + base colour, grazing → ring kernel halo', () => {
  const facing = fresnelRim(base({ position: [0, 0, 0], eye: [0, 0, 5], normal: [0, 0, 1] }));
  assert.equal(facing.kernel, KERNEL_GAUSSIAN);
  const grazing = fresnelRim(base({ position: [0, 0, 0], eye: [0, 0, 5], normal: [1, 0, 0] }));
  assert.equal(grazing.kernel, KERNEL_RING);
  assert.ok(grazing.color[2] > facing.color[2], 'rim should glow brighter than the core');
});

test('blinnPhong: a specular hotspot at the mirror direction', () => {
  const hot = blinnPhong(base({ normal: [0, 0, 1], light: [0, 0, 1], eye: [0, 0, 5], position: [0, 0, 0] }));
  const off = blinnPhong(base({ normal: [0, 1, 0], light: [0, 0, 1], eye: [0, 0, 5], position: [0, 0, 0] }));
  const lum = (c: Vec3) => c[0] + c[1] + c[2];
  assert.ok(lum(hot.color) > lum(off.color), 'hotspot should be brighter than off-specular');
});

test('brick: brick body vs mortar gap differ, and brick faces go crisp (flatness 1)', () => {
  const lit = { light: [0, 0, 1] as Vec3, normal: [0, 0, 1] as Vec3 };
  const body = brick(base({ uv: [0.02, 0.02], ...lit }));
  const gap = brick(base({ uv: [0.26, 0.02], ...lit }));
  assert.equal(body.flatness, 1, 'brick faces should be crisp');
  const lum = (c: Vec3) => c[0] + c[1] + c[2];
  assert.notEqual(lum(body.color).toFixed(3), lum(gap.color).toFixed(3));
  assert.ok(gap.color[1] > body.color[1], 'mortar (grey) is greener/lighter than brick (red)');
});

test('brick: alternate courses are offset by half a brick', () => {
  const lit = { light: [0, 0, 1] as Vec3, normal: [0, 0, 1] as Vec3 };
  const even = brick(base({ uv: [0.02, 0.475], ...lit })); // py≈0.07 → no shift → mortar
  const odd = brick(base({ uv: [0.336, 0.475], ...lit })); // py≈1.2 → shifted → brick
  assert.equal(even.flatness, 0, 'even-course sample lands in mortar (soft)');
  assert.equal(odd.flatness, 1, 'shifted odd course lands in a brick (crisp)');
});

test('hatch: lit splats stay round paper, shadowed splats stretch into dark strokes', () => {
  const lit = hatch(base({ normal: [0, 0, 1], light: [0, 0, 1] })); // n·l = 1
  const shad = hatch(base({ normal: [0, 0, 1], light: [0, 0, -1] })); // n·l = -1 → shadow
  assert.ok(Math.abs(lit.aniso![0] - 1) < 1e-9 && Math.abs(lit.aniso![1] - 1) < 1e-9);
  assert.ok(shad.aniso![0] > 3, 'shadow stroke should be long along the tangent');
  assert.ok(shad.aniso![1] < 0.4, 'shadow stroke should be thin across it');
  const lum = (c: Vec3) => c[0] + c[1] + c[2];
  assert.ok(lum(lit.color) > lum(shad.color), 'lit = paper (light), shadow = ink (dark)');
});

test('curvatureHatch: strokes run along the surface grain, lengthening into shadow', () => {
  const grain: Vec3 = [0, 1, 0];
  const lit = curvatureHatch(base({ normal: [0, 0, 1], light: [0, 0, 1], tangent: grain }));
  const shad = curvatureHatch(base({ normal: [0, 0, 1], light: [0, 0, -1], tangent: grain }));
  assert.deepEqual(lit.stroke!.dir, grain, 'stroke follows the principal-curvature grain');
  assert.ok(Math.abs(lit.stroke!.long - 1) < 1e-9, 'lit → unstretched (round)');
  assert.ok(shad.stroke!.long > 5, 'shadow → long stroke');
  assert.ok(shad.stroke!.thin < 0.3, 'shadow → thin stroke');
});

test('runShader: a stroke reorients the splat so its long axis lies along the grain', async () => {
  const { runShader } = await import('./gssl.ts');
  const splat = { position: [0, 0, 0] as Vec3, scale: [0.1, 0.1, 0.02] as Vec3, rotation: [0, 0, 0, 1] as [number, number, number, number], color: [0, 0, 0] as Vec3, opacity: 1 };
  const prov = [{ uv: [0, 0] as [number, number], normal: [0, 0, 1] as Vec3, curvature: [0, 0] as [number, number], tangent: [0, 1, 0] as Vec3 }];
  runShader(curvatureHatch, [splat], prov, { eye: [0, 0, 5], light: [0, 0, -1], time: 0 }, [[0.1, 0.1, 0.02]]);
  const { quatToMat3 } = await import('./math.ts');
  const m = quatToMat3(splat.rotation); // row-major; column 0 = local x = long axis
  const ex: Vec3 = [m[0]!, m[3]!, m[6]!];
  assert.ok(Math.abs(Math.abs(ex[1]) - 1) < 1e-5, `long axis not along grain: ${ex}`);
  assert.ok(splat.scale[0] > splat.scale[1] * 5, 'long axis scaled longer than across');
});

test('over: mask 0 yields the base, mask 1 yields the top, ½ lerps continuous lanes', () => {
  const red: GsslShader = () => ({ color: [1, 0, 0], opacity: 1, flatness: 0, kernel: KERNEL_GAUSSIAN });
  const blue: GsslShader = () => ({ color: [0, 0, 1], opacity: 1, flatness: 1, kernel: KERNEL_RING });
  const i = base({});
  assert.deepEqual(over(red, blue, () => 0)(i).color, [1, 0, 0]);
  assert.deepEqual(over(red, blue, () => 1)(i).color, [0, 0, 1]);
  const mid = over(red, blue, () => 0.5)(i);
  assert.ok(Math.abs(mid.color[0] - 0.5) < 1e-9 && Math.abs(mid.color[2] - 0.5) < 1e-9);
  assert.ok(Math.abs(mid.flatness - 0.5) < 1e-9, 'flatness lerps');
  assert.equal(mid.kernel, KERNEL_RING, 'kernel taken from the dominant layer (mask ≥ ½)');
});

test('grazingMask: ~1 at the silhouette, 0 facing the eye', () => {
  const m = grazingMask(0.3);
  const facing = m(base({ position: [0, 0, 0], eye: [0, 0, 5], normal: [0, 0, 1] }));
  const grazing = m(base({ position: [0, 0, 0], eye: [0, 0, 5], normal: [1, 0, 0] }));
  assert.ok(facing < 0.01, 'normal toward eye → not grazing');
  assert.ok(grazing > 0.99, 'normal ⟂ view → fully grazing');
});

test('GSSL_SHADERS: gallery spans the nine shaders incl. hatch, curvature hatch + composed', () => {
  assert.deepEqual(GSSL_SHADERS.map((s) => s.name),
    ['Gooch', 'Toon', 'Fresnel rim', 'Blinn-Phong', 'Brick', 'Hatch (strokes)', 'Curvature hatch', 'Gooch ⊕ Rim', 'Toon ⊕ Rim']);
});
