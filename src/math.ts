// GSSL math — the minimal vector/quaternion helpers the language needs. Ported
// from emerging-splats; kept tiny and dependency-free on purpose.

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export function v3add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function v3sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function v3scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function v3dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function v3cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function v3length(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}
export function v3normalize(a: Vec3): Vec3 {
  const len = v3length(a);
  if (len < 1e-8) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** Quaternion [x,y,z,w] from a 3×3 rotation matrix (column-major Float32Array). */
export function mat3ToQuat(m: Float32Array): Vec4 {
  const trace = m[0]! + m[4]! + m[8]!;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m[5]! - m[7]!) * s;
    y = (m[6]! - m[2]!) * s;
    z = (m[1]! - m[3]!) * s;
  } else if (m[0]! > m[4]! && m[0]! > m[8]!) {
    const s = 2.0 * Math.sqrt(1.0 + m[0]! - m[4]! - m[8]!);
    w = (m[5]! - m[7]!) / s;
    x = 0.25 * s;
    y = (m[3]! + m[1]!) / s;
    z = (m[6]! + m[2]!) / s;
  } else if (m[4]! > m[8]!) {
    const s = 2.0 * Math.sqrt(1.0 + m[4]! - m[0]! - m[8]!);
    w = (m[6]! - m[2]!) / s;
    x = (m[3]! + m[1]!) / s;
    y = 0.25 * s;
    z = (m[7]! + m[5]!) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m[8]! - m[0]! - m[4]!);
    w = (m[1]! - m[3]!) / s;
    x = (m[6]! + m[2]!) / s;
    y = (m[7]! + m[5]!) / s;
    z = 0.25 * s;
  }
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  return [x / len, y / len, z / len, w / len];
}

/** Quaternion from an orthonormal basis (columns ex, ey, ez). */
export function quatFromAxes(ex: Vec3, ey: Vec3, ez: Vec3): Vec4 {
  const cm = new Float32Array([ex[0], ex[1], ex[2], ey[0], ey[1], ey[2], ez[0], ez[1], ez[2]]);
  return mat3ToQuat(cm);
}

/** Row-major 3×3 rotation matrix from a quaternion [x,y,z,w]. */
export function quatToMat3(q: Vec4): Float32Array {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]);
}
