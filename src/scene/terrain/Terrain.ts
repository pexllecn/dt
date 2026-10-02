import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Frustum,
  Group,
  HalfFloatType,
  Matrix4,
  Mesh,
  RGFormat,
  Vector3,
  type PerspectiveCamera,
} from 'three/webgpu';
import { ORIGIN_E, ORIGIN_N } from '@/lib/geo';
import { TileStore, type Tile } from './TileStore';
import { createTerrainMaterial, GRID_N, national, type TerrainNodeMaterial } from './terrainMaterial';
import { world } from '../world/uniforms';

/** Unit grid in x/z (0..1) with a skirt ring; the material displaces it. */
function createGridGeometry(n: number): BufferGeometry {
  const side = n + 1;
  const ring = 4 * n;
  const pos = new Float32Array((side * side + ring) * 3);
  const skirt = new Float32Array(side * side + ring);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      pos[k * 3] = i / n;
      pos[k * 3 + 2] = j / n;
    }
  }
  const border: number[] = [];
  for (let i = 0; i < n; i++) border.push(i); // north edge, west to east
  for (let j = 0; j < n; j++) border.push(j * side + n); // east edge
  for (let i = n; i > 0; i--) border.push(n * side + i); // south edge
  for (let j = n; j > 0; j--) border.push(j * side); // west edge
  border.forEach((src, r) => {
    const k = side * side + r;
    pos[k * 3] = pos[src * 3]!;
    pos[k * 3 + 2] = pos[src * 3 + 2]!;
    skirt[k] = 1;
  });
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // Alternate the diagonal to avoid directional artefacts.
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  for (let r = 0; r < ring; r++) {
    const a = border[r]!;
    const b = border[(r + 1) % ring]!;
    const sa = side * side + r;
    const sb = side * side + ((r + 1) % ring);
    idx.push(a, b, sa, b, sb, sa);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('skirt', new BufferAttribute(skirt, 1));
  g.setIndex(idx);
  return g;
}

interface SelectedNode {
  level: number;
  tx: number;
  ty: number;
  tile: Tile;
}

interface PoolEntry {
  mesh: Mesh;
  mat: TerrainNodeMaterial;
}

export interface TerrainStats {
  nodes: number;
  triangles: number;
  tilesLoaded: number;
}

/**
 * Chunked LOD terrain (CDLOD). Each frame the quadtree is traversed from the root;
 * a node is split while the camera is within the next level's range. Selected nodes
 * are drawn with a shared grid and pooled materials; vertices geomorph towards the
 * parent grid at the outer edge of their range so level transitions never pop.
 */
export class Terrain {
  readonly group = new Group();
  readonly store: TileStore;
  readonly maxNodeLevel = 8;
  /** Always split to at least this level so national views use 512 m height data for shading. */
  readonly minNodeLevel = 2;
  /** Range factor: node level L is split when within K x (cell size of L+1). Lower is faster. */
  rangeK = 300;
  private readonly geometry = createGridGeometry(GRID_N);
  private readonly pool: PoolEntry[] = [];
  private readonly placeholder: DataTexture;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly box = new Box3();
  private readonly camPos = new Vector3();
  private readonly selected: SelectedNode[] = [];
  private readonly e0: number;
  private readonly n1: number;
  private readonly size: number;
  stats: TerrainStats = { nodes: 0, triangles: 0, tilesLoaded: 0 };

  constructor(store: TileStore) {
    this.store = store;
    this.group.name = 'terrain';
    const d = store.manifest.domain;
    this.e0 = d.e0;
    this.n1 = d.n1;
    this.size = d.size;
    this.placeholder = new DataTexture(new Uint16Array(257 * 257 * 2), 257, 257, RGFormat, HalfFloatType);
    this.placeholder.needsUpdate = true;
    national.origin.value.set(this.e0 - ORIGIN_E, -(this.n1 - ORIGIN_N));
    national.size.value = this.size;
  }

  private nodeSize(level: number): number {
    return this.size / 2 ** level;
  }

  private range(level: number): number {
    return this.rangeK * (this.nodeSize(level) / GRID_N);
  }

  /** Deepest loaded tile covering the node, while requesting the ideal one. */
  private tileFor(level: number, tx: number, ty: number): Tile | undefined {
    const store = this.store;
    let ideal = -1;
    for (let t = Math.min(level, store.maxLevel); t >= 0; t--) {
      const s = level - t;
      if (store.has(t, tx >> s, ty >> s)) {
        ideal = t;
        break;
      }
    }
    if (ideal < 0) return undefined;
    for (let t = ideal; t >= 0; t--) {
      const s = level - t;
      const tile = t === ideal ? store.get(t, tx >> s, ty >> s) : store.peek(t, tx >> s, ty >> s);
      if (tile) return tile;
    }
    return undefined;
  }

  private hasLand(level: number, tx: number, ty: number): boolean {
    const l = Math.min(level, 5);
    const s = level - l;
    return this.store.has(l, tx >> s, ty >> s);
  }

  private nodeBox(level: number, tx: number, ty: number, tile: Tile | undefined, ex: number): Box3 {
    const s = this.nodeSize(level);
    const x0 = this.e0 - ORIGIN_E + tx * s;
    const z0 = -(this.n1 - ORIGIN_N) + ty * s;
    const maxH = tile ? tile.max : 1100;
    return this.box.set(new Vector3(x0, -100 * ex, z0), new Vector3(x0 + s, Math.max(10, maxH) * ex, z0 + s));
  }

  private traverse(level: number, tx: number, ty: number, ex: number): void {
    if (!this.hasLand(level, tx, ty)) return;
    const tile = this.tileFor(level, tx, ty);
    const box = this.nodeBox(level, tx, ty, tile, ex);
    if (!this.frustum.intersectsBox(box)) return;
    const dist = box.distanceToPoint(this.camPos);
    if (level < this.maxNodeLevel && (level < this.minNodeLevel || dist < this.range(level + 1))) {
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) this.traverse(level + 1, tx * 2 + i, ty * 2 + j, ex);
      return;
    }
    if (tile) this.selected.push({ level, tx, ty, tile });
  }

  update(camera: PerspectiveCamera): void {
    const ex = world.exaggeration.value;
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, camera.coordinateSystem);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.selected.length = 0;
    this.store.clearQueue();
    this.traverse(0, 0, 0, ex);
    // Nearest-first loading: re-order the queue that traversal produced.
    this.store.pump();

    while (this.pool.length < this.selected.length) {
      const mat = createTerrainMaterial(this.placeholder);
      const mesh = new Mesh(this.geometry, mat.material);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = true;
      this.group.add(mesh);
      this.pool.push({ mesh, mat });
    }
    let triangles = 0;
    this.pool.forEach((entry, i) => {
      const node = this.selected[i];
      entry.mesh.visible = !!node;
      if (!node) return;
      const s = this.nodeSize(node.level);
      entry.mesh.position.set(this.e0 - ORIGIN_E + node.tx * s, 0, -(this.n1 - ORIGIN_N) + node.ty * s);
      const t = node.tile;
      const shift = node.level - t.level;
      const scale = 1 / 2 ** shift;
      entry.mat.size.value = s;
      entry.mat.uvScale.value = scale;
      entry.mat.uvOffset.value.set((node.tx - (t.tx << shift)) * scale, (node.ty - (t.ty << shift)) * scale);
      entry.mat.texSpacing.value = this.nodeSize(t.level) / 256;
      const r = this.range(node.level);
      entry.mat.morph.value.set(r * 0.82, r * 0.98);
      entry.mat.setTexture(t.texture);
      triangles += GRID_N * GRID_N * 2;
    });
    this.stats = { nodes: this.selected.length, triangles, tilesLoaded: 0 };
  }

  /** Raw height (m) under a scene point. */
  heightAt(x: number, z: number): number {
    const u = x + ORIGIN_E - this.e0;
    const v = z + (this.n1 - ORIGIN_N);
    return this.store.heightAtDomain(u, v);
  }
}
