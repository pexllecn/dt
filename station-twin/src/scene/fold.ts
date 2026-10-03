/**
 * The fold: the physical yard becomes its single-line diagram and back, driven by one parameter
 * p (0 = Physical, 1 = Circuit) that moves at a fixed rate towards its target, so it can be
 * reversed from wherever it is. Conductors carry both their 3D and schematic positions and blend
 * in the vertex shader, bay by bay; the three phases of each bay converge onto one line. IEC
 * 60617 symbols fade in over the converged lines and follow the switching state.
 */
import * as THREE from 'three/webgpu';
import { attribute, color, float, mix, positionLocal, smoothstep, uniform } from 'three/tsl';
import type { ComponentId, SimState } from '../sim/types.ts';
import { BUSBARS, VOLTAGE, type Voltage } from './layout.ts';
import { FEEDERS, RAILS, SCHEM_TX, TX_GAP, TX_R, schematicAnchors, type Feeder, type P2 } from './schematic.ts';
import type { FlowPath } from './station.ts';
import { VOLTAGE_COLOUR } from './flow.ts';
import { bayFlow } from './flowmap.ts';

type F = THREE.UniformNode<'float', number>;
type C3 = THREE.UniformNode<'color', THREE.Color>;
const uf = (v: number) => uniform(v) as unknown as F;
const uc = (c: number) => uniform(new THREE.Color(c)) as unknown as C3;

/** Seconds for a full fold in either direction (acceptance: under 2.5 s). */
export const FOLD_SECONDS = 2.2;

/** Stage timing within the fold, as fractions of p. */
export const STAGES = {
  dissolve: [0, 0.27],
  travel: [0.17, 0.68],
  resolve: [0.5, 0.83],
  label: [0.75, 1],
} as const;

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The fold parameter: linear progress at a fixed rate, eased for display. Interruptible by construction. */
export class FoldController {
  /** Linear progress, 0 to 1. */
  progress = 0;
  target: 0 | 1 = 0;
  step(dt: number): void {
    const rate = dt / FOLD_SECONDS;
    if (this.progress < this.target) this.progress = Math.min(this.target, this.progress + rate);
    else if (this.progress > this.target) this.progress = Math.max(this.target, this.progress - rate);
  }
  get p(): number { return this.progress; }
  get moving(): boolean { return this.progress !== this.target; }
  dissolve(): number { return sstep(STAGES.dissolve[0], STAGES.dissolve[1], this.progress); }
  resolve(): number { return sstep(STAGES.resolve[0], STAGES.resolve[1], this.progress); }
  label(): number { return sstep(STAGES.label[0], STAGES.label[1], this.progress); }
  /** Travel of one bay, staggered by its position s (0 to 1) in the diagram. */
  travel(s: number): number { const [a, b] = travelWindow(s); return sstep(a, b, this.progress); }
}

export function travelWindow(s: number): [number, number] {
  const start = STAGES.travel[0] + 0.18 * s;
  return [start, start + (STAGES.travel[1] - STAGES.travel[0] - 0.18)];
}

const Y_LINE = 1.0;
const R_SCHEM = 1.1;
const R_PHYS = 0.07;

function polyAt(pts: P2[], u: number): { p: THREE.Vector3; t: THREE.Vector3 } {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]); lens.push(l); total += l; }
  let d = THREE.MathUtils.clamp(u, 0, 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]! || i === lens.length - 1) {
      const a = pts[i]!, b = pts[i + 1]!;
      const k = lens[i]! > 0 ? Math.min(1, d / lens[i]!) : 0;
      return { p: new THREE.Vector3(a[0] + (b[0] - a[0]) * k, Y_LINE, a[1] + (b[1] - a[1]) * k), t: new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize() };
    }
    d -= lens[i]!;
  }
  return { p: new THREE.Vector3(pts[0]![0], Y_LINE, pts[0]![1]), t: new THREE.Vector3(1, 0, 0) };
}

/** Arc-length offset of each path in its chain (a path continues the one ending where it starts). */
export function chainOffsets(list: FlowPath[]): number[] {
  const d0 = list.map(() => 0);
  for (let iter = 0; iter < 40; iter++) {
    let changed = false;
    list.forEach((p, i) => {
      list.forEach((q, j) => {
        if (i !== j && q.pts[q.pts.length - 1]!.distanceTo(p.pts[0]!) < 0.6 && d0[j]! + q.length > d0[i]! + 1e-6) { d0[i] = d0[j]! + q.length; changed = true; }
      });
    });
    if (!changed) break;
  }
  return d0;
}

interface Strand { a: THREE.Vector3[]; b: THREE.Vector3[]; ta: THREE.Vector3[]; tb: THREE.Vector3[] }

/** A tube whose vertices carry a physical position and a schematic position. */
function dualTube(strands: Strand[], seg = 5): THREE.BufferGeometry {
  const posA: number[] = [];
  const posB: number[] = [];
  const offA: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const ring = (c: THREE.Vector3, t: THREE.Vector3, r: number, out: number[], dirs?: number[]) => {
    const n = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(t, n).normalize();
    const v = new THREE.Vector3().crossVectors(t, u).normalize();
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const dx = u.x * Math.cos(a) + v.x * Math.sin(a), dy = u.y * Math.cos(a) + v.y * Math.sin(a), dz = u.z * Math.cos(a) + v.z * Math.sin(a);
      out.push(c.x + dx * r, c.y + dy * r, c.z + dz * r);
      dirs?.push(dx, dy, dz);
    }
  };
  for (const s of strands) {
    for (let i = 0; i < s.a.length; i++) { ring(s.a[i]!, s.ta[i]!, R_PHYS, posA, offA); ring(s.b[i]!, s.tb[i]!, R_SCHEM, posB); }
    for (let i = 0; i < s.a.length - 1; i++) for (let k = 0; k < seg; k++) {
      const a0 = base + i * seg + k, a1 = base + i * seg + ((k + 1) % seg), b0 = a0 + seg, b1 = a1 + seg;
      idx.push(a0, a1, b0, a1, b1, b0);
    }
    base += s.a.length * seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
  g.setAttribute('positionB', new THREE.Float32BufferAttribute(posB, 3));
  g.setAttribute('offsetA', new THREE.Float32BufferAttribute(offA, 3));
  g.setIndex(idx);
  return g;
}

// --- flat symbol geometry in the ground plane ------------------------------------------------
const flat = (g: THREE.BufferGeometry, y: number) => { g.rotateX(-Math.PI / 2); g.translate(0, y, 0); return g; };
function seg2(a: P2, b: P2, w: number, y: number): THREE.BufferGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.PlaneGeometry(len + w, w);
  flat(g, 0);
  g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
  g.translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
  return g;
}
function ring2(c: P2, r: number, w: number, y: number): THREE.BufferGeometry {
  const g = flat(new THREE.RingGeometry(r - w / 2, r + w / 2, 48), 0);
  g.translate(c[0], y, c[1]);
  return g;
}
function tri2(a: P2, b: P2, c: P2, y: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]], 3));
  return g;
}
function mergeFlat(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('normal'); n.deleteAttribute('uv'); return n; });
  let n = 0;
  for (const p of parts) n += p.attributes.position!.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position!.array as Float32Array, o * 3); o += p.attributes.position!.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

const INK = { daylight: 0x1b2026, control: 0xdfe6ee };
const PAPER = { daylight: 0xf4f2ec, control: 0x121820 };
const DEAD = 0x8a9097;

interface DeviceSym { owner: ComponentId; device: 'cb' | 'dsBus' | 'dsLine'; index: number; base: THREE.Matrix4 }

export class FoldLayer {
  readonly group = new THREE.Group();
  readonly controller = new FoldController();
  readonly pickables: THREE.Object3D[] = [];
  readonly anchors = new Map<ComponentId, THREE.Vector3>();
  readonly bounds = new Map<ComponentId, THREE.Box3>();
  private p = uf(0);
  /** Extra physical-end radius with viewing distance (m), set by the stage. */
  readonly widen = uf(0);
  private resolveU = uf(0);
  private ink = uc(INK.daylight);
  private paperU = uc(PAPER.daylight);
  private keyColour = new Map<string, { colour: C3; owner: ComponentId; voltage: Voltage; isRail: boolean }>();
  private fills: THREE.InstancedMesh;
  private blades: THREE.InstancedMesh;
  private devices: DeviceSym[] = [];
  private paper: THREE.Mesh;
  private theme: 'daylight' | 'control' = 'daylight';
  private paperOpacity = uf(0);

  constructor(stationPaths: FlowPath[]) {
    this.group.name = 'fold';
    this.group.visible = false;
    for (const [id, a] of schematicAnchors()) this.anchors.set(id, new THREE.Vector3(...a));

    // Paper: an unlit ground that fades in over the landscape.
    const paperMat = new THREE.MeshBasicNodeMaterial({ alphaHash: true });
    paperMat.colorNode = this.paperU;
    paperMat.opacityNode = this.paperOpacity;
    this.paper = new THREE.Mesh(flat(new THREE.PlaneGeometry(9000, 9000), 0.25), paperMat);
    this.paper.renderOrder = -1;
    this.group.add(this.paper);

    // --- conductors: every station path to its feeder, busbar phases to their rails --------------
    const order = [...RAILS.map((r) => r.id as string), ...FEEDERS.map((f) => f.key)];
    const byKey = new Map<string, FlowPath[]>();
    for (const p of stationPaths) { const l = byKey.get(p.key) ?? []; l.push(p); byKey.set(p.key, l); }
    const addKey = (key: string, owner: ComponentId, voltage: Voltage, strands: Strand[], isRail: boolean) => {
      const s = order.indexOf(key) / Math.max(1, order.length - 1);
      const [a, b] = travelWindow(s);
      const t = smoothstep(float(a), float(b), this.p);
      const colour = uc(VOLTAGE_COLOUR[voltage]);
      const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      // Physical end: widened with viewing distance so conductors stay visible as the camera rises.
      mat.positionNode = mix(positionLocal.add(attribute('offsetA', 'vec3').mul(this.widen)), attribute('positionB', 'vec3'), t);
      mat.colorNode = mix(color(0x9da3a6), colour, t);
      const mesh = new THREE.Mesh(dualTube(strands), mat);
      mesh.frustumCulled = false;
      mesh.userData.owner = owner;
      this.group.add(mesh);
      this.keyColour.set(key, { colour, owner, voltage, isRail });
    };
    for (const f of FEEDERS) {
      const list = byKey.get(f.key);
      if (!list) continue;
      const d0 = chainOffsets(list);
      const L = Math.max(...list.map((p, i) => d0[i]! + p.length));
      const strands: Strand[] = list.map((p, i) => {
        const cum = [0];
        for (let k = 1; k < p.pts.length; k++) cum.push(cum[k - 1]! + p.pts[k]!.distanceTo(p.pts[k - 1]!));
        const b = cum.map((c) => polyAt(f.pts, (d0[i]! + (c / cum[cum.length - 1]!) * p.length) / L));
        const ta = p.pts.map((q, k) => new THREE.Vector3().subVectors(p.pts[Math.min(k + 1, p.pts.length - 1)]!, p.pts[Math.max(k - 1, 0)]!).normalize());
        return { a: p.pts, b: b.map((x) => x.p), ta, tb: b.map((x) => x.t) };
      });
      addKey(f.key, f.owner, f.voltage, strands, false);
    }
    for (const r of RAILS) {
      const bus = BUSBARS.find((b) => b.id === r.id)!;
      const S = VOLTAGE[bus.voltage];
      const strands: Strand[] = [-1, 0, 1].map((o) => {
        const a: THREE.Vector3[] = [];
        const b: THREE.Vector3[] = [];
        for (let i = 0; i <= 16; i++) {
          const u = i / 16;
          a.push(new THREE.Vector3(bus.x + o * S.phase, S.busHeight, bus.z0 + (bus.z1 - bus.z0) * u));
          b.push(new THREE.Vector3(r.x0 + (r.x1 - r.x0) * u, Y_LINE, r.z));
        }
        return { a, b, ta: a.map(() => new THREE.Vector3(0, 0, 1)), tb: b.map(() => new THREE.Vector3(1, 0, 0)) };
      });
      addKey(r.id, r.id, r.voltage, strands, true);
    }

    // --- symbols -------------------------------------------------------------------------------------
    const symMat = (c: C3) => {
      const m = new THREE.MeshBasicNodeMaterial({ alphaHash: true, side: THREE.DoubleSide });
      m.colorNode = c;
      m.opacityNode = this.resolveU;
      return m;
    };
    const outline: THREE.BufferGeometry[] = [];
    const patches: THREE.BufferGeometry[] = [];
    const W = 0.8;
    const deviceBases: { owner: ComponentId; device: 'cb' | 'dsBus' | 'dsLine'; at: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    for (const f of FEEDERS) {
      const [a, b] = [f.pts[0]!, f.pts[f.pts.length - 1]!];
      const d: P2 = [(b[0] - a[0]), (b[1] - a[1])];
      const len = Math.hypot(d[0], d[1]);
      const u: P2 = [d[0] / len, d[1] / len];
      const n: P2 = [-u[1], u[0]];
      const P = (k: number, s = 0): P2 => [a[0] + d[0] * k + n[0] * s, a[1] + d[1] * k + n[1] * s];
      for (const dev of f.devices) {
        const c = P(dev.at);
        const dir = new THREE.Vector3(u[0], 0, u[1]);
        if (dev.device === 'cb') {
          const h = 3.2;
          const q = (x: number, z: number): P2 => [c[0] + u[0] * x + n[0] * z, c[1] + u[1] * x + n[1] * z];
          outline.push(seg2(q(-h, -h), q(h, -h), W, 1.9), seg2(q(h, -h), q(h, h), W, 1.9), seg2(q(h, h), q(-h, h), W, 1.9), seg2(q(-h, h), q(-h, -h), W, 1.9));
        } else {
          // Disconnector: the line is broken; a fixed contact bar on the far side, the blade pivots on the near side.
          const g = 3.2;
          patches.push(seg2([c[0] - u[0] * g, c[1] - u[1] * g], [c[0] + u[0] * g, c[1] + u[1] * g], 2.6, 1.6));
          const far: P2 = [c[0] + u[0] * g, c[1] + u[1] * g];
          outline.push(seg2([far[0] - n[0] * 2.2, far[1] - n[1] * 2.2], [far[0] + n[0] * 2.2, far[1] + n[1] * 2.2], W, 1.9));
        }
        deviceBases.push({ owner: f.owner, device: dev.device, at: new THREE.Vector3(c[0], 0, c[1]), dir });
      }
      const e = b;
      const E = (x: number, s = 0): P2 => [e[0] + u[0] * x + n[0] * s, e[1] + u[1] * x + n[1] * s];
      if (f.end === 'line') outline.push(seg2(E(0), E(-5, 4), W, 1.9), seg2(E(0), E(-5, -4), W, 1.9));
      if (f.end === 'gen') {
        outline.push(ring2(E(6), 6, W, 1.9));
        outline.push(seg2(E(4.5, -3), E(7.5, -1), W * 0.8, 1.9), seg2(E(4.5, -1), E(7.5, 1), W * 0.8, 1.9), seg2(E(4.5, 1), E(7.5, 3), W * 0.8, 1.9));
      }
      if (f.end === 'load') outline.push(tri2(E(7), E(0, 4.5), E(0, -4.5), 1.9));
      if (f.end === 'bess') {
        outline.push(seg2(E(0, -6), E(0, 6), W, 1.9), seg2(E(0, 6), E(10, 6), W, 1.9), seg2(E(10, 6), E(10, -6), W, 1.9), seg2(E(10, -6), E(0, -6), W, 1.9));
        outline.push(seg2(E(4, -4), E(4, 4), W, 1.9), seg2(E(6, -2), E(6, 2), W * 1.6, 1.9));
      }
      // Hit target along the whole feeder for picking.
      const hit = new THREE.Mesh(seg2(a, b, 10, 1.5), new THREE.MeshBasicNodeMaterial({ visible: false }));
      hit.userData.owner = f.owner;
      this.pickables.push(hit);
      this.group.add(hit);
      const bb = new THREE.Box3().setFromPoints([new THREE.Vector3(a[0], 0, a[1]), new THREE.Vector3(b[0], 8, b[1])]).expandByScalar(12);
      this.bounds.set(f.owner, (this.bounds.get(f.owner) ?? new THREE.Box3().makeEmpty()).union(bb));
    }
    for (const t of SCHEM_TX) {
      outline.push(ring2([t.x, t.zc - TX_GAP / 2], TX_R, W, 1.9), ring2([t.x, t.zc + TX_GAP / 2], TX_R, W, 1.9));
      // Delta tertiary: a small triangle beside the windings.
      const cx = t.x + 13, cz = t.zc;
      outline.push(seg2([cx - 3, cz + 2.5], [cx + 3, cz + 2.5], W * 0.8, 1.9), seg2([cx + 3, cz + 2.5], [cx, cz - 2.8], W * 0.8, 1.9), seg2([cx, cz - 2.8], [cx - 3, cz + 2.5], W * 0.8, 1.9));
      outline.push(seg2([t.x + 7, cz], [cx - 2, cz], W * 0.6, 1.9));
      const hit = new THREE.Mesh(flat(new THREE.CircleGeometry(16, 16), 1.5).translate(t.x, 0, t.zc), new THREE.MeshBasicNodeMaterial({ visible: false }));
      hit.userData.owner = t.id;
      this.pickables.push(hit);
      this.group.add(hit);
      this.bounds.set(t.id, new THREE.Box3(new THREE.Vector3(t.x - 20, 0, t.zc - 20), new THREE.Vector3(t.x + 20, 8, t.zc + 20)));
    }
    for (const r of RAILS) {
      const hit = new THREE.Mesh(seg2([r.x0, r.z], [r.x1, r.z], 6, 1.5), new THREE.MeshBasicNodeMaterial({ visible: false }));
      hit.userData.owner = r.id;
      this.pickables.push(hit);
      this.group.add(hit);
      this.bounds.set(r.id, new THREE.Box3(new THREE.Vector3(r.x0, 0, r.z - 10), new THREE.Vector3(r.x1, 8, r.z + 10)));
    }
    this.group.add(new THREE.Mesh(mergeFlat(patches), symMat(this.paperU)));
    this.group.add(new THREE.Mesh(mergeFlat(outline), symMat(this.ink)));

    // Breaker fills (ink when closed, paper when open) and disconnector blades, instanced.
    const fillGeo = flat(new THREE.PlaneGeometry(5.6, 5.6), 0);
    const fillMat = new THREE.MeshBasicNodeMaterial({ alphaHash: true });
    fillMat.opacityNode = this.resolveU;
    const cbs = deviceBases.filter((d) => d.device === 'cb');
    this.fills = new THREE.InstancedMesh(fillGeo, fillMat, cbs.length);
    const bladeGeo = new THREE.PlaneGeometry(6.6, W);
    flat(bladeGeo, 0);
    bladeGeo.translate(3.3, 0, 0);
    const bladeMat = symMat(this.ink);
    const dss = deviceBases.filter((d) => d.device !== 'cb');
    this.blades = new THREE.InstancedMesh(bladeGeo, bladeMat, dss.length);
    cbs.forEach((d, i) => {
      const m = new THREE.Matrix4().compose(d.at.clone().setY(1.75), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.dir), new THREE.Vector3(1, 1, 1));
      this.fills.setMatrixAt(i, m);
      this.fills.setColorAt(i, new THREE.Color(INK.daylight));
      this.devices.push({ owner: d.owner, device: 'cb', index: i, base: m });
    });
    dss.forEach((d, i) => {
      // The blade pivots at the near contact, 3.2 m before the device centre.
      const pivot = d.at.clone().addScaledVector(d.dir, -3.2).setY(1.95);
      const m = new THREE.Matrix4().compose(pivot, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.dir), new THREE.Vector3(1, 1, 1));
      this.blades.setMatrixAt(i, m);
      this.devices.push({ owner: d.owner, device: d.device as 'dsBus' | 'dsLine', index: i, base: m });
    });
    this.group.add(this.fills, this.blades);
  }

  setTheme(theme: 'daylight' | 'control'): void {
    this.theme = theme;
    this.ink.value.set(INK[theme]);
    this.paperU.value.set(PAPER[theme]);
  }

  /** Advance the fold and follow the state. Returns the eased stage values for the stage to use. */
  update(state: SimState, dt: number): void {
    this.controller.step(dt);
    const c = this.controller;
    this.p.value = c.p;
    this.resolveU.value = c.resolve();
    this.paperOpacity.value = c.dissolve();
    this.group.visible = c.p > 0;
    const C = state.C;
    for (const [key, k] of this.keyColour) {
      const comp = C[k.owner];
      const live = k.isRail ? comp.live : (bayFlow(key, state)?.live ?? comp.live);
      k.colour.value.set(live ? VOLTAGE_COLOUR[k.voltage] : DEAD);
    }
    const rot = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    const ink = new THREE.Color(INK[this.theme]);
    const paper = new THREE.Color(PAPER[this.theme]);
    for (const d of this.devices) {
      const comp = C[d.owner];
      if (d.device === 'cb') this.fills.setColorAt(d.index, comp.closed ? ink : paper);
      else {
        const closed = comp.bay ? (d.device === 'dsBus' ? comp.bay.dsBus : comp.bay.dsLine) : true;
        this.blades.setMatrixAt(d.index, tmp.multiplyMatrices(d.base, rot.makeRotationY(closed ? 0 : 0.55)));
      }
    }
    if (this.fills.instanceColor) this.fills.instanceColor.needsUpdate = true;
    this.blades.instanceMatrix.needsUpdate = true;
  }
  /** Device symbol states, for tests: owner, device, closed. */
  deviceStates(state: SimState): { owner: ComponentId; device: string; closed: boolean }[] {
    return this.devices.map((d) => {
      const comp = state.C[d.owner];
      const closed = d.device === 'cb' ? comp.closed : comp.bay ? (d.device === 'dsBus' ? comp.bay.dsBus : comp.bay.dsLine) : true;
      return { owner: d.owner, device: d.device, closed };
    });
  }

  /** Feeders in the diagram (for tests). */
  static feeders(): Feeder[] { return FEEDERS; }
}
