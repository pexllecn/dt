/**
 * A small tileable noise texture, generated once at start-up, that the ground materials sample
 * instead of evaluating Perlin and cellular noise per pixel. Sampling is a few texture reads
 * where the procedural version was dozens of noise evaluations, and the texture is mipmapped,
 * so fine detail fades smoothly with distance instead of shimmering.
 *
 * Channels (all tile seamlessly):
 *  R  fractal value noise, 4 octaves (mottling)
 *  G  cellular distance (F1), 16 cells across (stones)
 *  B  fractal value noise, 4 octaves, a different seed and twice the base frequency (grain)
 *  A  a random tone per cell of G (stone colour)
 */
import * as THREE from 'three/webgpu';

const SIZE = 256;

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise: the lattice wraps at `period` cells. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u: number, v: number, base: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = base;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(u * f, v * f, f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function createNoiseTexture(): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const cells = 16;
  // Jittered feature point per cell.
  const pts: [number, number, number][] = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([i + 0.15 + 0.7 * hash2(i, j, 91), j + 0.15 + 0.7 * hash2(i, j, 92), hash2(i, j, 93)]);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const k = (y * SIZE + x) * 4;
      data[k] = Math.round(fbm(u, v, 4, 1) * 255);
      // Cellular: nearest feature point, wrapping across the tile edges.
      const cu = u * cells, cv = v * cells;
      const ci = Math.floor(cu), cj = Math.floor(cv);
      let best = 9, tone = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = ci + di, jj = cj + dj;
        const p = pts[(((jj % cells) + cells) % cells) * cells + (((ii % cells) + cells) % cells)]!;
        const px = p[0] + (ii - (((ii % cells) + cells) % cells));
        const py = p[1] + (jj - (((jj % cells) + cells) % cells));
        const dd = Math.hypot(cu - px, cv - py);
        if (dd < best) { best = dd; tone = p[2]; }
      }
      data[k + 1] = Math.round(Math.min(1, best / 0.9) * 255);
      data[k + 2] = Math.round(fbm(u, v, 8, 7) * 255);
      data[k + 3] = Math.round(tone * 255);
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
