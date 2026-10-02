/**
 * Equipment prototypes. Each prototype is built once per voltage in bay-local coordinates
 * (x along the bay, away from the busbar; z across, between phases; y up) and instanced.
 * Moving parts (disconnector blades, earth switch arms, indicator lamps) are separate so the
 * simulation can drive them.
 */
import * as THREE from 'three/webgpu';
import { at, block, box, cyl, insulator, merge, post, rod, supportColumn, type Geo } from './geometry.ts';
import { VOLTAGE, type Voltage } from './layout.ts';
import type { Materials } from './materials.ts';

export type MatKey = Exclude<keyof Materials, 'night' | 'widen'>;

export interface Part {
  mat: MatKey;
  geo: Geo;
}

export interface Prototype {
  parts: Part[];
  /** Conductor connection points in local coordinates. */
  terminalIn: THREE.Vector3;
  terminalOut: THREE.Vector3;
  /** Pivots for moving parts, local coordinates. */
  blades?: { pivot: THREE.Vector3; length: number; side: 1 | -1 }[];
  earthArm?: { pivot: THREE.Vector3; length: number };
  lamp?: THREE.Vector3;
}

const k = (v: Voltage) => ({ 400: 1.0, 275: 0.86, 220: 0.74, 110: 0.52 })[v];
const ins = (v: Voltage) => ({ 400: [0.11, 0.25], 275: [0.1, 0.22], 220: [0.09, 0.2], 110: [0.075, 0.16] } as const)[v];

function insulatorParts(v: Voltage, length: number, y0: number, mat: MatKey = 'porcelain', x = 0, z = 0, scaleR = 1): Part[] {
  const [core, shed] = ins(v);
  const sheds = Math.max(5, Math.round(VOLTAGE[v].sheds * (length / VOLTAGE[v].insulator)));
  const i = insulator(length, core * scaleR, shed * scaleR, sheds);
  return [
    { mat, geo: at(i.body, x, y0, z) },
    { mat: 'galvanised', geo: at(i.fittings, x, y0, z) },
  ];
}

const support = (h: number, w = 0.32): Part[] => [
  { mat: 'galvanised', geo: supportColumn(h, w) },
  { mat: 'concrete', geo: block(w + 0.7, 0.4, w + 0.7, 0, 0, -0.2) },
];

/** Post insulator on a support: busbar supports and generic posts. Top at support + insulator. */
export function postInsulator(v: Voltage, supportH: number): Prototype {
  const L = VOLTAGE[v].insulator;
  const top = supportH + L;
  return {
    parts: [
      ...support(supportH),
      ...insulatorParts(v, L, supportH),
      { mat: 'aluminium', geo: block(0.42 * k(v), 0.16, 0.3 * k(v), 0, 0, top) },
    ],
    terminalIn: new THREE.Vector3(0, top + 0.1, 0),
    terminalOut: new THREE.Vector3(0, top + 0.1, 0),
  };
}

/** Live-tank SF6 circuit breaker, one pole. T-head with two chambers at 400/275 kV, single vertical chamber below. */
export function breakerPole(v: Voltage, withCabinet: boolean): Prototype {
  const S = VOLTAGE[v];
  const s = S.support;
  const L = S.insulator;
  const kk = k(v);
  const parts: Part[] = [...support(s, 0.36)];
  let tin: THREE.Vector3;
  let tout: THREE.Vector3;
  if (v === 400 || v === 275) {
    const col = L * 1.05;
    parts.push(...insulatorParts(v, col, s, 'composite'));
    const hy = s + col + 0.35;
    parts.push({ mat: 'aluminium', geo: at(cyl(0.38 * kk, 0.7 * kk, 20), 0, hy, 0) });
    parts.push({ mat: 'aluminium', geo: at(new THREE.SphereGeometry(0.42 * kk, 20, 12), 0, hy + 0.1, 0) });
    const ch = L * 0.62;
    for (const side of [-1, 1]) {
      const [core, shed] = ins(v);
      const i = insulator(ch, core * 1.6, shed * 1.25, 12);
      parts.push({ mat: 'composite', geo: at(i.body, side * 0.35 * kk, hy + 0.1, 0, 0, 0, -side * Math.PI / 2) });
      parts.push({ mat: 'aluminium', geo: at(cyl(0.24 * kk, 0.4, 16), side * (0.35 * kk + ch + 0.15), hy + 0.1, 0, 0, 0, Math.PI / 2) });
      // Grading capacitor alongside each chamber.
      parts.push({ mat: 'composite', geo: rod(new THREE.Vector3(side * 0.5 * kk, hy + 0.55 * kk, 0), new THREE.Vector3(side * (0.35 * kk + ch), hy + 0.55 * kk, 0), 0.07 * kk, 10) });
    }
    tin = new THREE.Vector3(-(0.35 * kk + ch + 0.35), hy + 0.1, 0);
    tout = new THREE.Vector3(0.35 * kk + ch + 0.35, hy + 0.1, 0);
  } else {
    const col = L * 0.95;
    parts.push(...insulatorParts(v, col, s, 'composite'));
    const fy = s + col;
    parts.push({ mat: 'aluminium', geo: post(0.26 * kk, 0.45, 0, 0, fy, 18) });
    const chamber = L * 0.85;
    parts.push(...insulatorParts(v, chamber, fy + 0.45, 'composite', 0, 0, 1.5));
    parts.push({ mat: 'aluminium', geo: post(0.24 * kk, 0.35, 0, 0, fy + 0.45 + chamber, 18) });
    tin = new THREE.Vector3(-0.45, fy + 0.22, 0);
    tout = new THREE.Vector3(0.45, fy + 0.45 + chamber + 0.2, 0);
  }
  const proto: Prototype = { parts, terminalIn: tin, terminalOut: tout };
  if (withCabinet) {
    parts.push({ mat: 'cabinet', geo: block(0.9, 1.3, 0.6, 0, 0.75, 0.35) });
    parts.push({ mat: 'rubber', geo: block(0.5, 0.05, 0.02, 0, 1.06, 1.45) });
    proto.lamp = new THREE.Vector3(0.28, 1.4, 1.07);
  }
  return proto;
}

/** Disconnector span between rotating insulators (m). */
export const dsSpan = (v: Voltage) => ({ 400: 4.6, 275: 3.8, 220: 3.1, 110: 1.9 })[v];

/** Centre-break disconnector, one pole, with an optional earth switch. Blades are moving parts. */
export function disconnectorPole(v: Voltage, earthSwitch: boolean): Prototype {
  const S = VOLTAGE[v];
  const s = S.support;
  const L = S.insulator;
  const D = dsSpan(v);
  const kk = k(v);
  const parts: Part[] = [
    ...support(s, 0.32),
    { mat: 'galvanised', geo: block(D + 0.8, 0.22, 0.3, 0, 0, s) },
  ];
  const top = s + 0.22 + L;
  for (const side of [-1, 1]) {
    parts.push({ mat: 'galvanised', geo: post(0.2 * kk, 0.18, (side * D) / 2, 0, s + 0.22, 14) });
    parts.push(...insulatorParts(v, L, s + 0.4, 'porcelain', (side * D) / 2, 0));
    parts.push({ mat: 'aluminium', geo: post(0.16 * kk, 0.22, (side * D) / 2, 0, top + 0.15, 14) });
  }
  // Operating linkage and mechanism box.
  parts.push({ mat: 'galvanised', geo: rod(new THREE.Vector3(-D / 2, s + 0.35, 0.22), new THREE.Vector3(D / 2, s + 0.35, 0.22), 0.025, 6) });
  parts.push({ mat: 'cabinet', geo: block(0.5, 0.7, 0.35, 0, 0.28, 0.6) });
  const proto: Prototype = {
    parts,
    terminalIn: new THREE.Vector3(-D / 2 - 0.25, top + 0.3, 0),
    terminalOut: new THREE.Vector3(D / 2 + 0.25, top + 0.3, 0),
    blades: [
      { pivot: new THREE.Vector3(-D / 2, top + 0.38, 0), length: D / 2 - 0.02, side: 1 },
      { pivot: new THREE.Vector3(D / 2, top + 0.38, 0), length: D / 2 - 0.02, side: -1 },
    ],
  };
  if (earthSwitch) proto.earthArm = { pivot: new THREE.Vector3(D / 2 + 0.35, s + 0.3, -0.25), length: top - s - 0.1 };
  return proto;
}

/** Blade geometry for a disconnector: tube along +x from the pivot, with a contact at the tip. */
export function bladeGeometry(v: Voltage, length: number): Geo {
  const r = 0.05 * k(v) + 0.015;
  return merge([
    rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(length, 0, 0), r, 10),
    at(new THREE.SphereGeometry(r * 1.9, 10, 8), length, 0, 0),
    at(cyl(r * 1.6, 0.25, 10), 0, 0, 0),
  ]);
}

export function earthArmGeometry(length: number): Geo {
  return merge([rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, length, 0), 0.035, 8), at(box(0.12, 0.12, 0.12), 0, length, 0)]);
}

/** Oil-insulated current transformer: insulator with a head tank. */
export function currentTransformer(v: Voltage): Prototype {
  const S = VOLTAGE[v];
  const kk = k(v);
  const L = S.insulator * 0.95;
  const top = S.support + L;
  return {
    parts: [
      ...support(S.support),
      { mat: 'tankPaint', geo: post(0.32 * kk, 0.45, 0, 0, S.support, 18) },
      ...insulatorParts(v, L - 0.45, S.support + 0.45),
      { mat: 'aluminium', geo: at(cyl(0.36 * kk, 1.0 * kk, 22), 0, top + 0.35 * kk, 0, 0, 0, Math.PI / 2) },
      { mat: 'aluminium', geo: at(new THREE.SphereGeometry(0.36 * kk, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, top + 0.6 * kk, 0) },
    ],
    terminalIn: new THREE.Vector3(-0.6 * kk, top + 0.35 * kk, 0),
    terminalOut: new THREE.Vector3(0.6 * kk, top + 0.35 * kk, 0),
  };
}

/** Capacitive voltage transformer, optionally carrying a line trap on top. */
export function cvt(v: Voltage, lineTrap: boolean): Prototype {
  const S = VOLTAGE[v];
  const kk = k(v);
  const L = S.insulator * 1.1;
  const parts: Part[] = [
    ...support(S.support),
    { mat: 'tankPaint', geo: block(0.75 * kk, 0.75 * kk, 0.75 * kk, 0, 0, S.support) },
    ...insulatorParts(v, L, S.support + 0.75 * kk, 'porcelain'),
  ];
  let top = S.support + 0.75 * kk + L;
  if (lineTrap) {
    parts.push({ mat: 'galvanised', geo: post(0.07, 0.6, 0, 0, top, 8) });
    parts.push({ mat: 'aluminium', geo: post(0.75 * kk, 1.6 * kk, 0, 0, top + 0.6, 24) });
    parts.push({ mat: 'rubber', geo: post(0.77 * kk, 0.08, 0, 0, top + 0.6 + 0.8 * kk, 24) });
    top += 0.6 + 1.6 * kk;
  }
  return { parts, terminalIn: new THREE.Vector3(0, top + 0.1, 0), terminalOut: new THREE.Vector3(0, top + 0.1, 0) };
}

/** Metal-oxide surge arrester with grading ring at 275 kV and above, and a surge counter. */
export function surgeArrester(v: Voltage): Prototype {
  const S = VOLTAGE[v];
  const kk = k(v);
  const L = S.insulator * 1.05;
  const top = S.support + L;
  const parts: Part[] = [...support(S.support), ...insulatorParts(v, L, S.support, 'composite', 0, 0, 0.85)];
  if (v === 400 || v === 275) {
    parts.push({ mat: 'aluminium', geo: at(new THREE.TorusGeometry(0.55 * kk, 0.035, 8, 32), 0, top - 0.35, 0, Math.PI / 2) });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push({ mat: 'aluminium', geo: rod(new THREE.Vector3(0, top, 0), new THREE.Vector3(Math.cos(a) * 0.55 * kk, top - 0.35, Math.sin(a) * 0.55 * kk), 0.018, 6) });
    }
  }
  parts.push({ mat: 'cabinet', geo: block(0.2, 0.26, 0.12, 0.3, 0.25, 1.4) });
  return { parts, terminalIn: new THREE.Vector3(0, top + 0.12, 0), terminalOut: new THREE.Vector3(0, top + 0.12, 0) };
}

/** Cable sealing end: termination on a support, cable dropping into the trench. */
export function sealingEnd(v: Voltage): Prototype {
  const S = VOLTAGE[v];
  const L = S.insulator * 0.9;
  const top = S.support + L;
  return {
    parts: [
      ...support(S.support, 0.4),
      { mat: 'galvanised', geo: block(0.8, 0.12, 0.8, 0, 0, S.support) },
      ...insulatorParts(v, L, S.support + 0.12, 'composite', 0, 0, 1.25),
      { mat: 'rubber', geo: rod(new THREE.Vector3(0, S.support, 0.35), new THREE.Vector3(0, -0.2, 0.35), 0.07 * k(v) + 0.03, 10) },
    ],
    terminalIn: new THREE.Vector3(0, top + 0.12, 0),
    terminalOut: new THREE.Vector3(0, top + 0.12, 0),
  };
}

/** Fan rotor for transformer coolers, axis along y. */
export function fanRotor(r: number): Geo {
  const parts: Geo[] = [post(r * 0.18, 0.12, 0, 0, -0.06, 12)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(at(box(r * 0.8, 0.012, r * 0.22), Math.cos(a) * r * 0.5, 0, Math.sin(a) * r * 0.5, 0.25, -a, 0));
  }
  return merge(parts);
}
