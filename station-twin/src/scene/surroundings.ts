/**
 * The network in place: overhead lines on towers to each neighbour, the connected plant, the
 * town, the border, and the hedgerow landscape. Everything that moves is driven by the state.
 */
import * as THREE from 'three/webgpu';
import { color, float, fract, mix, mx_cell_noise_float, mx_fractal_noise_float, positionWorld, step, uniform, vec3 } from 'three/tsl';
import { createPrng } from '../lib/prng.ts';
import type { ComponentId, SimState } from '../sim/types.ts';
import { at, block, box, cyl, insulator, latticeBeam, latticeColumn, merge, post, rod, sagging, type Geo } from './geometry.ts';
import type { Materials } from './materials.ts';
import { BORDER, CABLES, CLEAR, FAR_ANCHORS, LINES, SITES, type LineRoute, type Rect, type TowerType } from './siteplan.ts';
import type { FlowPath, LineStart } from './station.ts';
import { inLough, terrainHeight } from './yard.ts';

export interface Surroundings {
  group: THREE.Group;
  pickables: THREE.Object3D[];
  bounds: Map<ComponentId, THREE.Box3>;
  farAnchors: Map<ComponentId, THREE.Vector3>;
  staticLabels: { text: string; pos: THREE.Vector3; minDistance: number }[];
  paths: FlowPath[];
  update(state: SimState, dt: number, time: number): void;
}

const ground = (x: number, z: number) => terrainHeight(x, z);
const inRect = (r: Rect, x: number, z: number, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

// ------------------------------------------------------------------------------------------
// Towers
// ------------------------------------------------------------------------------------------

interface TowerProto { geo: Geo; insulators: Geo; wood: boolean; attach: THREE.Vector3[] }

function towerProto(type: TowerType): TowerProto {
  if (type === 'woodpole110') {
    const poles = merge([post(0.19, 14.5, 0, -2.3, 0, 10), post(0.19, 14.5, 0, 2.3, 0, 10), block(0.22, 0.28, 9.2, 0, 0, 12.4), rod(new THREE.Vector3(0, 9.5, -2.3), new THREE.Vector3(0, 12.3, 0), 0.07, 6), rod(new THREE.Vector3(0, 9.5, 2.3), new THREE.Vector3(0, 12.3, 0), 0.07, 6)]);
    const ins: Geo[] = [];
    const attach: THREE.Vector3[] = [];
    for (const z of [-3.8, 0, 3.8]) {
      const i = insulator(0.9, 0.06, 0.13, 5);
      ins.push(at(i.body, 0, 12.68, z));
      attach.push(new THREE.Vector3(0, 13.65, z));
    }
    return { geo: poles, insulators: merge(ins), wood: true, attach };
  }
  const k = type === 'lattice400' ? 1 : type === 'lattice275' ? 0.86 : 0.76;
  const h = 36 * k;
  const arm = 11.5 * k;
  const parts: Geo[] = [
    latticeColumn(h, 8 * k, 2.2 * k, 2.4),
    latticeBeam(arm * 2 + 2, 1.8 * k, h - 4 * k).applyMatrix4(new THREE.Matrix4()),
  ];
  for (const s of [-1, 1]) {
    parts.push(rod(new THREE.Vector3(0, h - 4 * k, s * 1.1 * k), new THREE.Vector3(0, h + 5 * k, s * arm * 0.55), 0.07, 4));
    parts.push(rod(new THREE.Vector3(0, h - 6 * k, s * 1.1 * k), new THREE.Vector3(0, h - 4 * k, s * arm), 0.06, 4));
  }
  const ins: Geo[] = [];
  const attach: THREE.Vector3[] = [];
  for (const z of [-arm, 0, arm]) {
    const L = 4.4 * k;
    const y0 = h - 4.9 * k;
    ins.push(rod(new THREE.Vector3(0, y0, z), new THREE.Vector3(0, y0 - L, z), 0.05, 6));
    for (let d = 1; d < 12; d++) ins.push(rod(new THREE.Vector3(0, y0 - (L * d) / 12 + 0.03, z), new THREE.Vector3(0, y0 - (L * d) / 12 - 0.03, z), 0.15 * k + 0.04, 10));
    attach.push(new THREE.Vector3(0, y0 - L, z));
  }
  return { geo: merge(parts), insulators: merge(ins), wood: false, attach };
}

// ------------------------------------------------------------------------------------------

export function buildSurroundings(m: Materials, lineStarts: LineStart[], cableEnds: { key: string; owner: ComponentId; at: THREE.Vector3 }[] = []): Surroundings {
  const group = new THREE.Group();
  group.name = 'surroundings';
  const pickables: THREE.Object3D[] = [];
  const bounds = new Map<ComponentId, THREE.Box3>();
  const farAnchors = new Map<ComponentId, THREE.Vector3>();
  for (const [id, p] of Object.entries(FAR_ANCHORS)) farAnchors.set(id as ComponentId, new THREE.Vector3(...p));
  const staticLabels: Surroundings['staticLabels'] = [];
  const paths: FlowPath[] = [];
  const rng = createPrng(20260310);

  const addMesh = (geo: Geo, mat: THREE.Material, owner: ComponentId | null, shadows = true) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    if (owner) {
      mesh.userData.owner = owner;
      pickables.push(mesh);
      geo.computeBoundingBox();
      const b = bounds.get(owner) ?? new THREE.Box3();
      bounds.set(owner, b.union(geo.boundingBox!));
    }
    group.add(mesh);
    return mesh;
  };

  type Lit = THREE.UniformNode<'float', number>;
  // --- extra materials -------------------------------------------------------------------
  const wood = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  wood.colorNode = mix(color(0x4a3a2a), color(0x5e4a35), mx_fractal_noise_float(positionWorld.mul(vec3(3, 0.3, 3)), 2, 2, 0.5).mul(0.5).add(0.5));
  const turbineWhite = new THREE.MeshStandardNodeMaterial({ color: 0xe8ebec, roughness: 0.45, metalness: 0.05 });
  // Monocrystalline modules: dark blue glass. Low metalness, so they read as blue panels, not as sky.
  const panel = new THREE.MeshStandardNodeMaterial({ color: 0x1a2a46, roughness: 0.32, metalness: 0.1 });
  const containerMat = new THREE.MeshStandardNodeMaterial({ color: 0xd9dcdc, roughness: 0.55, metalness: 0.2 });
  const plumeMat = new THREE.MeshBasicNodeMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.18, depthWrite: false });
  const borderMat = new THREE.MeshBasicNodeMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0.55, depthWrite: false });
  const townLit = uniform(1) as unknown as Lit;
  const industryLit = uniform(1) as unknown as Lit;
  const campusLit = uniform(1) as unknown as Lit;
  const lit = (u: Lit, base: number, tint: number) => {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
    const p = positionWorld;
    const win = step(float(0.55), fract(p.y.div(3.1))).mul(step(float(0.42), fract(p.x.add(p.z).div(2.6))));
    const occupied = step(float(0.35), mx_cell_noise_float(p.mul(0.4)));
    mat.colorNode = mix(color(base), color(base).mul(0.82), mx_fractal_noise_float(p.mul(0.08), 2, 2, 0.5).mul(0.5).add(0.5));
    mat.emissiveNode = color(tint).mul(win.mul(occupied).mul(m.night).mul(u).mul(2.4));
    return mat;
  };
  const townMat = lit(townLit, 0xd8cfc2, 0xffd59a);
  const industryMat = lit(industryLit, 0xb7bcbd, 0xfff0d0);
  const campusMat = lit(campusLit, 0xcfd3d6, 0xdfe9ff);
  const roofMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.1 });
  roofMat.colorNode = mix(color(0x4b4642), color(0x6a5248), mx_cell_noise_float(positionWorld.mul(0.05)));

  // --- overhead lines --------------------------------------------------------------------------
  const protos = new Map<TowerType, TowerProto>();
  const proto = (t: TowerType) => { let p = protos.get(t); if (!p) protos.set(t, (p = towerProto(t))); return p; };
  const towerMatrices = new Map<TowerType, THREE.Matrix4[]>();
  const ends: { line: LineRoute; at: THREE.Vector3 }[] = [];

  for (const line of LINES) {
    const start = lineStarts.find((s) => s.key === line.bay);
    if (!start) continue;
    const p = proto(line.tower);
    const gantryMid = start.attach[1]!.clone();
    const first = gantryMid.clone().add(start.dir.clone().multiplyScalar(60));
    const pts: [number, number][] = [[first.x, first.z], ...line.route];
    // Place towers along the polyline at roughly the nominal span.
    const towers: { x: number; z: number; yaw: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]!;
      const [bx, bz] = pts[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / line.span));
      for (let k2 = 0; k2 < n; k2++) towers.push({ x: ax + ((bx - ax) * k2) / n, z: az + ((bz - az) * k2) / n, yaw: 0 });
    }
    const last = pts[pts.length - 1]!;
    towers.push({ x: last[0], z: last[1], yaw: 0 });
    for (let i = 0; i < towers.length; i++) {
      const a = towers[Math.max(0, i - 1)]!;
      const b = towers[Math.min(towers.length - 1, i + 1)]!;
      const prev = i === 0 ? { x: gantryMid.x, z: gantryMid.z } : a;
      towers[i]!.yaw = Math.atan2(-(b.z - prev.z), b.x - prev.x);
    }
    const list = towerMatrices.get(line.tower) ?? [];
    towerMatrices.set(line.tower, list);
    const attachWorld: THREE.Vector3[][] = towers.map((t) => {
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3(t.x, ground(t.x, t.z) - 0.3, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.yaw, 0)), new THREE.Vector3(1, 1, 1));
      list.push(mtx);
      return p.attach.map((v) => v.clone().applyMatrix4(mtx));
    });
    // Order gantry phases to match the first tower's phases (by side of the line).
    const across = new THREE.Vector3(Math.sin(towers[0]!.yaw), 0, Math.cos(towers[0]!.yaw));
    const gantry = [...start.attach].sort((u, v) => u.dot(across) - v.dot(across));
    const firstAttach = [...attachWorld[0]!].sort((u, v) => u.dot(across) - v.dot(across));
    attachWorld[0] = firstAttach;
    const spans: Geo[] = [];
    const r = line.voltage >= 275 ? 0.07 : line.voltage === 220 ? 0.055 : 0.04;
    const chain = [gantry, ...attachWorld];
    for (let i = 0; i < chain.length - 1; i++) {
      const A = chain[i]!;
      let B = chain[i + 1]!;
      if (i > 0) {
        // Keep phases on the same side from tower to tower.
        const dir = new THREE.Vector3().subVectors(B[1]!, A[1]!).setY(0).normalize();
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const sa = [...A].sort((u, v) => u.dot(side) - v.dot(side));
        const sb = [...B].sort((u, v) => u.dot(side) - v.dot(side));
        chain[i] = sa; B = sb; chain[i + 1] = sb;
      }
      for (let ph = 0; ph < 3; ph++) {
        const a = chain[i]![ph]!;
        const b = chain[i + 1]![ph]!;
        const d = a.distanceTo(b);
        const sag = i === 0 ? Math.min(2.5, d * 0.03) : d * 0.028;
        spans.push(sagging(a, b, sag, r));
        const ptsP: THREE.Vector3[] = [];
        for (let s = 0; s <= 16; s++) { const t = s / 16; const q = new THREE.Vector3().lerpVectors(a, b, t); q.y -= sag * 4 * t * (1 - t); ptsP.push(q); }
        paths.push({ key: line.bay, owner: line.owner, pts: ptsP, length: d });
      }
    }
    addMesh(merge(spans), m.conductor, line.owner, false).userData.flowConductor = true;
    const endT = towers[towers.length - 1]!;
    ends.push({ line, at: new THREE.Vector3(endT.x, ground(endT.x, endT.z), endT.z) });
  }
  for (const [type, mats] of towerMatrices) {
    const p = proto(type);
    for (const [geo, mat] of [[p.geo, p.wood ? wood : m.galvanised], [p.insulators, m.composite]] as const) {
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.userData.structure = true;
      group.add(im);
    }
  }

  // Neighbour stations at the far ends. Their names come from the component labels; only the
  // 400 kV system, which has no single far end, gets a place label.
  for (const e of ends) {
    if (e.line.owner === 'TIE_NI' || e.line.owner === 'WIND') continue;
    if (e.line.owner === 'GRID') {
      if (e.line.bay === 'L400-1') staticLabels.push({ text: `${e.line.destination} · ${e.line.realKm} km`, pos: e.at.clone().add(new THREE.Vector3(0, 70, 0)), minDistance: 900 });
      continue;
    }
    const g: Geo[] = [block(70, 0.2, 50, e.at.x, e.at.z, e.at.y), block(9, 5, 4, e.at.x - 10, e.at.z, e.at.y), block(9, 5, 4, e.at.x + 10, e.at.z, e.at.y)];
    for (let i = -2; i <= 2; i++) g.push(post(0.25, 9, e.at.x + i * 9, e.at.z + 15, e.at.y));
    addMesh(merge(g), m.cabinet, null);
  }
  staticLabels.push({ text: 'Clonmore 400/275/220/110 kV', pos: new THREE.Vector3(-55, 60, 0), minDistance: 1100 });

  // --- buried cables: no physical mesh beyond marker posts, but they carry flow in the Flow lens ---
  {
    const markers: Geo[] = [];
    for (const c of cableEnds) {
      const route = CABLES[c.key];
      if (!route) continue;
      const pts2: [number, number][] = [[c.at.x, c.at.z], ...route];
      const pts: THREE.Vector3[] = [new THREE.Vector3(c.at.x, c.at.y, c.at.z)];
      let length = 0;
      for (let i = 0; i < pts2.length - 1; i++) {
        const [ax, az] = pts2[i]!;
        const [bx, bz] = pts2[i + 1]!;
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 40));
        for (let k2 = i === 0 ? 0 : 1; k2 <= n; k2++) {
          const x = ax + ((bx - ax) * k2) / n;
          const z = az + ((bz - az) * k2) / n;
          const p = new THREE.Vector3(x, ground(x, z) + 0.6, z);
          length += p.distanceTo(pts[pts.length - 1]!);
          pts.push(p);
          if (i > 0 || k2 > 2) if (k2 % 3 === 0) markers.push(post(0.06, 1.1, x + 1.5, z, ground(x, z), 5));
        }
      }
      paths.push({ key: c.key, owner: c.owner, pts, length });
    }
    if (markers.length) addMesh(merge(markers), m.cabinet, null, false);
  }

  // --- wind farm ---------------------------------------------------------------------------------
  const wf = SITES.windfarm;
  const turbines: THREE.Vector3[] = [];
  for (let gz = 0; gz < 6 && turbines.length < 40; gz++) {
    for (let gx = 0; gx < 8 && turbines.length < 40; gx++) {
      const x = wf.x0 + 120 + gx * ((wf.x1 - wf.x0 - 240) / 7) + (rng.next() - 0.5) * 120;
      const z = wf.z0 + 120 + gz * ((wf.z1 - wf.z0 - 240) / 5) + (rng.next() - 0.5) * 120;
      turbines.push(new THREE.Vector3(x, ground(x, z), z));
    }
  }
  const towerGeo = merge([at(cyl(2.3, 105, 20, 1.45), 0, 52.5, 0), block(5.5, 1.2, 5.5, 0, 0, -0.4)]);
  const nacelleGeo = merge([at(box(12, 4.2, 4.2), 2.5, 107, 0), at(new THREE.SphereGeometry(2.2, 14, 10), -3.8, 107, 0)]);
  const bladeGeo = (() => {
    const blades: Geo[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const shape = new THREE.Shape();
      shape.moveTo(0, -1.6); shape.lineTo(66, -0.35); shape.lineTo(66, 0.35); shape.lineTo(12, 2.4); shape.lineTo(0, 1.6);
      const g = new THREE.ShapeGeometry(shape, 1);
      g.rotateY(Math.PI / 2);
      g.rotateX(a);
      blades.push(g);
    }
    return merge(blades);
  })();
  const yaw = Math.PI * 0.25; // facing the prevailing south-westerly
  const tMats = turbines.map((p) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)));
  for (const [geo, mat] of [[towerGeo, turbineWhite], [nacelleGeo, turbineWhite]] as const) {
    const im = new THREE.InstancedMesh(geo, mat, turbines.length);
    tMats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = true;
    im.userData.owner = 'WIND';
    group.add(im);
    pickables.push(im);
  }
  const bladeMat = turbineWhite.clone();
  bladeMat.side = THREE.DoubleSide;
  const rotors = new THREE.InstancedMesh(bladeGeo, bladeMat, turbines.length);
  rotors.castShadow = true;
  group.add(rotors);
  const rotorAngle = turbines.map((_, i) => i * 0.7);
  const hubOffset = new THREE.Vector3(-4.6, 107, 0);
  const wfBox = new THREE.Box3();
  for (const p of turbines) wfBox.expandByPoint(p).expandByPoint(p.clone().add(new THREE.Vector3(0, 170, 0)));
  bounds.set('WIND', wfBox);
  // Collector substation at the end of the wind farm line.
  {
    const e = ends.find((x) => x.line.owner === 'WIND')!;
    addMesh(merge([block(60, 0.2, 40, e.at.x, e.at.z, e.at.y), block(8, 5, 4, e.at.x, e.at.z + 6, e.at.y), block(12, 3, 5, e.at.x + 15, e.at.z - 10, e.at.y)]), m.cabinet, 'WIND');
  }

  // --- solar farm (appears with a construction sequence when built) ---------------------------
  const sf = SITES.solar;
  // Tilted 25 degrees towards the south (+z), as fixed-tilt arrays are in Ireland.
  const panelGeo = merge([at(box(24, 0.06, 4.2), 0, 2.0, 0, 0.44, 0, 0)]);
  const legGeo = merge([post(0.05, 2.6, -11, -1.2, 0, 4), post(0.05, 1.4, -11, 1.4, 0, 4), post(0.05, 2.6, 0, -1.2, 0, 4), post(0.05, 1.4, 0, 1.4, 0, 4), post(0.05, 2.6, 11, -1.2, 0, 4), post(0.05, 1.4, 11, 1.4, 0, 4)]);
  const solarRows: THREE.Matrix4[][] = [];
  for (let z = sf.z0 + 10; z < sf.z1 - 6; z += 8.5) {
    const row: THREE.Matrix4[] = [];
    for (let x = sf.x0 + 16; x < sf.x1 - 12; x += 25.5) row.push(new THREE.Matrix4().makeTranslation(x, ground(x, z), z));
    solarRows.push(row);
  }
  const solarAll = solarRows.flat();
  const panels = new THREE.InstancedMesh(panelGeo, panel, solarAll.length);
  const legs = new THREE.InstancedMesh(legGeo, m.galvanised, solarAll.length);
  panels.userData.owner = 'SOLAR';
  legs.userData.owner = 'SOLAR';
  panels.castShadow = true;
  group.add(panels, legs);
  pickables.push(panels, legs);
  bounds.set('SOLAR', new THREE.Box3(new THREE.Vector3(sf.x0, 0, sf.z0), new THREE.Vector3(sf.x1, 4, sf.z1)));
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let solarProgress = -1;

  // --- battery compound -----------------------------------------------------------------------
  const bt = SITES.battery;
  const contMats: THREE.Matrix4[] = [];
  const ledPos: THREE.Vector3[] = [];
  for (let r2 = 0; r2 < 4; r2++) for (let c = 0; c < 6; c++) {
    const x = bt.x0 + 12 + c * 14;
    const z = bt.z0 + 12 + r2 * 16;
    contMats.push(new THREE.Matrix4().makeTranslation(x, 0, z));
    ledPos.push(new THREE.Vector3(x - 5.6, 2.4, z + 1.32));
  }
  const containerGeo = merge([block(12.2, 2.9, 2.5), block(12.4, 0.25, 2.7, 0, 0, -0.2)]);
  const containers = new THREE.InstancedMesh(containerGeo, containerMat, contMats.length);
  containers.userData.owner = 'BESS';
  containers.castShadow = true;
  group.add(containers);
  pickables.push(containers);
  const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.12, 0.05), m.lamp, ledPos.length);
  ledPos.forEach((p, i) => { leds.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)); leds.setColorAt(i, new THREE.Color(0x101010)); });
  group.add(leds);
  const batteryFixed = addMesh(merge([block(bt.x1 - bt.x0 + 8, 0.2, bt.z1 - bt.z0 + 8, (bt.x0 + bt.x1) / 2, (bt.z0 + bt.z1) / 2, -0.05), block(6, 3, 4, bt.x1 - 4, bt.z0 - 2), block(3, 2.2, 2.4, bt.x1 - 4, bt.z1 + 2)]), m.concrete, 'BESS');
  bounds.set('BESS', new THREE.Box3(new THREE.Vector3(bt.x0, 0, bt.z0), new THREE.Vector3(bt.x1, 4, bt.z1)));
  let batteryProgress = -1;

  // --- gas peaker -------------------------------------------------------------------------------
  const gs = SITES.gas;
  const gcx = (gs.x0 + gs.x1) / 2;
  const gcz = (gs.z0 + gs.z1) / 2;
  const gasGroup = new THREE.Group();
  const gasGeo = merge([block(44, 15, 18, gcx, gcz, 0), block(14, 10, 14, gcx - 26, gcz, 0), block(12, 6, 10, gcx + 20, gcz + 22, 0)]);
  const gasPad = new THREE.Mesh(block(gs.x1 - gs.x0, 0.2, gs.z1 - gs.z0, gcx, gcz, -0.05), m.concrete);
  gasPad.receiveShadow = true;
  gasGroup.add(gasPad);
  const gasMesh = new THREE.Mesh(gasGeo, m.cladding);
  gasMesh.castShadow = true; gasMesh.userData.owner = 'GAS';
  const stack = new THREE.Mesh(merge([post(2.6, 36, gcx + 26, gcz, 0, 20), post(2.9, 1.2, gcx + 26, gcz, 35, 20)]), m.galvanised);
  stack.castShadow = true; stack.userData.owner = 'GAS';
  gasGroup.add(gasMesh, stack);
  group.add(gasGroup);
  pickables.push(gasMesh, stack);
  bounds.set('GAS', new THREE.Box3(new THREE.Vector3(gs.x0 - 10, 0, gs.z0), new THREE.Vector3(gs.x1 + 10, 36, gs.z1)));
  const plumeN = 46;
  const plume = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), plumeMat, plumeN);
  // Puffs start at zero scale, so bounds taken then would cull the plume for good.
  plume.frustumCulled = false;
  plume.renderOrder = 5;
  group.add(plume);
  const plumeAge = Array.from({ length: plumeN }, (_, i) => i / plumeN);
  const stackTop = new THREE.Vector3(gcx + 26, 37, gcz);

  // --- new demand connection (data centre campus) ----------------------------------------------
  const cp = SITES.campus;
  const campusGroup = new THREE.Group();
  const campusGeo: Geo[] = [];
  const roofGeo: Geo[] = [];
  // The site is on a slope: each hall stands on the highest ground under it, with a plinth down to
  // the lowest, so no part of it is buried in the hillside.
  const span = (x0: number, z0: number, x1: number, z1: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const h = ground(x0 + ((x1 - x0) * i) / 8, z0 + ((z1 - z0) * j) / 8); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return { lo, hi };
  };
  for (let i = 0; i < 3; i++) {
    const x = cp.x0 + 50 + i * 80;
    const zc = (cp.z0 + cp.z1) / 2;
    const g = span(x - 31, zc - 75, x + 31, zc + 75);
    campusGeo.push(block(66, g.hi - g.lo + 1.5, 154, x, zc, g.lo - 1));
    campusGeo.push(block(62, 16, 150, x, zc, g.hi + 0.5));
    for (let k2 = 0; k2 < 10; k2++) roofGeo.push(block(5, 2.2, 10, x - 20 + (k2 % 2) * 40, cp.z0 + 30 + Math.floor(k2 / 2) * 32, g.hi + 16.5));
  }
  for (let k2 = 0; k2 < 12; k2++) { const z = cp.z0 + 10 + k2 * 17; roofGeo.push(block(10, 3.2, 3.2, cp.x1 - 18, z, ground(cp.x1 - 18, z) - 0.3)); }
  const campusMesh = new THREE.Mesh(merge(campusGeo), campusMat);
  const campusPlant = new THREE.Mesh(merge(roofGeo), m.cabinet);
  campusMesh.castShadow = campusPlant.castShadow = true;
  campusMesh.userData.owner = campusPlant.userData.owner = 'LD_NEW';
  campusGroup.add(campusMesh, campusPlant);
  group.add(campusGroup);
  pickables.push(campusMesh, campusPlant);
  bounds.set('LD_NEW', new THREE.Box3(new THREE.Vector3(cp.x0, 0, cp.z0), new THREE.Vector3(cp.x1, 36, cp.z1)));

  // --- industrial park ----------------------------------------------------------------------------
  {
    const ip = SITES.industrial;
    const g: Geo[] = [];
    const roofs: Geo[] = [];
    const sheds: [number, number, number, number, number][] = [[0.15, 0.2, 120, 70, 14], [0.55, 0.25, 90, 60, 12], [0.2, 0.7, 70, 90, 16], [0.62, 0.72, 110, 55, 11], [0.86, 0.45, 50, 80, 18]];
    for (const [fx, fz, w, d, h] of sheds) {
      const x = ip.x0 + fx * (ip.x1 - ip.x0);
      const z = ip.z0 + fz * (ip.z1 - ip.z0);
      const y = ground(x, z);
      g.push(block(w, h, d, x, z, y - 0.5));
      roofs.push(block(w + 1, 0.6, d + 1, x, z, y + h - 0.5));
    }
    const cx = ip.x0 + 0.35 * (ip.x1 - ip.x0);
    const cz = ip.z0 + 0.5 * (ip.z1 - ip.z0);
    g.push(post(2.2, 42, cx, cz, ground(cx, cz), 14));
    addMesh(merge(g), industryMat, 'LD_IND');
    addMesh(merge(roofs), roofMat, 'LD_IND');
  }

  // --- town at the horizon -------------------------------------------------------------------------
  // Gardens: the empty plots get a tree, so the town sits among trees like the countryside.
  const townTrees: THREE.Vector3[] = [];
  {
    const tn = SITES.town;
    const houses: Geo[] = [];
    const roofs: Geo[] = [];
    for (let x = tn.x0; x < tn.x1; x += 34) {
      for (let z = tn.z0; z < tn.z1; z += 30) {
        if (rng.next() < 0.22) { townTrees.push(new THREE.Vector3(x + (rng.next() - 0.5) * 16, 0, z + (rng.next() - 0.5) * 14)); continue; }
        const cxz = Math.hypot((x - (tn.x0 + tn.x1) / 2) / 1050, (z - (tn.z0 + tn.z1) / 2) / 400);
        if (cxz > 1 + rng.next() * 0.15) continue;
        const centre = cxz < 0.35;
        const w = centre ? 18 + rng.next() * 14 : 9 + rng.next() * 5;
        const d = centre ? 14 + rng.next() * 10 : 8 + rng.next() * 3;
        const h = centre ? 10 + rng.next() * 9 : 5.5 + rng.next() * 2;
        const jx = x + (rng.next() - 0.5) * 10;
        const jz = z + (rng.next() - 0.5) * 8;
        const y = ground(jx, jz) - 0.3;
        houses.push(block(w, h, d, jx, jz, y));
        const roof = new THREE.CylinderGeometry(0.01, d * 0.72, w, 4, 1);
        roof.rotateZ(Math.PI / 2);
        roof.rotateX(Math.PI / 4);
        roof.scale(1, 0.45, 1);
        roofs.push(at(roof, jx, y + h + d * 0.16, jz));
      }
    }
    const churchX = (tn.x0 + tn.x1) / 2 - 120;
    const churchZ = (tn.z0 + tn.z1) / 2;
    houses.push(block(14, 16, 34, churchX, churchZ, ground(churchX, churchZ)));
    roofs.push(at(new THREE.ConeGeometry(4, 26, 4), churchX, ground(churchX, churchZ) + 38, churchZ - 14));
    houses.push(block(7, 26, 7, churchX, churchZ - 14, ground(churchX, churchZ)));
    addMesh(merge(houses), townMat, 'LD_TOWN', false);
    addMesh(merge(roofs), roofMat, 'LD_TOWN', false);
    // Frame the town centre, not its whole spread: framed whole, the houses were specks 3 km away.
    const tcx = (tn.x0 + tn.x1) / 2, tcz = (tn.z0 + tn.z1) / 2, ty = ground(tcx, tcz);
    bounds.set('LD_TOWN', new THREE.Box3(new THREE.Vector3(tcx - 380, ty, tcz - 170), new THREE.Vector3(tcx + 380, ty + 24, tcz + 170)));
  }

  // --- the border ---------------------------------------------------------------------------------
  {
    const dashes: Geo[] = [];
    for (let i = 0; i < BORDER.length - 1; i++) {
      const [ax, az] = BORDER[i]!;
      const [bx, bz] = BORDER[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      const rot = -Math.atan2(bz - az, bx - ax);
      for (let s = 0; s < len; s += 90) {
        const t0 = s / len;
        const x = ax + (bx - ax) * (t0 + 25 / len);
        const z = az + (bz - az) * (t0 + 25 / len);
        dashes.push(at(box(50, 0.4, 4), x, ground(x, z) + 1.2, z, 0, rot, 0));
      }
    }
    const bm = new THREE.Mesh(merge(dashes), borderMat);
    bm.renderOrder = 4;
    group.add(bm);
    staticLabels.push({ text: 'Ireland', pos: new THREE.Vector3(-300, 80, -2350), minDistance: 1500 });
    staticLabels.push({ text: 'Northern Ireland', pos: new THREE.Vector3(-300, 80, -3250), minDistance: 1500 });
  }

  // --- hedgerows and trees along the field boundaries ------------------------------------------------
  {
    const field = 140;
    const R = 1900;
    const shrubs: THREE.Matrix4[] = [];
    const trees: THREE.Matrix4[] = [];
    const blocked = (x: number, z: number) => CLEAR.some((r) => inRect(r, x, z, 14)) || inRect(SITES.town, x, z, 30) || inLough(x, z, 1.25);
    const place = (x: number, z: number, isTree: boolean) => {
      const y = ground(x, z);
      const s = isTree ? 0.8 + rng.next() * 0.7 : 0.8 + rng.next() * 0.6;
      const m4 = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.next() * 6.28, 0)), new THREE.Vector3(s, s * (isTree ? 1 : 0.7 + rng.next() * 0.4), s));
      (isTree ? trees : shrubs).push(m4);
    };
    for (let gx = Math.floor((-55 - R) / field); gx <= Math.ceil((-55 + R) / field); gx++) {
      for (let gz = Math.floor(-R / field); gz <= Math.ceil(R / field); gz++) {
        for (const vertical of [true, false]) {
          if (rng.next() < 0.18) continue; // a missing hedge
          for (let s = 0; s < field; s += 6.5) {
            const x = vertical ? gx * field : gx * field + s;
            const z = vertical ? gz * field + s : gz * field;
            if (Math.hypot(x + 55, z) > R || blocked(x, z)) continue;
            if (rng.next() < 0.12) continue;
            place(x + (rng.next() - 0.5) * 1.4, z + (rng.next() - 0.5) * 1.4, false);
            if (rng.next() < 0.07) place(x + (rng.next() - 0.5) * 2, z + (rng.next() - 0.5) * 2, true);
          }
        }
      }
    }
    for (const t of townTrees) if (!inLough(t.x, t.z, 1.1)) place(t.x, t.z, true);
    const shrubGeo = new THREE.IcosahedronGeometry(2.2, 0);
    shrubGeo.translate(0, 1.4, 0);
    const shrubMesh = new THREE.InstancedMesh(shrubGeo, m.hedge, shrubs.length);
    shrubs.forEach((mm, i) => shrubMesh.setMatrixAt(i, mm));
    shrubMesh.castShadow = false;
    shrubMesh.receiveShadow = true;
    shrubMesh.userData.landscape = true;
    group.add(shrubMesh);
    const crown = new THREE.IcosahedronGeometry(4.6, 1);
    crown.scale(1, 0.85, 1);
    crown.translate(0, 9, 0);
    const treeGeo = merge([crown, at(cyl(0.35, 6, 6, 0.25), 0, 3, 0)]);
    const treeMesh = new THREE.InstancedMesh(treeGeo, m.hedge, trees.length);
    trees.forEach((mm, i) => treeMesh.setMatrixAt(i, mm));
    treeMesh.castShadow = true;
    treeMesh.userData.landscape = true;
    group.add(treeMesh);
  }

  // --- update ---------------------------------------------------------------------------------------
  const tmp = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const spin = new THREE.Matrix4();
  const led = new THREE.Color();
  const LED_OFF = new THREE.Color(0x000000), LED_HIGH = new THREE.Color(0x19d15a), LED_MID = new THREE.Color(0xffb020), LED_LOW = new THREE.Color(0xff3020);
  function update(state: SimState, dt: number, time: number): void {
    const C = state.C;
    // Wind turbines: rotor speed from the simulated wind (variable speed up to rated, feathered beyond cut-out).
    const w = C.WIND;
    const producing = w.mwNow > 0.5;
    const rpm = w.cutOut ? 0 : producing ? Math.min(11.5, 3 + (w.windSpeed / 12.5) * 8.5) : 0.6;
    const omega = (rpm * 2 * Math.PI) / 60;
    for (let i = 0; i < turbines.length; i++) {
      rotorAngle[i] = rotorAngle[i]! + omega * dt;
      tmp.copy(tMats[i]!).multiply(rot.makeTranslation(hubOffset.x, hubOffset.y, hubOffset.z)).multiply(spin.makeRotationX(rotorAngle[i]!));
      rotors.setMatrixAt(i, tmp);
    }
    rotors.instanceMatrix.needsUpdate = true;

    // Solar farm: rows rise in sequence when it is built.
    const target = C.SOLAR.installed ? 1 : 0;
    const prevSolar = solarProgress;
    solarProgress = solarProgress < 0 ? target : target > solarProgress ? Math.min(1, solarProgress + dt / 6) : target;
    if (solarProgress !== prevSolar) {
      let idx = 0;
      solarRows.forEach((row, r2) => {
        const k2 = THREE.MathUtils.clamp(solarProgress * solarRows.length - r2, 0, 1);
        for (const mm of row) {
          if (k2 <= 0) { panels.setMatrixAt(idx, zero); legs.setMatrixAt(idx, zero); }
          else {
            mm.decompose(v, q, sc);
            tmp.compose(v.clone().add(new THREE.Vector3(0, (1 - k2) * -3, 0)), q, new THREE.Vector3(1, k2, 1));
            panels.setMatrixAt(idx, tmp);
            legs.setMatrixAt(idx, tmp);
          }
          idx++;
        }
      });
      panels.instanceMatrix.needsUpdate = true;
      legs.instanceMatrix.needsUpdate = true;
      // The bounds were taken while the rows were folded away: recompute, or the farm stays culled.
      panels.computeBoundingSphere();
      legs.computeBoundingSphere();
    }

    // Battery: containers appear when built; status lights show state of charge and activity.
    const bTarget = C.BESS.installed ? 1 : 0;
    const prevB = batteryProgress;
    batteryProgress = batteryProgress < 0 ? bTarget : bTarget > batteryProgress ? Math.min(1, batteryProgress + dt / 4) : bTarget;
    if (batteryProgress !== prevB) {
      contMats.forEach((mm, i) => {
        const k2 = THREE.MathUtils.clamp(batteryProgress * contMats.length - i, 0, 1);
        containers.setMatrixAt(i, k2 <= 0 ? zero : tmp.copy(mm).multiply(rot.makeScale(1, k2, 1)));
      });
      containers.instanceMatrix.needsUpdate = true;
      containers.computeBoundingSphere();
    }
    batteryFixed.visible = C.BESS.installed;
    const soc = C.BESS.soc;
    const ledColour = !C.BESS.installed ? LED_OFF : soc > 60 ? LED_HIGH : soc > 25 ? LED_MID : LED_LOW;
    const active = Math.abs(C.BESS.mwNow) > 0.5;
    for (let i = 0; i < ledPos.length; i++) {
      const pulse = active ? 0.55 + 0.45 * Math.sin(time * 3 + i * 0.4) : 0.6;
      leds.setColorAt(i, led.copy(ledColour).multiplyScalar(pulse));
    }
    if (leds.instanceColor) leds.instanceColor.needsUpdate = true;

    // Gas peaker: present when built; plume only while running, scaled with output.
    gasGroup.visible = C.GAS.installed;
    const out = C.GAS.installed ? C.GAS.mwNow / C.GAS.cap : 0;
    for (let i = 0; i < plumeN; i++) {
      plumeAge[i] = (plumeAge[i]! + dt * 0.12) % 1;
      const a = plumeAge[i]!;
      if (out < 0.02) { plume.setMatrixAt(i, zero); continue; }
      const s = (1.6 + a * 8) * (0.5 + out * 0.5);
      tmp.compose(v.set(stackTop.x + a * 45 + Math.sin(i * 7.1) * 2, stackTop.y + a * 28, stackTop.z - a * 22 + Math.cos(i * 3.3) * 2), q.identity(), sc.set(s, s, s));
      plume.setMatrixAt(i, tmp);
    }
    plume.instanceMatrix.needsUpdate = true;
    plumeMat.opacity = 0.04 + 0.09 * Math.min(1, out * 1.5);

    // Campus appears when the new connection is built; lights follow supply.
    campusGroup.visible = C.LD_NEW.installed;
    campusLit.value = C.LD_NEW.live && C.LD_NEW.closed ? 1 : 0;
    // Town windows follow the regional demand actually supplied; industrial park its feeder.
    const setpoint = Math.max(1, C.LD_TOWN.mw);
    townLit.value = Math.max(0, Math.min(1, C.LD_TOWN.mwNow / setpoint));
    industryLit.value = C.LD_IND.live ? 1 : 0;
  }

  return { group, pickables, bounds, farAnchors, staticLabels, paths, update };
}
