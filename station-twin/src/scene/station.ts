/**
 * Builds the station from the layout: every bay, busbar and transformer, merged per component
 * and material (so a click maps straight to a component), plus moving parts driven by state:
 * disconnector blades, earth switches, breaker indicator lamps and transformer fans.
 */
import * as THREE from 'three/webgpu';
import { instanceColor, vec3 } from 'three/tsl';
import type { ComponentId, Device, SimState, TransformerId } from '../sim/types.ts';
import {
  bladeGeometry, breakerPole, currentTransformer, cvt, disconnectorPole, dsSpan, earthArmGeometry, fanRotor,
  postInsulator, sealingEnd, surgeArrester, type MatKey, type Prototype,
} from './equipment.ts';
import { at, latticeBeam, latticeColumn, merge, rod, sagging, type Geo } from './geometry.ts';
import { BAYS, BUS_SECTION, BUSBARS, TRANSFORMERS, VOLTAGE, type Bay, type Voltage } from './layout.ts';
import type { Materials } from './materials.ts';
import { buildTransformer, fireWall } from './transformer.ts';

type Owner = ComponentId;

class Collector {
  private byOwner = new Map<Owner, Map<MatKey, Geo[]>>();
  add(owner: Owner, mat: MatKey, geo: Geo): void {
    let m = this.byOwner.get(owner);
    if (!m) this.byOwner.set(owner, (m = new Map()));
    let list = m.get(mat);
    if (!list) m.set(mat, (list = []));
    list.push(geo);
  }
  addProto(owner: Owner, proto: Prototype, world: THREE.Matrix4): void {
    for (const p of proto.parts) this.add(owner, p.mat, p.geo.clone().applyMatrix4(world));
  }
  build(materials: Materials, group: THREE.Group, pickables: THREE.Object3D[], bounds: Map<Owner, THREE.Box3>): void {
    for (const [owner, mats] of this.byOwner) {
      const box = bounds.get(owner) ?? new THREE.Box3();
      for (const [mat, geos] of mats) {
        const geo = merge(geos);
        geo.computeBoundingBox();
        box.union(geo.boundingBox!);
        const mesh = new THREE.Mesh(geo, materials[mat]);
        mesh.castShadow = mat !== 'gravel';
        mesh.receiveShadow = true;
        mesh.userData.owner = owner;
        mesh.userData.matKey = mat;
        group.add(mesh);
        pickables.push(mesh);
      }
      bounds.set(owner, box);
    }
  }
}

interface Blade { owner: Owner; device: Device; base: THREE.Matrix4; side: 1 | -1; angle: number; mesh: THREE.InstancedMesh; index: number }
interface EarthArm { owner: Owner; base: THREE.Matrix4; angle: number; mesh: THREE.InstancedMesh; index: number }
interface Lamp { owner: Owner; index: number }
interface Fan { tx: TransformerId; stage: 1 | 2; base: THREE.Matrix4; angle: number; speed: number; index: number }

export interface FlowPath {
  /** Bay key (or 'BS220'); decides the sign convention for flow along the path. */
  key: string;
  owner: ComponentId;
  pts: THREE.Vector3[];
  length: number;
}

export interface LineStart {
  key: string;
  owner: ComponentId;
  voltage: Voltage;
  attach: THREE.Vector3[];
  dir: THREE.Vector3;
}

export interface StationScene {
  group: THREE.Group;
  pickables: THREE.Object3D[];
  /** Bounding boxes per component, for framing and selection. */
  bounds: Map<ComponentId, THREE.Box3>;
  /** Label anchor per component. */
  anchors: Map<ComponentId, THREE.Vector3>;
  /** Conductor paths (world, sampled along the sag), keyed by bay, for the Flow lens. */
  paths: FlowPath[];
  /** Where each overhead line leaves its gantry: phase attachment points and outward direction. */
  lineStarts: LineStart[];
  /** Cable bay ends (sealing ends), where buried cables leave the yard. */
  cableEnds: { key: string; owner: ComponentId; at: THREE.Vector3; dir: number }[];
  update(state: SimState, dt: number, time: number): void;
}

const PHASES = [-1, 0, 1] as const;

/** Bay-local (u along the bay, v across) to world. */
function bayFrame(bay: Bay): THREE.Matrix4 {
  const rot = bay.dir === 1 ? 0 : Math.PI;
  return new THREE.Matrix4().compose(new THREE.Vector3(bay.busX, 0, bay.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1));
}

const local = (u: number, v: number) => new THREE.Matrix4().makeTranslation(u, 0, v);

type ItemKind = 'dsBus' | 'dsLine' | 'ct' | 'cb' | 'cvt' | 'arrester' | 'sealing';

function sequence(bay: Bay): { kind: ItemKind; u: number }[] {
  const S = VOLTAGE[bay.voltage];
  const p = S.pitch;
  const a0 = 1.6 * S.phase + 2;
  if (bay.noBusbar) return [
    { kind: 'arrester', u: 4 }, { kind: 'ct', u: 10 }, { kind: 'cb', u: 16 }, { kind: 'dsLine', u: 23 }, { kind: 'cvt', u: 30 },
  ];
  switch (bay.kind) {
    case 'line': return [
      { kind: 'dsBus', u: a0 }, { kind: 'ct', u: a0 + 8 * p }, { kind: 'cb', u: a0 + 15 * p }, { kind: 'dsLine', u: a0 + 23 * p },
      { kind: 'cvt', u: a0 + 30 * p }, { kind: 'arrester', u: a0 + 34 * p },
    ];
    case 'cable': return [
      { kind: 'dsBus', u: a0 }, { kind: 'ct', u: a0 + 7 * p }, { kind: 'cb', u: a0 + 14 * p }, { kind: 'dsLine', u: a0 + 21 * p },
      { kind: 'arrester', u: a0 + 26 * p }, { kind: 'sealing', u: bay.length },
    ];
    default: return [
      { kind: 'dsBus', u: a0 }, { kind: 'ct', u: a0 + 7 * p }, { kind: 'cb', u: a0 + 14 * p }, { kind: 'arrester', u: bay.length - 1.5 },
    ];
  }
}

export function buildStation(materials: Materials): StationScene {
  const group = new THREE.Group();
  group.name = 'station';
  const pickables: THREE.Object3D[] = [];
  const bounds = new Map<Owner, THREE.Box3>();
  const anchors = new Map<ComponentId, THREE.Vector3>();
  const paths: FlowPath[] = [];
  const lineStarts: LineStart[] = [];
  const cableEnds: StationScene['cableEnds'] = [];
  const col = new Collector();

  // Prototype caches.
  const protoCache = new Map<string, Prototype>();
  const proto = (kind: ItemKind | 'cbCab' | 'dsEs' | 'cvtTrap' | 'post', v: Voltage, extra = 0): Prototype => {
    const key = `${kind}-${v}-${extra}`;
    let p = protoCache.get(key);
    if (!p) {
      switch (kind) {
        case 'dsBus': p = disconnectorPole(v, false); break;
        case 'dsLine': p = disconnectorPole(v, false); break;
        case 'dsEs': p = disconnectorPole(v, true); break;
        case 'ct': p = currentTransformer(v); break;
        case 'cb': p = breakerPole(v, false); break;
        case 'cbCab': p = breakerPole(v, true); break;
        case 'cvt': p = cvt(v, false); break;
        case 'cvtTrap': p = cvt(v, true); break;
        case 'arrester': p = surgeArrester(v); break;
        case 'sealing': p = sealingEnd(v); break;
        case 'post': p = postInsulator(v, extra); break;
      }
      protoCache.set(key, p);
    }
    return p;
  };

  const blades: Blade[] = [];
  const bladeMatrices = new Map<Voltage, THREE.Matrix4[]>();
  const bladeOwners: { v: Voltage; idx: number; blade: Omit<Blade, 'mesh' | 'index'> }[] = [];
  const arms: { base: THREE.Matrix4; owner: Owner; length: number }[] = [];
  const lamps: { pos: THREE.Vector3; owner: Owner }[] = [];
  let pathKey = '';
  const conductor = (owner: Owner, a: THREE.Vector3, b: THREE.Vector3, v: Voltage, sagFactor = 0.03) => {
    const r = v >= 275 ? 0.055 : v === 220 ? 0.045 : 0.035;
    const d = a.distanceTo(b);
    const sag = Math.min(1.6, 0.08 + d * sagFactor);
    col.add(owner, 'conductor', sagging(a, b, sag, r));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; const p = new THREE.Vector3().lerpVectors(a, b, t); p.y -= sag * 4 * t * (1 - t); pts.push(p); }
    paths.push({ key: pathKey, owner, pts, length: d });
  };

  // --- busbars ------------------------------------------------------------------------------
  const busPhaseX = new Map<Owner, number[]>();
  for (const bus of BUSBARS) {
    const S = VOLTAGE[bus.voltage];
    const xs = PHASES.map((o) => bus.x + o * S.phase);
    busPhaseX.set(bus.id, xs);
    const postH = S.busHeight - S.insulator - 0.35;
    const r = bus.voltage === 400 ? 0.11 : bus.voltage === 220 ? 0.085 : 0.065;
    const n = Math.max(2, Math.round((bus.z1 - bus.z0) / 13));
    for (const x of xs) {
      col.add(bus.id, 'aluminium', rod(new THREE.Vector3(x, S.busHeight, bus.z0), new THREE.Vector3(x, S.busHeight, bus.z1), r, 14));
      for (const z of [bus.z0, bus.z1]) col.add(bus.id, 'aluminium', at(new THREE.SphereGeometry(r * 2.2, 12, 8), x, S.busHeight, z));
      for (let i = 0; i <= n; i++) {
        const z = bus.z0 + ((bus.z1 - bus.z0) * i) / n;
        col.addProto(bus.id, proto('post', bus.voltage, postH), new THREE.Matrix4().makeTranslation(x, 0, z));
      }
    }
    anchors.set(bus.id, new THREE.Vector3(bus.x, S.busHeight + 4, (bus.z0 + bus.z1) / 2));
  }

  // --- bays -----------------------------------------------------------------------------------
  const txModels = new Map(TRANSFORMERS.map((t) => [t.id, buildTransformer(t)]));
  const bayEnds = new Map<string, THREE.Vector3[]>();

  for (const bay of BAYS) {
    pathKey = bay.key;
    const S = VOLTAGE[bay.voltage];
    const frame = bayFrame(bay);
    const items = sequence(bay);
    const lineBay = bay.kind === 'line';
    let prevOut: THREE.Vector3[] | null = null;
    let firstIn: THREE.Vector3[] | null = null;
    for (const item of items) {
      const outs: THREE.Vector3[] = [];
      const ins: THREE.Vector3[] = [];
      for (const o of PHASES) {
        let kind: Parameters<typeof proto>[0] = item.kind;
        if (item.kind === 'cb' && (S.phase >= 5 || o === 0)) kind = 'cbCab';
        if (item.kind === 'dsLine' && lineBay) kind = 'dsEs';
        if (item.kind === 'cvt' && o !== 0 && lineBay) kind = 'cvtTrap';
        const p = proto(kind, bay.voltage);
        const world = frame.clone().multiply(local(item.u, o * S.phase));
        col.addProto(bay.owner, p, world);
        ins.push(p.terminalIn.clone().applyMatrix4(world));
        outs.push(p.terminalOut.clone().applyMatrix4(world));
        if (p.blades) {
          for (const b of p.blades) {
            const base = world.clone().multiply(new THREE.Matrix4().makeTranslation(b.pivot.x, b.pivot.y, b.pivot.z)).multiply(new THREE.Matrix4().makeRotationY(b.side === 1 ? 0 : Math.PI));
            const device: Device = item.kind === 'dsBus' ? 'dsBus' : 'dsLine';
            const list = bladeMatrices.get(bay.voltage) ?? [];
            bladeMatrices.set(bay.voltage, list);
            bladeOwners.push({ v: bay.voltage, idx: list.length, blade: { owner: bay.owner, device, base, side: b.side, angle: 0 } });
            list.push(base);
          }
        }
        if (p.earthArm) {
          const base = world.clone().multiply(new THREE.Matrix4().makeTranslation(p.earthArm.pivot.x, p.earthArm.pivot.y, p.earthArm.pivot.z));
          arms.push({ base, owner: bay.owner, length: p.earthArm.length });
        }
        if (p.lamp) lamps.push({ pos: p.lamp.clone().applyMatrix4(world), owner: bay.owner });
      }
      if (prevOut) for (let i = 0; i < 3; i++) conductor(bay.owner, prevOut[i]!, ins[i]!, bay.voltage);
      if (!firstIn) firstIn = ins;
      prevOut = outs;
    }

    // Busbar droppers.
    if (!bay.noBusbar && firstIn) {
      const busId = BUSBARS.find((b) => b.voltage === bay.voltage && Math.abs(b.x - bay.busX) < 1 && bay.z >= b.z0 - 1 && bay.z <= b.z1 + 1)?.id;
      const xs = busId ? busPhaseX.get(busId)! : PHASES.map((o) => bay.busX + o * S.phase);
      const sortedIn = [...firstIn].sort((a, b) => a.z - b.z);
      sortedIn.forEach((p, i) => {
        const top = new THREE.Vector3(xs[i]!, S.busHeight - 0.05, p.z);
        conductor(bay.owner, top, p, bay.voltage, 0.02);
        col.add(bay.owner, 'aluminium', at(new THREE.BoxGeometry(0.3, 0.25, 0.3), top.x, top.y, top.z));
      });
    }

    // Bay end: gantry, sealing end, or transformer bushings.
    const end = prevOut!;
    bayEnds.set(bay.key, end);
    if (bay.kind === 'cable') cableEnds.push({ key: bay.key, owner: bay.owner, at: end[1]!.clone(), dir: bay.dir });
    const anchorLocal = new THREE.Vector3(bay.length, (lineBay ? S.gantry : S.support + S.insulator) + 3, 0).applyMatrix4(frame);
    if (!anchors.has(bay.owner)) anchors.set(bay.owner, anchorLocal);
    if (lineBay) {
      const halfW = S.phase + 2.6;
      const colW = bay.voltage === 400 ? 1.4 : 1.0;
      for (const s of [-1, 1]) {
        const g = latticeColumn(S.gantry + 3, colW, colW * 0.75);
        col.add(bay.owner, 'galvanised', g.clone().applyMatrix4(frame.clone().multiply(local(bay.length, s * halfW))));
      }
      col.add(bay.owner, 'galvanised', latticeBeam(halfW * 2 + 1, colW * 0.8, S.gantry).applyMatrix4(frame.clone().multiply(local(bay.length, 0))));
      const attach: THREE.Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const o = PHASES[i]!;
        const att = new THREE.Vector3(bay.length + 0.6, S.gantry - 0.5, o * S.phase).applyMatrix4(frame);
        const outer = new THREE.Vector3(bay.length + 0.6 + S.insulator * 0.9, S.gantry - 0.9, o * S.phase).applyMatrix4(frame);
        col.add(bay.owner, 'composite', rod(att, outer, 0.045, 8));
        const axis = new THREE.Vector3().subVectors(outer, att).normalize().multiplyScalar(0.035);
        const discs = Math.round(S.insulator * 4);
        for (let k = 1; k < discs; k++) {
          const p = new THREE.Vector3().lerpVectors(att, outer, k / discs);
          col.add(bay.owner, 'composite', rod(p.clone().sub(axis), p.clone().add(axis), bay.voltage >= 275 ? 0.15 : 0.12, 14));
        }
        // Down-lead to the last item, and the outgoing span to the line.
        conductor(bay.owner, end[i]!, outer, bay.voltage, 0.05);
        attach.push(outer);
      }
      lineStarts.push({ key: bay.key, owner: bay.owner, voltage: bay.voltage, attach, dir: new THREE.Vector3(bay.dir, 0, 0) });
    }
  }

  // Transformer connections: last item of each transformer bay to its bushings.
  const connectTx = (bayKey: string, txId: TransformerId, side: 'hv' | 'lv') => {
    pathKey = bayKey;
    const bay = BAYS.find((b) => b.key === bayKey)!;
    const ends = [...bayEnds.get(bayKey)!].sort((a, b) => a.z - b.z);
    const model = txModels.get(txId)!;
    const terms = side === 'hv' ? model.hvTerminals : model.lvTerminals;
    ends.forEach((p, i) => conductor(bay.owner, p, terms[i]!, bay.voltage, 0.04));
  };
  connectTx('T1-HV', 'T1', 'hv'); connectTx('T1-LV', 'T1', 'lv');
  connectTx('T2-HV', 'T2', 'hv'); connectTx('T2-LV', 'T2', 'lv');
  connectTx('T3-220', 'T3', 'hv'); connectTx('T3-110', 'T3', 'lv');
  connectTx('T4-220', 'T4', 'lv');
  {
    // T4's 275 kV bay starts at its HV bushings.
    pathKey = 'T4-275';
    const bay = BAYS.find((b) => b.key === 'T4-275')!;
    const frame = bayFrame(bay);
    const first = sequence(bay)[0]!;
    const p = proto('arrester', 275);
    const ins = PHASES.map((o) => p.terminalIn.clone().applyMatrix4(frame.clone().multiply(local(first.u, o * VOLTAGE[275].phase)))).sort((a, b) => a.z - b.z);
    txModels.get('T4')!.hvTerminals.forEach((t, i) => conductor('TIE_NI', t, ins[i]!, 275, 0.04));
  }

  for (const t of TRANSFORMERS) {
    const m = txModels.get(t.id)!;
    for (const part of m.parts) col.add(t.id, part.mat, part.geo);
    anchors.set(t.id, m.anchor.clone().add(new THREE.Vector3(0, 3, 0)));
  }
  for (const part of fireWall(-87, 0, 16, 8.5)) col.add('T1', part.mat, part.geo);

  // --- bus-section bay on the 220 kV busbar ----------------------------------------------------
  pathKey = 'BS220';
  {
    const S = VOLTAGE[220];
    const frame = new THREE.Matrix4().compose(new THREE.Vector3(BUS_SECTION.x, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1));
    const items: { kind: 'dsBus' | 'cbCab' | 'dsLine'; u: number }[] = [{ kind: 'dsBus', u: -4.8 }, { kind: 'cbCab', u: 0 }, { kind: 'dsLine', u: 4.8 }];
    const term: THREE.Vector3[][] = [];
    for (const it of items) {
      const p = proto(it.kind === 'cbCab' ? 'cbCab' : 'dsBus', 220);
      const row: THREE.Vector3[] = [];
      for (const o of PHASES) {
        const world = frame.clone().multiply(local(it.u, o * S.phase));
        col.addProto('BS220', p, world);
        row.push(p.terminalIn.clone().applyMatrix4(world), p.terminalOut.clone().applyMatrix4(world));
        if (p.blades) for (const b of p.blades) {
          const base = world.clone().multiply(new THREE.Matrix4().makeTranslation(b.pivot.x, b.pivot.y, b.pivot.z)).multiply(new THREE.Matrix4().makeRotationY(b.side === 1 ? 0 : Math.PI));
          const list = bladeMatrices.get(220) ?? [];
          bladeMatrices.set(220, list);
          bladeOwners.push({ v: 220, idx: list.length, blade: { owner: 'BS220', device: it.kind === 'dsBus' ? 'dsBus' : 'dsLine', base, side: b.side, angle: 0 } });
          list.push(base);
        }
        if (p.lamp && o === 0) lamps.push({ pos: p.lamp.clone().applyMatrix4(world), owner: 'BS220' });
      }
      term.push(row);
    }
    const xsA = busPhaseX.get('BUS220A')!;
    for (const x of xsA) {
      const near = (z: number) => {
        const all = term.flat();
        return all.reduce((best, p) => (Math.abs(p.x - x) + Math.abs(p.z - z) < Math.abs(best.x - x) + Math.abs(best.z - z) ? p : best), all[0]!);
      };
      conductor('BS220', new THREE.Vector3(x, S.busHeight, -7), near(-7), 220, 0.02);
      conductor('BS220', near(7), new THREE.Vector3(x, S.busHeight, 7), 220, 0.02);
    }
    anchors.set('BS220', new THREE.Vector3(BUS_SECTION.x, S.busHeight + 4, 0));
  }

  col.build(materials, group, pickables, bounds);

  // --- moving parts ----------------------------------------------------------------------------
  for (const [v, mats] of bladeMatrices) {
    const geo = bladeGeometry(v, dsSpan(v) / 2 - 0.02);
    const mesh = new THREE.InstancedMesh(geo, materials.aluminium, mats.length);
    mesh.castShadow = true;
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    group.add(mesh);
    for (const b of bladeOwners.filter((x) => x.v === v)) blades.push({ ...b.blade, mesh, index: b.idx });
    mesh.userData.blades = true;
  }
  const armMeshes: EarthArm[] = [];
  if (arms.length) {
    const mesh = new THREE.InstancedMesh(earthArmGeometry(arms[0]!.length), materials.galvanised, arms.length);
    arms.forEach((a, i) => { armMeshes.push({ owner: a.owner, base: a.base, angle: Math.PI / 2, mesh, index: i }); });
    group.add(mesh);
  }
  const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 10, 8), materials.lamp, lamps.length);
  materials.lamp.emissiveNode = vec3(instanceColor).mul(3.0);
  const lampList: Lamp[] = lamps.map((l, i) => {
    lampMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(l.pos.x, l.pos.y, l.pos.z));
    lampMesh.setColorAt(i, new THREE.Color(0xff2a1a));
    return { owner: l.owner, index: i };
  });
  group.add(lampMesh);

  const fans: Fan[] = [];
  const fanBases: THREE.Matrix4[] = [];
  for (const t of TRANSFORMERS) for (const f of txModels.get(t.id)!.fans) {
    const base = new THREE.Matrix4().makeTranslation(f.pos.x, f.pos.y, f.pos.z);
    fans.push({ tx: t.id, stage: f.stage, base, angle: fanBases.length * 1.3, speed: 0, index: fanBases.length });
    fanBases.push(base);
  }
  const fanMesh = new THREE.InstancedMesh(fanRotor(0.4), materials.fanBlade, fanBases.length);
  fanBases.forEach((m, i) => fanMesh.setMatrixAt(i, m));
  group.add(fanMesh);

  const tmp = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const OPEN = Math.PI / 2;
  const travel = OPEN / 3; // a quarter turn in about 3 s
  const red = new THREE.Color(0xff2a1a);
  const green = new THREE.Color(0x19d15a);
  const amber = new THREE.Color(0xffa400);
  const off = new THREE.Color(0x101010);

  function update(state: SimState, dt: number, time: number): void {
    const C = state.C;
    for (const b of blades) {
      const c = C[b.owner];
      const closed = c.bay ? (b.device === 'dsBus' ? c.bay.dsBus : c.bay.dsLine) : true;
      const target = closed ? 0 : OPEN;
      if (b.angle !== target) {
        b.angle = target > b.angle ? Math.min(target, b.angle + travel * dt) : Math.max(target, b.angle - travel * dt);
        rot.makeRotationY(b.side * b.angle);
        b.mesh.setMatrixAt(b.index, tmp.multiplyMatrices(b.base, rot));
        b.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const a of armMeshes) {
      const es = C[a.owner].bay?.es;
      const target = es ? 0 : Math.PI / 2;
      if (a.angle !== target || a.mesh.userData.init !== true) {
        a.angle = target > a.angle ? Math.min(target, a.angle + travel * dt) : Math.max(target, a.angle - travel * dt);
        a.mesh.setMatrixAt(a.index, tmp.multiplyMatrices(a.base, rot.makeRotationZ(a.angle)));
        a.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (armMeshes[0]) armMeshes[0].mesh.userData.init = true;
    for (const l of lampList) {
      const c = C[l.owner];
      const col2 = !c.installed ? off : c.tripped ? (Math.sin(time * 8) > 0 ? amber : off) : c.closed ? red : green;
      lampMesh.setColorAt(l.index, col2);
    }
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
    for (const f of fans) {
      const t = C[f.tx];
      const running = t.live && t.installed && t.stage >= f.stage;
      const target = running ? 14 : 0;
      f.speed += (target - f.speed) * Math.min(1, dt * 0.8);
      if (f.speed > 0.01) {
        f.angle += f.speed * dt;
        fanMesh.setMatrixAt(f.index, tmp.multiplyMatrices(f.base, rot.makeRotationY(f.angle)));
      }
    }
    fanMesh.instanceMatrix.needsUpdate = true;
  }

  // Regional demand spans two bays; anchor its label between them.
  const ra = BAYS.find((b) => b.key === 'REG-A')!;
  anchors.set('LD_TOWN', new THREE.Vector3(ra.busX + ra.length, VOLTAGE[220].support + VOLTAGE[220].insulator + 3, -8));
  const g1 = BAYS.find((b) => b.key === 'L400-1')!;
  anchors.set('GRID', new THREE.Vector3(g1.busX - g1.length, VOLTAGE[400].gantry + 4, -44));

  void merge;
  return { group, pickables, bounds, anchors, paths, lineStarts, cableEnds, update };
}
