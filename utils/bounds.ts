/**
 * Copy bounds from src into out. Bounds layout: [minX, minY, minZ, maxX, maxY, maxZ]
 */
export function copyBounds(out: Float32Array, src: Float32Array): Float32Array {
  out.set(src);
  return out;
}

/**
 * Join two bounds a and b into out using component-wise min/max.
 * Returns out, or null if both inputs are null/undefined.
 * Safe to pass out === a or out === b.
 */
export function joinBounds(
  out: Float32Array,
  a?: Float32Array | null,
  b?: Float32Array | null,
): Float32Array | null {
  if (!a && !b) return null;
  if (!a) return copyBounds(out, b!);
  if (!b) return copyBounds(out, a);

  const aminx = a[0],
    aminy = a[1],
    aminz = a[2],
    amaxx = a[3],
    amaxy = a[4],
    amaxz = a[5];
  const bminx = b[0],
    bminy = b[1],
    bminz = b[2],
    bmaxx = b[3],
    bmaxy = b[4],
    bmaxz = b[5];
  out[0] = Math.min(aminx, bminx);
  out[1] = Math.min(aminy, bminy);
  out[2] = Math.min(aminz, bminz);
  out[3] = Math.max(amaxx, bmaxx);
  out[4] = Math.max(amaxy, bmaxy);
  out[5] = Math.max(amaxz, bmaxz);
  return out;
}

/**
 * Scale bounds src by scale vector [sx,sy,sz] into out.
 * Handles negative scales by swapping min/max per axis as needed.
 */
export function scaleBounds(
  out: Float32Array,
  src: Float32Array,
  scale: number[] | Float32Array,
): Float32Array {
  const sx = (scale as any)?.[0] ?? 1;
  const sy = (scale as any)?.[1] ?? 1;
  const sz = (scale as any)?.[2] ?? 1;

  const x0 = src[0] * sx,
    x1 = src[3] * sx;
  const y0 = src[1] * sy,
    y1 = src[4] * sy;
  const z0 = src[2] * sz,
    z1 = src[5] * sz;

  out[0] = Math.min(x0, x1);
  out[1] = Math.min(y0, y1);
  out[2] = Math.min(z0, z1);
  out[3] = Math.max(x0, x1);
  out[4] = Math.max(y0, y1);
  out[5] = Math.max(z0, z1);
  return out;
}

/* /!\ Warning: AI generated slop utils */
export const quatToMat3RM = (
  q: number[] | Float32Array | undefined,
): Float32Array => {
  // Read real part only if dual quaternion passed
  const x = q?.[0] ?? 0;
  const y = q?.[1] ?? 0;
  const z = q?.[2] ?? 0;
  const w = q?.[3] ?? 1;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  // Row-major layout
  return new Float32Array([
    1 - (yy + zz),
    xy + wz,
    xz - wy,
    xy - wz,
    1 - (xx + zz),
    yz + wx,
    xz + wy,
    yz - wx,
    1 - (xx + yy),
  ]);
};

export const mulMat3RM = (a: Float32Array, b: Float32Array): Float32Array => {
  const out = new Float32Array(9);
  // out = a * b (row-major)
  out[0] = a[0] * b[0] + a[1] * b[3] + a[2] * b[6];
  out[1] = a[0] * b[1] + a[1] * b[4] + a[2] * b[7];
  out[2] = a[0] * b[2] + a[1] * b[5] + a[2] * b[8];

  out[3] = a[3] * b[0] + a[4] * b[3] + a[5] * b[6];
  out[4] = a[3] * b[1] + a[4] * b[4] + a[5] * b[7];
  out[5] = a[3] * b[2] + a[4] * b[5] + a[5] * b[8];

  out[6] = a[6] * b[0] + a[7] * b[3] + a[8] * b[6];
  out[7] = a[6] * b[1] + a[7] * b[4] + a[8] * b[7];
  out[8] = a[6] * b[2] + a[7] * b[5] + a[8] * b[8];
  return out;
};

export const mulMat3Vec3RM = (
  m: Float32Array,
  v: number[] | Float32Array,
): Float32Array => {
  const x = (v as any)?.[0] ?? 0,
    y = (v as any)?.[1] ?? 0,
    z = (v as any)?.[2] ?? 0;
  return new Float32Array([
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ]);
};

export const buildLocalLinearRM = (
  rotation: number[] | Float32Array | undefined,
  scaling: number[] | Float32Array | undefined,
): Float32Array => {
  const r = quatToMat3RM(rotation);
  const sx = (scaling as any)?.[0] ?? 1;
  const sy = (scaling as any)?.[1] ?? 1;
  const sz = (scaling as any)?.[2] ?? 1;
  // R * S (row-major): multiply by diagonal scale
  const s = new Float32Array([sx, 0, 0, 0, sy, 0, 0, 0, sz]);
  return mulMat3RM(r, s);
};

export const transformAabbCornersRM = (
  out: Float32Array,
  src: Float32Array,
  linearRM: Float32Array,
  translation: number[] | Float32Array,
): Float32Array => {
  const minx = src[0],
    miny = src[1],
    minz = src[2],
    maxx = src[3],
    maxy = src[4],
    maxz = src[5];
  const t = translation as any;
  const tx = t?.[0] ?? 0,
    ty = t?.[1] ?? 0,
    tz = t?.[2] ?? 0;

  // Iterate 8 corners
  let wminx = Infinity,
    wminy = Infinity,
    wminz = Infinity,
    wmaxx = -Infinity,
    wmaxy = -Infinity,
    wmaxz = -Infinity;

  const corners: [number, number, number][] = [
    [minx, miny, minz],
    [minx, miny, maxz],
    [minx, maxy, minz],
    [minx, maxy, maxz],
    [maxx, miny, minz],
    [maxx, miny, maxz],
    [maxx, maxy, minz],
    [maxx, maxy, maxz],
  ];

  for (const c of corners) {
    const p = mulMat3Vec3RM(linearRM, c);
    const px = p[0] + tx,
      py = p[1] + ty,
      pz = p[2] + tz;
    if (px < wminx) wminx = px;
    if (py < wminy) wminy = py;
    if (pz < wminz) wminz = pz;
    if (px > wmaxx) wmaxx = px;
    if (py > wmaxy) wmaxy = py;
    if (pz > wmaxz) wmaxz = pz;
  }

  out[0] = wminx;
  out[1] = wminy;
  out[2] = wminz;
  out[3] = wmaxx;
  out[4] = wmaxy;
  out[5] = wmaxz;
  return out;
};

export const mat3IdentityRM = (): Float32Array =>
  new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
