/** Power transformer model: tank, radiators with fans, conservator, bushings, plinth and bund. */
import * as THREE from 'three/webgpu';
import { at, block, box, cyl, insulator, merge, post, rod, transformed, type Geo } from './geometry.ts';
import type { TransformerPlacement, Voltage } from './layout.ts';
import type { MatKey } from './equipment.ts';

export interface TransformerModel {
  parts: { mat: MatKey; geo: Geo }[];
  /** World positions of HV and LV bushing terminals, ordered by world z. */
  hvTerminals: THREE.Vector3[];
  lvTerminals: THREE.Vector3[];
  /** Fan pivots (world) and their bank index (0 or 1 for the two fan stages). */
  fans: { pos: THREE.Vector3; stage: 1 | 2 }[];
  pumps: THREE.Vector3[];
  /** Top of tank centre (world) for labels and fly-to. */
  anchor: THREE.Vector3;
}

const bushingLength = (v: Voltage) => ({ 400: 5.6, 275: 4.4, 220: 3.4, 110: 2.2 })[v];

export function buildTransformer(t: TransformerPlacement): TransformerModel {
  const [L, W, H] = t.size;
  const parts: { mat: MatKey; geo: Geo }[] = [];
  const add = (mat: MatKey, geo: Geo) => parts.push({ mat, geo });
  const base = 0.75; // plinth plus base frame
  const big = L >= 9;

  // Plinth, bund walls and gravel sump.
  add('concrete', block(L + 7, 0.4, W + 9, 0, 0, 0));
  const bw = 0.3;
  add('concrete', block(L + 7, 0.6, bw, 0, -(W + 9) / 2 + bw / 2, 0.4));
  add('concrete', block(L + 7, 0.6, bw, 0, (W + 9) / 2 - bw / 2, 0.4));
  add('concrete', block(bw, 0.6, W + 9, -(L + 7) / 2 + bw / 2, 0, 0.4));
  add('concrete', block(bw, 0.6, W + 9, (L + 7) / 2 - bw / 2, 0, 0.4));
  add('gravel', block(L + 6.4, 0.5, W + 8.4, 0, 0, 0.4));
  add('galvanised', block(L * 0.9, 0.35, W * 0.8, 0, 0, 0.4));

  // Tank with stiffeners and a lid flange.
  add('tankPaint', block(L, H, W, 0, 0, base));
  add('tankPaint', block(L + 0.25, 0.14, W + 0.25, 0, 0, base + H));
  add('tankPaint', block(L + 0.2, 0.12, W + 0.2, 0, 0, base + H * 0.12));
  for (let x = -L / 2 + 0.6; x <= L / 2 - 0.5; x += 1.15) {
    add('tankPaint', block(0.12, H, 0.16, x, -W / 2 - 0.06, base));
    add('tankPaint', block(0.12, H, 0.16, x, W / 2 + 0.06, base));
  }
  for (let z = -W / 2 + 0.6; z <= W / 2 - 0.5; z += 1.2) {
    add('tankPaint', block(0.16, H, 0.12, -L / 2 - 0.06, z, base));
    add('tankPaint', block(0.16, H, 0.12, L / 2 + 0.06, z, base));
  }

  // Radiator banks on both long sides, with fans below and headers to the tank.
  const fans: { pos: THREE.Vector3; stage: 1 | 2 }[] = [];
  const pumps: THREE.Vector3[] = [];
  const banks = Math.max(2, Math.floor((L - 1) / 2.3));
  const bankLen = (L - 1) / banks;
  const finH = H * 0.78;
  const finDepth = 0.55;
  const offset = 0.9;
  for (const side of [-1, 1]) {
    for (let b = 0; b < banks; b++) {
      const cx = -L / 2 + 0.5 + bankLen * (b + 0.5);
      const cz = side * (W / 2 + offset + finDepth / 2);
      const fins: Geo[] = [];
      const n = Math.floor((bankLen - 0.3) / 0.11);
      for (let i = 0; i < n; i++) fins.push(at(box(0.04, finH, finDepth), cx - (bankLen - 0.3) / 2 + i * 0.11, base + 0.9 + finH / 2, cz));
      add('tankPaint', merge(fins));
      for (const yy of [base + 0.95, base + 0.85 + finH]) {
        add('tankPaint', at(cyl(0.11, bankLen - 0.2, 10), cx, yy, cz, 0, 0, Math.PI / 2));
        add('tankPaint', rod(new THREE.Vector3(cx, yy, side * (W / 2)), new THREE.Vector3(cx, yy, cz), 0.12, 10));
      }
      // Two fans under each bank, blowing upwards.
      for (const f of [-1, 1]) {
        const fx = cx + f * bankLen * 0.25;
        add('tankPaint', at(new THREE.TorusGeometry(0.42, 0.04, 6, 24), fx, base + 0.62, cz, Math.PI / 2));
        add('galvanised', rod(new THREE.Vector3(fx, base + 0.62, cz - side * 0.42), new THREE.Vector3(fx, base + 0.9, cz - side * 0.3), 0.025, 4));
        fans.push({ pos: new THREE.Vector3(t.x + fx, base + 0.64, t.z + cz), stage: (b % 2 === 0 ? 1 : 2) as 1 | 2 });
      }
      if (t.cooling === 'OFAF' && side === 1) {
        const p = new THREE.Vector3(cx, base + 0.55, side * (W / 2 + 0.45));
        add('tankPaint', at(cyl(0.18, 0.5, 14), p.x, p.y, p.z, 0, 0, Math.PI / 2));
        add('cabinet', at(cyl(0.14, 0.3, 12), p.x + 0.38, p.y, p.z, 0, 0, Math.PI / 2));
        pumps.push(new THREE.Vector3(t.x + p.x, p.y, t.z + p.z));
      }
    }
  }

  // Conservator on the outer side, with Buchholz pipe.
  const consR = big ? 0.6 : 0.45;
  const consL = L * 0.62;
  const consZ = -W / 2 + 0.2;
  const consY = base + H + 1.7;
  add('tankPaint', at(cyl(consR, consL, 24), 0, consY, consZ, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) add('tankPaint', at(new THREE.SphereGeometry(consR, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), (s * consL) / 2, consY, consZ, 0, 0, (-s * Math.PI) / 2));
  for (const s of [-1, 1]) add('galvanised', rod(new THREE.Vector3((s * consL) / 3, base + H, consZ), new THREE.Vector3((s * consL) / 3, consY - consR, consZ), 0.07, 6));
  add('tankPaint', rod(new THREE.Vector3(consL / 2 - 0.4, consY - 0.3, consZ), new THREE.Vector3(L * 0.15, base + H + 0.1, 0), 0.06, 8));
  add('cabinet', at(box(0.3, 0.25, 0.25), (consL / 2 - 0.4 + L * 0.15) / 2, (consY - 0.3 + base + H) / 2, consZ / 2));

  // Bushings: HV on the hvDir side, LV on the other, plus neutral.
  const hvTerminals: THREE.Vector3[] = [];
  const lvTerminals: THREE.Vector3[] = [];
  const bushings = (v: Voltage, dirSide: number, out: THREE.Vector3[]) => {
    const len = bushingLength(v);
    const r = v >= 275 ? 0.17 : 0.13;
    const xs = dirSide * (L / 2 - 0.9);
    const span = Math.min(W * 0.32, 1.5);
    for (const p of [-1, 0, 1]) {
      const zs = p * span;
      const tilt = dirSide * 0.18;
      const y0 = base + H + 0.12;
      add('tankPaint', at(cyl(0.32, 0.5, 16), xs, y0 + 0.25, zs));
      const i = insulator(len, r, r * 1.85, Math.round(len * 5));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(xs, y0 + 0.5, zs), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -tilt)), new THREE.Vector3(1, 1, 1));
      add('porcelain', transformed(i.body, m));
      add('galvanised', transformed(i.fittings, m));
      const tip = new THREE.Vector3(0, len + 0.15, 0).applyMatrix4(m);
      add('aluminium', at(cyl(0.12, 0.3, 12), tip.x, tip.y, tip.z));
      out.push(new THREE.Vector3(t.x + tip.x, tip.y + 0.15, t.z + tip.z));
    }
    out.sort((a, b) => a.z - b.z);
  };
  bushings(t.hv, t.hvDir, hvTerminals);
  bushings(t.lv, -t.hvDir, lvTerminals);
  {
    const i = insulator(1.0, 0.08, 0.15, 5);
    add('porcelain', at(i.body, 0, base + H + 0.12, W * 0.32));
  }

  // On-load tap changer compartment, its drive, and the marshalling kiosk.
  add('tankPaint', block(1.4, H * 0.7, 0.7, t.hvDir * (L / 2 - 1.6), -W / 2 - 0.35, base + H * 0.2));
  add('cabinet', block(0.8, 1.6, 0.5, t.hvDir * (L / 2 - 1.6), -W / 2 - 1.0, 0.4));
  add('cabinet', block(1.2, 2.0, 0.6, -t.hvDir * (L / 2 + 1.9), W / 2 + 1.2, 0.4));
  add('copper', rod(new THREE.Vector3(-L / 2, base, W / 2 + 0.1), new THREE.Vector3(-L / 2 - 0.6, 0.42, W / 2 + 0.6), 0.03, 6));

  // Place in the world.
  const world = parts.map((p) => ({ mat: p.mat, geo: at(p.geo, t.x, 0, t.z) }));
  return { parts: world, hvTerminals, lvTerminals, fans, pumps, anchor: new THREE.Vector3(t.x, base + H + 2, t.z) };
}

/** Fire wall between two transformers (concrete, with a coping). */
export function fireWall(x: number, z: number, length: number, height: number): { mat: MatKey; geo: Geo }[] {
  return [
    { mat: 'concrete', geo: block(length, height, 0.35, x, z, 0) },
    { mat: 'concrete', geo: block(length + 0.2, 0.15, 0.5, x, z, height) },
  ];
}

export { post };
