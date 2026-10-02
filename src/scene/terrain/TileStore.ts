import {
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
} from 'three/webgpu';
import { DATA_ROOT, type TerrainManifest } from './manifest';
import type { DecodeRequest, DecodeResponse } from './tileWorker';

export interface Tile {
  level: number;
  tx: number;
  ty: number;
  texture: DataTexture;
  heights: Float32Array;
  min: number;
  max: number;
  lastUsed: number;
}

const key = (l: number, x: number, y: number) => `${l}/${x}/${y}`;

/** Never evicted: the coarse levels always cover the island. */
const PINNED_LEVELS = 3;

export class TileStore {
  readonly manifest: TerrainManifest;
  readonly maxLevel: number;
  readonly samples: number;
  private readonly available = new Map<number, Set<string>>();
  private readonly tiles = new Map<string, Tile>();
  private readonly pending = new Set<string>();
  private readonly queue: [number, number, number][] = [];
  private readonly workers: Worker[] = [];
  private readonly callbacks = new Map<number, (r: DecodeResponse) => void>();
  private nextId = 1;
  private busy = 0;
  private frame = 0;
  budget = 420;
  /** Called when a tile finishes loading (to request a redraw). */
  onLoad: (() => void) | null = null;

  constructor(manifest: TerrainManifest, workerCount = 3) {
    this.manifest = manifest;
    this.samples = manifest.tilePx + 1;
    let maxLevel = 0;
    for (const [l, info] of Object.entries(manifest.levels)) {
      const level = Number(l);
      maxLevel = Math.max(maxLevel, level);
      this.available.set(level, new Set(info.tiles.map(([x, y]) => `${x}/${y}`)));
    }
    this.maxLevel = maxLevel;
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent<DecodeResponse>) => {
        const cb = this.callbacks.get(ev.data.id);
        this.callbacks.delete(ev.data.id);
        cb?.(ev.data);
      };
      this.workers.push(w);
    }
  }

  tileSize(level: number): number {
    return this.manifest.domain.size / 2 ** level;
  }

  has(level: number, tx: number, ty: number): boolean {
    return this.available.get(level)?.has(`${tx}/${ty}`) ?? false;
  }

  /** Returns a loaded tile, or undefined and queues it. */
  get(level: number, tx: number, ty: number): Tile | undefined {
    const k = key(level, tx, ty);
    const t = this.tiles.get(k);
    if (t) {
      t.lastUsed = this.frame;
      return t;
    }
    if (!this.pending.has(k) && this.has(level, tx, ty)) {
      this.pending.add(k);
      this.queue.push([level, tx, ty]);
    }
    return undefined;
  }

  peek(level: number, tx: number, ty: number): Tile | undefined {
    return this.tiles.get(key(level, tx, ty));
  }

  /** Coarse levels, awaited before first render so the island is never missing. */
  async preload(levels = PINNED_LEVELS): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (let l = 0; l < levels; l++) {
      for (const [x, y] of this.manifest.levels[String(l)]?.tiles ?? []) jobs.push(this.load(l, x, y));
    }
    await Promise.all(jobs);
  }

  /** Called once per frame: dispatch queued loads (nearest-first ordering is the caller's job). */
  pump(maxInFlight = 6): void {
    this.frame++;
    while (this.busy < maxInFlight && this.queue.length) {
      const [l, x, y] = this.queue.shift()!;
      void this.load(l, x, y);
    }
    if (this.tiles.size > this.budget) this.evict();
  }

  /** Clears queued requests that were not dispatched (they are re-requested if still needed). */
  clearQueue(): void {
    for (const [l, x, y] of this.queue) this.pending.delete(key(l, x, y));
    this.queue.length = 0;
  }

  private decode(req: Omit<DecodeRequest, 'id' | 'hOffset' | 'hScale' | 'sdfScale'>): Promise<DecodeResponse> {
    const id = this.nextId++;
    const enc = this.manifest.encoding;
    const w = this.workers[id % this.workers.length]!;
    return new Promise((resolve) => {
      this.callbacks.set(id, resolve);
      w.postMessage({ ...req, id, hOffset: enc.hOffset, hScale: enc.hScale, sdfScale: enc.sdfScale } satisfies DecodeRequest);
    });
  }

  private async load(level: number, tx: number, ty: number): Promise<void> {
    const k = key(level, tx, ty);
    this.pending.add(k);
    this.busy++;
    try {
      const r = await this.decode({ url: `${DATA_ROOT}/L${level}/${tx}_${ty}.png`, kind: 'tile' });
      if (!r.ok || !r.gpu || !r.heights) throw new Error(r.error ?? 'decode failed');
      const tex = new DataTexture(r.gpu, r.width!, r.height!, RGFormat, HalfFloatType);
      configure(tex);
      this.tiles.set(k, { level, tx, ty, texture: tex, heights: r.heights, min: r.min!, max: r.max!, lastUsed: this.frame });
      this.onLoad?.();
    } catch (e) {
      console.warn('terrain tile failed', k, e);
    } finally {
      this.pending.delete(k);
      this.busy--;
    }
  }

  async loadNational(): Promise<{ sdf: DataTexture; mask: DataTexture }> {
    const [s, m] = await Promise.all([
      this.decode({ url: `${DATA_ROOT}/national_sdf.png`, kind: 'sdf' }),
      this.decode({ url: `${DATA_ROOT}/national_mask.png`, kind: 'rgb8' }),
    ]);
    if (!s.ok || !m.ok) throw new Error(`national textures: ${s.error ?? m.error}`);
    const sdf = new DataTexture(s.gpu!, s.width!, s.height!, RedFormat, HalfFloatType);
    const mask = new DataTexture(m.gpu!, m.width!, m.height!, RGBAFormat, UnsignedByteType);
    configure(sdf);
    configure(mask);
    return { sdf, mask };
  }

  private evict(): void {
    const candidates = [...this.tiles.values()]
      .filter((t) => t.level >= PINNED_LEVELS && t.lastUsed < this.frame - 2)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const t of candidates.slice(0, this.tiles.size - this.budget)) {
      t.texture.dispose();
      this.tiles.delete(key(t.level, t.tx, t.ty));
    }
  }

  /** Raw terrain height (m, unexaggerated) at ITM-relative domain coordinates, from the finest loaded tile. */
  heightAtDomain(u: number, v: number): number {
    // u: metres east of domain west edge; v: metres south of domain north edge
    const size = this.manifest.domain.size;
    if (u < 0 || v < 0 || u > size || v > size) return 0;
    for (let l = this.maxLevel; l >= 0; l--) {
      const ts = size / 2 ** l;
      const tx = Math.min(Math.floor(u / ts), 2 ** l - 1);
      const ty = Math.min(Math.floor(v / ts), 2 ** l - 1);
      const t = this.tiles.get(key(l, tx, ty));
      if (!t) continue;
      const px = ((u - tx * ts) / ts) * (this.samples - 1);
      const py = ((v - ty * ts) / ts) * (this.samples - 1);
      return bilinear(t.heights, this.samples, px, py);
    }
    return 0;
  }
}

function configure(t: DataTexture) {
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
}

export function bilinear(data: Float32Array, n: number, px: number, py: number): number {
  const x0 = Math.max(0, Math.min(n - 2, Math.floor(px)));
  const y0 = Math.max(0, Math.min(n - 2, Math.floor(py)));
  const fx = px - x0;
  const fy = py - y0;
  const i = y0 * n + x0;
  const a = data[i]!;
  const b = data[i + 1]!;
  const c = data[i + n]!;
  const d = data[i + n + 1]!;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
