/** Site: ground, gravel yard, roads, trenches, palisade fence, masts and the control building. */
import * as THREE from 'three/webgpu';
import { at, block, box, latticeColumn, merge, post, rod, type Geo } from './geometry.ts';
import { CONTROL_BUILDING, FENCE } from './layout.ts';
import type { Materials } from './materials.ts';
import type { MatKey } from './equipment.ts';

/** Deterministic value noise for terrain (CPU side). */
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Terrain height: flat at the station, drumlin-like rolling ground beyond. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x + 55, z);
  const ramp = Math.min(1, Math.max(0, (r - 420) / 900));
  // Drumlins: elongated hills aligned north-west to south-east.
  const ax = (x * 0.8 + z * 0.6) / 520;
  const az = (-x * 0.6 + z * 0.8) / 260;
  let h = 0;
  let amp = 1;
  let f = 1;
  for (let o = 0; o < 4; o++) { h += vnoise(ax * f, az * f) * amp; amp *= 0.5; f *= 2.1; }
  return ramp * (h - 0.6) * 55 + ramp * ramp * 20;
}

export interface Yard {
  group: THREE.Group;
  pickables: THREE.Object3D[];
}

export function buildYard(m: Materials): Yard {
  const group = new THREE.Group();
  group.name = 'yard';
  const pickables: THREE.Object3D[] = [];
  const byMat = new Map<MatKey, Geo[]>();
  const add = (mat: MatKey, g: Geo) => { const l = byMat.get(mat) ?? []; l.push(g); byMat.set(mat, l); };
  const [x0, z0, x1, z1] = FENCE;

  // Terrain.
  const size = 9000;
  const seg = 220;
  const ground = new THREE.PlaneGeometry(size, size, seg, seg);
  ground.rotateX(-Math.PI / 2);
  const pos = ground.attributes.position!;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)) - 0.05);
  ground.computeVertexNormals();
  const terrain = new THREE.Mesh(ground, m.grass);
  terrain.receiveShadow = true;
  group.add(terrain);

  // Gravel yard inside the fence, on a slight plinth.
  add('gravel', block(x1 - x0, 0.12, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2, -0.06));
  // Ring road and cross roads.
  const road = (ax: number, az: number, bx: number, bz: number, w: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    add('asphalt', at(box(len, 0.08, w), (ax + bx) / 2, 0.06, (az + bz) / 2, 0, -Math.atan2(bz - az, bx - ax), 0));
  };
  const inset = 7;
  road(x0 + inset, z0 + inset, x1 - inset, z0 + inset, 5);
  road(x0 + inset, z1 - inset, x1 - inset, z1 - inset, 5);
  road(x0 + inset, z0 + inset, x0 + inset, z1 - inset, 5);
  road(x1 - inset, z0 + inset, x1 - inset, z1 - inset, 5);
  road(-112, z0 + inset, -112, z1 - inset, 4.5);
  road(46, z0 + inset, 46, z1 - inset, 4.5);
  // Access road from the east gate.
  road(x1 - inset, -20, 400, -20, 6);
  // Cable trenches with covers.
  const trench = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const rotY = -Math.atan2(bz - az, bx - ax);
    add('concrete', at(box(len, 0.16, 1.1), (ax + bx) / 2, 0.08, (az + bz) / 2, 0, rotY, 0));
    for (let s = 0; s < len; s += 1.2) {
      const t = s / len;
      add('concrete', at(box(0.04, 0.02, 1.0), ax + (bx - ax) * t, 0.17, az + (bz - az) * t, 0, rotY, 0));
    }
  };
  trench(4, -122, 4, 70);
  trench(4, -40, 45, -40);
  trench(-112, -70, -112, 60);
  trench(102, 90, 102, 130);

  // Control building: clad walls, flat roof with parapet, a window band, plant on the roof.
  {
    const b = CONTROL_BUILDING;
    add('concrete', block(b.w + 1.2, 0.3, b.d + 1.2, b.x, b.z, 0));
    add('cladding', block(b.w, b.h, b.d, b.x, b.z, 0.3));
    add('roof', block(b.w + 0.4, 0.5, b.d + 0.4, b.x, b.z, b.h + 0.3));
    add('roof', block(b.w + 0.6, 0.7, 0.2, b.x, b.z - b.d / 2 - 0.2, b.h + 0.3));
    add('roof', block(b.w + 0.6, 0.7, 0.2, b.x, b.z + b.d / 2 + 0.2, b.h + 0.3));
    for (let i = 0; i < 9; i++) {
      const wx = b.x - b.w / 2 + 2.4 + i * ((b.w - 4.8) / 8);
      add('glass', block(2.2, 1.4, 0.06, wx, b.z + b.d / 2 + 0.02, 2.4));
      add('glass', block(2.2, 1.4, 0.06, wx, b.z - b.d / 2 - 0.02, 2.4));
    }
    add('glass', block(1.8, 2.4, 0.06, b.x - b.w / 2 + 3, b.z + b.d / 2 + 0.03, 0.3));
    add('cabinet', block(3, 1.4, 2, b.x + 8, b.z, b.h + 0.8));
    add('cabinet', block(2, 1.1, 2, b.x - 6, b.z, b.h + 0.8));
    // Relay room near the 400 kV yard.
    add('concrete', block(15, 0.3, 9, -190, 110, 0));
    add('cladding', block(14, 4.5, 8, -190, 110, 0.3));
    add('roof', block(14.4, 0.4, 8.4, -190, 110, 4.8));
    for (let i = 0; i < 4; i++) add('glass', block(1.6, 1.1, 0.05, -195 + i * 3.3, 114.03, 1.9));
  }

  // Lighting and lightning-shielding masts.
  const masts: [number, number][] = [[-200, -100], [-200, 70], [-120, -120], [-120, 125], [-55, -10], [10, -130], [10, 85], [95, 70], [-150, 0], [-60, 70]];
  for (const [x, z] of masts) {
    add('galvanised', latticeColumn(26, 1.2, 0.5, 1.8).applyMatrix4(new THREE.Matrix4().makeTranslation(x, 0, z)));
    add('galvanised', post(0.06, 4, x, z, 26, 6));
    add('cabinet', block(1.2, 0.35, 0.6, x, z, 25.2));
  }

  // Palisade fence: instanced pales, plus rails and posts.
  const pale = merge([block(0.065, 2.4, 0.02), at(new THREE.ConeGeometry(0.05, 0.16, 3), 0, 2.48, 0)]);
  const sides: [number, number, number, number][] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  const mats: THREE.Matrix4[] = [];
  for (const [ax, az, bx, bz] of sides) {
    const len = Math.hypot(bx - ax, bz - az);
    const rotY = -Math.atan2(bz - az, bx - ax);
    for (let s = 0; s < len; s += 0.16) {
      const t = s / len;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (ax === x1 && bx === x1 && Math.abs(z + 20) < 5) continue; // gate opening
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(1, 1, 1)));
    }
    for (const y of [0.4, 2.1]) add('galvanised', rod(new THREE.Vector3(ax, y, az), new THREE.Vector3(bx, y, bz), 0.03, 4));
    for (let s = 0; s <= len; s += 2.75) {
      const t = s / len;
      add('galvanised', block(0.1, 2.5, 0.1, ax + (bx - ax) * t, az + (bz - az) * t, 0));
    }
  }
  const fence = new THREE.InstancedMesh(pale, m.galvanised, mats.length);
  mats.forEach((mm, i) => fence.setMatrixAt(i, mm));
  fence.castShadow = true;
  group.add(fence);

  for (const [mat, geos] of byMat) {
    const mesh = new THREE.Mesh(merge(geos), m[mat]);
    mesh.receiveShadow = true;
    mesh.castShadow = mat !== 'gravel' && mat !== 'asphalt';
    group.add(mesh);
  }
  void box;
  return { group, pickables };
}
