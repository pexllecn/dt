import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three/webgpu';
import { float, mix, uniform } from 'three/tsl';
import { itmToScene } from '@/lib/geo';
import type { ModelMeta } from '@/sim/protocol';
import type { NetNode, NetworkData } from '@/sim/types';
import { Builder } from './geometry';
import { world } from '../world/uniforms';

/**
 * Substations laid out inside their real OpenStreetMap footprints, and data centre campuses.
 * Built procedurally and lazily when the camera comes near; one merged mesh per material.
 */
type Mat = 'steel' | 'concrete' | 'gravel' | 'aluminium' | 'transformer' | 'insulator' | 'cladding' | 'roof' | 'windows';

interface Rect {
  cx: number;
  cz: number;
  angle: number; // rotation of the long axis from +x
  long: number;
  short: number;
}

interface SiteDef {
  id: string;
  kind: 'substation' | 'campus';
  x: number;
  z: number;
  rect: Rect;
  node?: NetNode;
  bays: Map<number, number>; // kV -> bay count
  transformers: { hi: number; lo: number; units: number }[];
  halls: number;
}

/** Minimum-area bounding rectangle by rotating the footprint in 3° steps. */
function minRect(pts: [number, number][]): Rect {
  let best: Rect | null = null;
  for (let a = 0; a < 180; a += 3) {
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of pts) {
      const u = x * c + z * s;
      const v = -x * s + z * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.long * best.short) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const du = maxU - minU;
      const dv = maxV - minV;
      best = {
        cx: cu * c - cv * s,
        cz: cu * s + cv * c,
        angle: du >= dv ? r : r + Math.PI / 2,
        long: Math.max(du, dv),
        short: Math.min(du, dv),
      };
    }
  }
  return best!;
}

function material(hex: string, metalness: number, roughness: number, emissive?: boolean): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.color = new Color(hex);
  m.metalness = metalness;
  m.roughness = roughness;
  if (emissive) {
    // Lit windows and soffits at dusk; driven by the simulated sun.
    m.emissiveNode = mix(float(0), float(1), world.night).mul(uniform(new Color('#ffd9a0'))).mul(2.2);
  }
  return m;
}

export class Sites {
  readonly group = new Group();
  private readonly defs: SiteDef[] = [];
  private readonly built = new Map<string, Group>();
  private readonly heightAt: (x: number, z: number) => number;
  private readonly mats: Record<Mat, MeshStandardNodeMaterial> = {
    steel: material('#a2a7ab', 0.75, 0.45),
    concrete: material('#bdb8ae', 0, 0.85),
    gravel: material('#aaa59b', 0, 0.95),
    aluminium: material('#d3d6d8', 0.9, 0.3),
    transformer: material('#77817c', 0.35, 0.55),
    insulator: material('#5b3d2f', 0.05, 0.25),
    cladding: material('#c9cbcb', 0.2, 0.6),
    roof: material('#8f9396', 0.4, 0.55),
    windows: material('#22282d', 0.1, 0.2, true),
  };
  private timer = 0;

  constructor(net: NetworkData, meta: ModelMeta, campuses: { id: string; station: string; halls: number }[], heightAt: (x: number, z: number) => number) {
    this.heightAt = heightAt;
    this.group.name = 'sites';
    const nodeById = new Map(net.nodes.map((n) => [n.id, n]));
    const busNode = new Map(net.buses.map((b) => [b.id, b.node]));
    const bays = new Map<string, Map<number, number>>();
    const tx = new Map<string, { hi: number; lo: number; units: number }[]>();
    for (const b of meta.branches) {
      const na = busNode.get(b.from)!;
      const nz = busNode.get(b.to)!;
      if (b.kind === 'transformer') {
        const lo = net.branches.find((x) => x.id === b.id)?.kvLow ?? 110;
        (tx.get(na) ?? tx.set(na, []).get(na)!).push({ hi: b.kv, lo, units: b.circuits });
        continue;
      }
      for (const n of [na, nz]) {
        const m = bays.get(n) ?? bays.set(n, new Map()).get(n)!;
        m.set(b.kv, (m.get(b.kv) ?? 0) + b.circuits);
      }
    }
    for (const node of net.nodes) {
      if (node.kind !== 'station') continue;
      const [x, z] = itmToScene(node.e, node.n);
      let rect: Rect;
      if (node.footprint && node.footprint.length >= 3) {
        const pts = node.footprint.map(([e, n]) => itmToScene(e!, n!));
        rect = minRect(pts);
      } else {
        const kv = Math.max(...node.kvs);
        const L = kv >= 220 ? 220 : 110;
        rect = { cx: x, cz: z, angle: 0, long: L, short: L * 0.6 };
      }
      this.defs.push({
        id: node.id,
        kind: 'substation',
        x,
        z,
        rect,
        node,
        bays: bays.get(node.id) ?? new Map(),
        transformers: tx.get(node.id) ?? [],
        halls: 0,
      });
    }
    for (const c of campuses) {
      const node = net.nodes.find((n) => n.kind === 'station' && n.name.toLowerCase() === c.station.toLowerCase());
      if (!node) continue;
      const [sx, sz] = itmToScene(node.e, node.n);
      // Campus beside the station, offset so the two do not overlap.
      const x = sx + 520;
      const z = sz - 380;
      const long = 120 + c.halls * 70;
      this.defs.push({
        id: c.id,
        kind: 'campus',
        x,
        z,
        rect: { cx: x, cz: z, angle: 0.35, long, short: 260 },
        bays: new Map(),
        transformers: [],
        halls: c.halls,
      });
    }
    void nodeById;
  }

  update(camera: PerspectiveCamera, dt: number): void {
    this.timer += dt;
    if (this.timer < 0.5) return;
    this.timer = 0;
    const alt = camera.position.y;
    const r = alt < 14_000 ? Math.min(12_000, alt * 3 + 2500) : 0;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const wanted = new Set<string>();
    let builds = 0;
    for (const d of this.defs) {
      if (Math.hypot(d.x - cx, d.z - cz) > r) continue;
      wanted.add(d.id);
      if (!this.built.has(d.id) && builds < 3) {
        const g = d.kind === 'substation' ? this.buildSubstation(d) : this.buildCampus(d);
        this.built.set(d.id, g);
        this.group.add(g);
        builds++;
      }
    }
    for (const [id, g] of this.built) {
      if (wanted.has(id)) continue;
      this.group.remove(g);
      g.traverse((o) => (o as Mesh).geometry?.dispose());
      this.built.delete(id);
    }
  }

  private flush(parts: Partial<Record<Mat, Builder>>, origin: Vector3, rect: Rect): Group {
    const g = new Group();
    g.position.copy(origin);
    g.rotation.y = -rect.angle;
    for (const [k, b] of Object.entries(parts)) {
      if (!b || !b.pos.length) continue;
      const mesh = new Mesh(b.build(), this.mats[k as Mat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }

  private ground(rect: Rect): number {
    // Sites are levelled: use the mean of a few samples, scaled by the current exaggeration.
    const s = [
      [0, 0],
      [0.4, 0.4],
      [-0.4, 0.4],
      [0.4, -0.4],
      [-0.4, -0.4],
    ].map(([u, v]) => {
      const c = Math.cos(rect.angle);
      const sn = Math.sin(rect.angle);
      const x = rect.cx + u! * rect.long * c - v! * rect.short * sn;
      const z = rect.cz + u! * rect.long * sn + v! * rect.short * c;
      return Math.max(0, this.heightAt(x, z));
    });
    return (s.reduce((a, b) => a + b, 0) / s.length) * world.exaggeration.value;
  }

  private fence(b: Builder, L: number, W: number, h = 2.4) {
    const hx = L / 2;
    const hz = W / 2;
    const edges: [number, number, number, number][] = [
      [-hx, -hz, hx, -hz],
      [hx, -hz, hx, hz],
      [hx, hz, -hx, hz],
      [-hx, hz, -hx, -hz],
    ];
    for (const [x0, z0, x1, z1] of edges) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(len / 2.8);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        b.beam(new Vector3(x, 0, z), new Vector3(x, h, z), 0.1);
      }
      for (const y of [0.3, h - 0.25]) b.beam(new Vector3(x0, y, z0), new Vector3(x1, y, z1), 0.06);
    }
  }

  private buildSubstation(d: SiteDef): Group {
    const rect = d.rect;
    const L = Math.max(60, Math.min(rect.long, 600));
    const W = Math.max(40, Math.min(rect.short, 400));
    const parts: Partial<Record<Mat, Builder>> = {
      steel: new Builder(),
      concrete: new Builder(),
      gravel: new Builder(),
      aluminium: new Builder(),
      transformer: new Builder(),
      insulator: new Builder(),
    };
    const steel = parts.steel!;
    // Gravel yard and fence
    parts.gravel!.box(new Vector3(-L / 2, -0.4, -W / 2), new Vector3(L / 2, 0.15, W / 2));
    this.fence(steel, L - 2, W - 2);
    // Control building near one end
    parts.concrete!.box(new Vector3(-L / 2 + 6, 0, -W / 2 + 6), new Vector3(-L / 2 + 26, 5.5, -W / 2 + 15));
    // Voltage sections: highest voltage takes the most room
    const kvs = [...new Set([...d.bays.keys(), ...(d.node?.kvs ?? [])])].sort((a, b) => b - a);
    const usable = W - 24;
    const share = kvs.map((kv) => (kv >= 300 ? 1.6 : kv >= 200 ? 1.2 : 1));
    const total = share.reduce((a, b) => a + b, 0) || 1;
    let z0 = -W / 2 + 18;
    kvs.forEach((kv, i) => {
      const depth = (usable * share[i]!) / total;
      const gh = kv >= 300 ? 21 : kv >= 200 ? 15 : 10.5;
      const bayW = kv >= 300 ? 26 : kv >= 200 ? 17 : 10;
      const nBays = Math.max(2, Math.min(Math.floor((L - 40) / bayW), (d.bays.get(kv) ?? 2) + 2));
      const x0 = -((nBays - 1) * bayW) / 2;
      const zBus = z0 + depth * 0.35;
      const zLine = z0 + depth * 0.85;
      // Gantry portals at the line entries and along the busbar
      for (let k = 0; k <= nBays; k++) {
        const x = x0 + (k - 0.5) * bayW;
        for (const zz of [zBus, zLine]) {
          steel.beam(new Vector3(x, 0, zz - 1.2), new Vector3(x, gh, zz - 1.2), 0.45);
          steel.beam(new Vector3(x, 0, zz + 1.2), new Vector3(x, gh, zz + 1.2), 0.45);
        }
      }
      for (const zz of [zBus, zLine]) {
        for (const dz of [-1.2, 1.2]) steel.beam(new Vector3(x0 - bayW / 2, gh, zz + dz), new Vector3(x0 + (nBays + 0.5) * bayW, gh, zz + dz), 0.5);
      }
      // Tubular busbars (three phases)
      for (let p = -1; p <= 1; p++) {
        parts.aluminium!.beam(
          new Vector3(x0 - bayW / 2, gh * 0.62, zBus + p * (kv >= 300 ? 6 : kv >= 200 ? 4 : 2.2)),
          new Vector3(x0 + (nBays - 0.5) * bayW, gh * 0.62, zBus + p * (kv >= 300 ? 6 : kv >= 200 ? 4 : 2.2)),
          kv >= 200 ? 0.25 : 0.16,
        );
      }
      // Bays: breaker, disconnectors, current transformers on post insulators
      for (let k = 0; k < nBays; k++) {
        const x = x0 + k * bayW;
        for (let p = -1; p <= 1; p++) {
          const px = x + p * (kv >= 300 ? 4.5 : kv >= 200 ? 3 : 1.6);
          const zb = (zBus + zLine) / 2;
          parts.concrete!.box(new Vector3(px - 0.6, 0, zb - 0.6), new Vector3(px + 0.6, 0.6, zb + 0.6));
          steel.beam(new Vector3(px, 0.6, zb), new Vector3(px, 2.6, zb), 0.25);
          parts.insulator!.add(new CylinderGeometry(0.32, 0.38, gh * 0.22, 10), new Matrix4().makeTranslation(px, 2.6 + gh * 0.11, zb));
          parts.aluminium!.add(new CylinderGeometry(0.55, 0.55, 1.6, 12), new Matrix4().makeTranslation(px, 2.6 + gh * 0.22 + 0.8, zb));
          for (const zz of [zBus + depth * 0.12, zLine - depth * 0.1]) {
            steel.beam(new Vector3(px, 0, zz), new Vector3(px, 2.4, zz), 0.2);
            parts.insulator!.add(new CylinderGeometry(0.16, 0.2, gh * 0.25, 8), new Matrix4().makeTranslation(px, 2.4 + gh * 0.125, zz));
          }
        }
      }
      z0 += depth;
    });
    // Transformers between sections, along the middle of the yard
    let tx = -L / 2 + 40;
    for (const t of d.transformers) {
      for (let u = 0; u < t.units; u++) {
        if (tx > L / 2 - 20) break;
        const s = t.hi >= 300 ? 1.35 : 1;
        const zc = 0;
        parts.concrete!.box(new Vector3(tx - 6 * s, -0.1, zc - 4.5 * s), new Vector3(tx + 6 * s, 0.5, zc + 4.5 * s));
        parts.transformer!.box(new Vector3(tx - 3.6 * s, 0.5, zc - 2.2 * s), new Vector3(tx + 3.6 * s, 5.2 * s, zc + 2.2 * s));
        for (let r = -3; r <= 3; r++) {
          parts.transformer!.box(new Vector3(tx + r * 0.95 * s - 0.15, 1.2, zc + 2.2 * s), new Vector3(tx + r * 0.95 * s + 0.15, 4.6 * s, zc + 3.6 * s));
        }
        parts.transformer!.add(
          new CylinderGeometry(0.7 * s, 0.7 * s, 4.4 * s, 14),
          new Matrix4().makeRotationZ(Math.PI / 2).setPosition(tx, 6.4 * s, zc - 1.4 * s),
        );
        for (let p = -1; p <= 1; p++) {
          parts.insulator!.add(new CylinderGeometry(0.18, 0.3, 3.2 * s, 10), new Matrix4().makeTranslation(tx + p * 1.6 * s, 5.2 * s + 1.6 * s, zc + 0.6 * s));
          parts.insulator!.add(new CylinderGeometry(0.12, 0.2, 1.8 * s, 10), new Matrix4().makeTranslation(tx + p * 1.1 * s, 5.2 * s + 0.9 * s, zc - 0.9 * s));
        }
        tx += 22 * s;
      }
    }
    const origin = new Vector3(rect.cx, this.ground(rect), rect.cz);
    return this.flush(parts, origin, rect);
  }

  private buildCampus(d: SiteDef): Group {
    const rect = d.rect;
    const L = rect.long;
    const W = rect.short;
    const parts: Partial<Record<Mat, Builder>> = {
      steel: new Builder(),
      concrete: new Builder(),
      cladding: new Builder(),
      roof: new Builder(),
      windows: new Builder(),
      gravel: new Builder(),
      transformer: new Builder(),
      aluminium: new Builder(),
    };
    parts.gravel!.box(new Vector3(-L / 2, -0.3, -W / 2), new Vector3(L / 2, 0.1, W / 2));
    this.fence(parts.steel!, L - 4, W - 4);
    const hallL = 52;
    const hallW = 170;
    for (let h = 0; h < d.halls; h++) {
      const x = -L / 2 + 40 + h * 70 + hallL / 2;
      const z0 = -hallW / 2 + 10;
      // Precast hall with a darker plinth and a glazed band
      parts.concrete!.box(new Vector3(x - hallL / 2, 0, z0), new Vector3(x + hallL / 2, 3, z0 + hallW));
      parts.cladding!.box(new Vector3(x - hallL / 2, 3, z0), new Vector3(x + hallL / 2, 17, z0 + hallW));
      parts.windows!.box(new Vector3(x - hallL / 2 - 0.05, 8, z0 + 6), new Vector3(x + hallL / 2 + 0.05, 9.2, z0 + hallW - 6));
      parts.roof!.box(new Vector3(x - hallL / 2 + 0.5, 17, z0 + 0.5), new Vector3(x + hallL / 2 - 0.5, 17.6, z0 + hallW - 0.5));
      // Rooftop dry coolers in rows
      for (let cx = -2; cx <= 2; cx++) {
        for (let cz = 0; cz < 14; cz++) {
          const px = x + cx * 9;
          const pz = z0 + 12 + cz * 11;
          parts.aluminium!.box(new Vector3(px - 3.5, 17.6, pz - 2), new Vector3(px + 3.5, 20, pz + 2));
          for (const f of [-1.8, 1.8]) {
            parts.steel!.add(new CylinderGeometry(1.2, 1.2, 0.3, 12), new Matrix4().makeTranslation(px + f, 20.15, pz));
          }
        }
      }
      // Backup generators along the side, each with a stack
      for (let g = 0; g < 10; g++) {
        const gz = z0 + 10 + g * 15;
        const gx = x + hallL / 2 + 9;
        parts.cladding!.box(new Vector3(gx - 2, 0, gz - 6), new Vector3(gx + 2, 3.6, gz + 6));
        parts.steel!.beam(new Vector3(gx, 3.6, gz + 4), new Vector3(gx, 9, gz + 4), 0.6);
      }
    }
    // On-site 110 kV compound with two transformers
    const tx = L / 2 - 40;
    parts.gravel!.box(new Vector3(tx - 30, -0.25, -W / 2 + 10), new Vector3(tx + 30, 0.2, -W / 2 + 70));
    for (const dz of [25, 50]) {
      parts.transformer!.box(new Vector3(tx - 4, 0.5, -W / 2 + dz - 2.5), new Vector3(tx + 4, 5.5, -W / 2 + dz + 2.5));
    }
    const origin = new Vector3(rect.cx, this.ground(rect), rect.cz);
    return this.flush(parts, origin, rect);
  }
}

export type { BufferGeometry };
