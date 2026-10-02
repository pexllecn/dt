import { BufferAttribute, BufferGeometry, CylinderGeometry, Matrix4, Quaternion, Vector3 } from 'three/webgpu';

/**
 * Procedural geometry for network assets. Everything is built from oriented boxes and
 * cylinders and merged, so the build stays self-contained and instancing stays cheap.
 * Dimensions are typical for the class, in metres.
 */
export class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  idx: number[] = [];

  /** Square-section beam from a to b. */
  beam(a: Vector3, b: Vector3, w: number, h = w) {
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return;
    dir.normalize();
    const up = Math.abs(dir.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const side = new Vector3().crossVectors(dir, up).normalize();
    const top = new Vector3().crossVectors(side, dir).normalize();
    const hw = w / 2;
    const hh = h / 2;
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const;
    const ring = (p: Vector3) => corners.map(([u, v]) => p.clone().addScaledVector(side, u).addScaledVector(top, v));
    const A = ring(a);
    const B = ring(b);
    for (let f = 0; f < 4; f++) {
      const g = (f + 1) % 4;
      const n = A[f]!.clone().add(A[g]!).multiplyScalar(0.5).sub(a).normalize();
      this.quad(A[f]!, A[g]!, B[g]!, B[f]!, n);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  box(min: Vector3, max: Vector3) {
    const [x0, y0, z0] = [min.x, min.y, min.z];
    const [x1, y1, z1] = [max.x, max.y, max.z];
    const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
    this.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), v(0, 0, 1));
    this.quad(v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(0, 0, -1));
    this.quad(v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(1, 0, 0));
    this.quad(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), v(-1, 0, 0));
    this.quad(v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0), v(0, 1, 0));
    this.quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), v(0, -1, 0));
  }

  add(g: BufferGeometry, m: Matrix4) {
    const gg = g.index ? g.toNonIndexed() : g;
    gg.applyMatrix4(m);
    const p = gg.getAttribute('position');
    const n = gg.getAttribute('normal');
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.idx.push(base + i);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export interface TowerSpec {
  height: number;
  base: number;
  waist: number;
  /** Crossarm levels: [height, half-span]. */
  arms: [number, number][];
  member: number;
  panels: number;
}

/** Typical lattice tower proportions by voltage class. */
export const towerSpecs: Record<'400' | '220' | '110', TowerSpec> = {
  '400': { height: 46, base: 11, waist: 3.6, arms: [[36, 15]], member: 0.32, panels: 9 },
  '220': { height: 34, base: 7, waist: 2.4, arms: [[22, 6.5], [27.5, 7.5], [33, 6]], member: 0.24, panels: 8 },
  '110': { height: 25, base: 5, waist: 1.8, arms: [[16, 4.5], [20, 5], [24, 4]], member: 0.18, panels: 6 },
};

/** Attachment points of the phase conductors (local tower frame: x across the line, y up). */
export function towerAttachments(spec: TowerSpec, insulator: number): Vector3[] {
  const pts: Vector3[] = [];
  if (spec.arms.length === 1) {
    const [h, s] = spec.arms[0]!;
    for (const x of [-s * 0.92, 0, s * 0.92]) pts.push(new Vector3(x, h - insulator, 0));
  } else {
    for (const [h, s] of spec.arms) for (const x of [-s * 0.92, s * 0.92]) pts.push(new Vector3(x, h - insulator, 0));
  }
  return pts;
}

/**
 * Lattice tower: four tapered legs, horizontal girts, X bracing on every face, truss crossarms
 * and insulator strings. detail 0 = full lattice, 1 = legs, arms and coarse bracing.
 */
export function latticeTower(spec: TowerSpec, detail: 0 | 1): BufferGeometry {
  const b = new Builder();
  const { height, base, waist, member } = spec;
  const topBody = spec.arms[spec.arms.length - 1]![0] + 2;
  const halfAt = (y: number) => {
    const t = Math.min(1, y / (topBody * 0.62));
    const bodyHalf = (base / 2) * (1 - t) + (waist / 2) * t;
    return y > topBody * 0.62 ? waist / 2 : bodyHalf;
  };
  const panels = detail === 0 ? spec.panels : Math.ceil(spec.panels / 2);
  const levels: number[] = [];
  for (let i = 0; i <= panels; i++) levels.push((topBody * i) / panels);
  const corner = (y: number, sx: number, sz: number) => new Vector3(sx * halfAt(y), y, sz * halfAt(y));
  const signs = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ] as const;
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i]!;
    const y1 = levels[i + 1]!;
    for (let c = 0; c < 4; c++) {
      const [sx, sz] = signs[c]!;
      const [tx, tz] = signs[(c + 1) % 4]!;
      b.beam(corner(y0, sx, sz), corner(y1, sx, sz), member * 1.5);
      // girt
      b.beam(corner(y1, sx, sz), corner(y1, tx, tz), member * 0.8);
      // X bracing on the face
      b.beam(corner(y0, sx, sz), corner(y1, tx, tz), member * 0.6);
      if (detail === 0) b.beam(corner(y0, tx, tz), corner(y1, sx, sz), member * 0.6);
    }
  }
  // peak / earth wire support
  const w = waist / 2;
  const peak = new Vector3(0, height, 0);
  for (const [sx, sz] of signs) b.beam(new Vector3(sx * w, topBody, sz * w), peak, member);
  // crossarms: triangular trusses
  for (const [h, s] of spec.arms) {
    for (const dir of [-1, 1]) {
      const tip = new Vector3(dir * s, h, 0);
      for (const sz of [-1, 1]) {
        b.beam(new Vector3(dir * w, h, sz * w), tip, member);
        b.beam(new Vector3(dir * w, h + 1.6, sz * w * 0.6), tip, member * 0.8);
      }
      if (detail === 0) {
        const mid = new Vector3(dir * s * 0.5, h, 0);
        b.beam(new Vector3(dir * w, h + 1.6, 0), mid, member * 0.6);
      }
      // insulator string (glass discs read as a slightly thicker rod)
      b.beam(new Vector3(dir * s * 0.92, h, 0), new Vector3(dir * s * 0.92, h - 3.2, 0), 0.32);
    }
  }
  if (spec.arms.length === 1) b.beam(new Vector3(0, spec.arms[0]![0], 0), new Vector3(0, spec.arms[0]![0] - 3.2, 0), 0.32);
  // foundations
  for (const [sx, sz] of signs) {
    const p = corner(0, sx, sz);
    b.box(new Vector3(p.x - 0.7, -0.6, p.z - 0.7), new Vector3(p.x + 0.7, 0.35, p.z + 0.7));
  }
  return b.build();
}

/** 110 kV wood poleset: two poles, a crossarm with braces, three insulators. */
export function woodPoleset(): BufferGeometry {
  const b = new Builder();
  const h = 15;
  for (const x of [-2.1, 2.1]) {
    const pole = new CylinderGeometry(0.14, 0.2, h + 1.5, 7, 1);
    b.add(pole, new Matrix4().makeTranslation(x, (h + 1.5) / 2 - 1.5, 0));
  }
  b.beam(new Vector3(-4.2, h - 0.6, 0), new Vector3(4.2, h - 0.6, 0), 0.22, 0.28);
  for (const x of [-2.1, 2.1]) b.beam(new Vector3(x, h - 3.2, 0), new Vector3(x * 0.25, h - 0.7, 0), 0.12);
  for (const x of [-3.6, 0, 3.6]) b.beam(new Vector3(x, h - 0.45, 0), new Vector3(x, h - 1.9, 0), 0.22);
  return b.build();
}

export const polesetAttachments = [new Vector3(-3.6, 13.1, 0), new Vector3(0, 13.1, 0), new Vector3(3.6, 13.1, 0)];

/** Wind turbine parts (hub height 85 m, rotor radius 56 m): tower with nacelle, and the rotor. */
export function turbineTower(): BufferGeometry {
  const b = new Builder();
  b.add(new CylinderGeometry(1.6, 2.3, 85, 20, 1), new Matrix4().makeTranslation(0, 42.5, 0));
  b.box(new Vector3(-1.8, 84, -6.5), new Vector3(1.8, 88, 3));
  b.add(new CylinderGeometry(3.2, 3.2, 0.6, 16), new Matrix4().makeTranslation(0, 0.3, 0));
  return b.build();
}

export function turbineRotor(): BufferGeometry {
  const b = new Builder();
  // hub at origin, rotor plane = XY, facing +Z
  const hub = new CylinderGeometry(0.2, 1.4, 3.2, 14);
  b.add(hub, new Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0, 1.2));
  for (let k = 0; k < 3; k++) {
    const rot = new Matrix4().makeRotationZ((k * 2 * Math.PI) / 3);
    const blade = new Builder();
    // tapered, slightly twisted blade from root to tip
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const r0 = 1.2 + (55 * i) / segs;
      const r1 = 1.2 + (55 * (i + 1)) / segs;
      const c0 = 3.2 * (1 - i / segs) + 0.5;
      const c1 = 3.2 * (1 - (i + 1) / segs) + 0.5;
      blade.beam(new Vector3(0, r0, 0), new Vector3(0, r1, 0), (c0 + c1) / 2, 0.45 * (1 - i / segs) + 0.12);
    }
    b.add(blade.build(), rot);
  }
  return b.build();
}

export const TURBINE_HUB = 86;

/** Orientation helper: quaternion that turns local +X towards a horizontal direction (dx, dz). */
export function yawQuat(dx: number, dz: number, out = new Quaternion()): Quaternion {
  return out.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-dz, dx));
}
