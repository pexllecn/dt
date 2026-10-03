/** Procedural geometry kit for substation equipment. All dimensions in metres. */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Geo = THREE.BufferGeometry;

/** Merge geometries, dropping attributes that do not appear on all of them. */
/**
 * Level of detail. A geometry may carry a low-detail stand-in in `userData.far`; it is drawn when
 * the part is small on screen and in the shadow map. Transforms and merges carry it along.
 */
export const farOf = (g: Geo): Geo => (g.userData.far as Geo | undefined) ?? g;

/** A transformed copy, with its low-detail stand-in transformed the same way. */
export function transformed(g: Geo, m: THREE.Matrix4): Geo {
  const out = g.clone().applyMatrix4(m);
  // clone() shares userData by reference: give the copy its own.
  out.userData = g.userData.far ? { far: (g.userData.far as Geo).clone().applyMatrix4(m) } : {};
  return out;
}

export function merge(geos: Geo[]): Geo {
  const fars = geos.filter(Boolean).some((g) => g.userData.far) ? geos.filter(Boolean).map(farOf) : null;
  const clean = geos.filter(Boolean).map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((n.attributes.position!.count) * 2), 2));
    return n;
  });
  const m = mergeGeometries(clean, false);
  if (!m) throw new Error('merge failed');
  m.userData = fars ? { far: merge(fars) } : {};
  return m;
}

export function at(g: Geo, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1): Geo {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s),
  );
  return transformed(g, m);
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** Box standing on y = 0. */
export const block = (w: number, h: number, d: number, x = 0, z = 0, y0 = 0) => at(box(w, h, d), x, y0 + h / 2, z);
export const cyl = (r: number, h: number, seg = 16, rTop = r) => new THREE.CylinderGeometry(rTop, r, h, seg, 1);
/** Vertical cylinder standing on y0. */
export const post = (r: number, h: number, x = 0, z = 0, y0 = 0, seg = 16) => at(cyl(r, h, seg), x, y0 + h / 2, z);

/** Cylinder between two points. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8): Geo {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = cyl(r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  return g.applyMatrix4(m);
}

/** A tube following points (for flexible conductors). */
export function tube(points: THREE.Vector3[], r: number, seg = 6): Geo {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), r, seg, false);
}

/** Conductor between two terminals with a catenary-like sag. */
export function sagging(a: THREE.Vector3, b: THREE.Vector3, sag: number, r: number): Geo {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return tube(pts, r, 6);
}

/**
 * Shedded insulator standing on y = 0, by lathe. Alternating large and small sheds as on
 * modern long-creepage designs, with metal end fittings returned separately.
 */
export function insulator(length: number, coreR: number, shedR: number, sheds: number, seg = 18): { body: Geo; fittings: Geo } {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(coreR, 0)];
  const usable = length * 0.9;
  const y0 = length * 0.05;
  const pitch = usable / sheds;
  pts.push(new THREE.Vector2(coreR, y0));
  for (let i = 0; i < sheds; i++) {
    const yb = y0 + i * pitch;
    const R = i % 2 === 0 ? shedR : coreR + (shedR - coreR) * 0.72;
    pts.push(new THREE.Vector2(coreR, yb + pitch * 0.12));
    pts.push(new THREE.Vector2(R * 0.97, yb + pitch * 0.2));
    pts.push(new THREE.Vector2(R, yb + pitch * 0.26));
    pts.push(new THREE.Vector2(R * 0.9, yb + pitch * 0.34));
    pts.push(new THREE.Vector2(coreR * 1.04, yb + pitch * 0.62));
  }
  pts.push(new THREE.Vector2(coreR, length - length * 0.05));
  pts.push(new THREE.Vector2(coreR, length));
  pts.push(new THREE.Vector2(0, length));
  const body = new THREE.LatheGeometry(pts, seg);
  // Low detail: a third of the facets and three profile points per shed instead of five. The
  // silhouette and the rib rhythm are the same at the sizes it is drawn.
  const low: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(coreR, 0), new THREE.Vector2(coreR, y0)];
  for (let i = 0; i < sheds; i++) {
    const yb = y0 + i * pitch;
    const R = i % 2 === 0 ? shedR : coreR + (shedR - coreR) * 0.72;
    low.push(new THREE.Vector2(coreR, yb + pitch * 0.12), new THREE.Vector2(R, yb + pitch * 0.26), new THREE.Vector2(coreR * 1.04, yb + pitch * 0.62));
  }
  low.push(new THREE.Vector2(coreR, length - length * 0.05), new THREE.Vector2(coreR, length), new THREE.Vector2(0, length));
  body.userData.far = new THREE.LatheGeometry(low, 6);
  const capH = Math.max(0.12, length * 0.05);
  const caps = (s: number) => merge([post(coreR * 1.5, capH, 0, 0, -capH * 0.2, s), post(coreR * 1.5, capH, 0, 0, length - capH * 0.8, s)]);
  const fittings = caps(seg);
  fittings.userData.far = caps(6);
  return { body, fittings };
}

/**
 * Lattice column standing on y = 0: four angle legs with zig-zag bracing. Square section w.
 */
export function latticeColumn(h: number, wBase: number, wTop: number, bay = 1.6): Geo {
  const parts: Geo[] = [];
  const leg = 0.09;
  const corner = (sx: number, sz: number, y: number) => {
    const w = wBase + (wTop - wBase) * (y / h);
    return new THREE.Vector3((sx * w) / 2, y, (sz * w) / 2);
  };
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) parts.push(rod(corner(sx, sz, 0), corner(sx, sz, h), leg, 4));
  const n = Math.max(2, Math.round(h / bay));
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * h;
    const y1 = ((i + 1) / n) * h;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k]!;
      const [bx, bz] = corners[(k + 1) % 4]!;
      const a0 = corner(ax, az, i % 2 ? y0 : y1);
      const b1 = corner(bx, bz, i % 2 ? y1 : y0);
      parts.push(rod(a0, b1, 0.035, 4));
      parts.push(rod(corner(ax, az, y1), corner(bx, bz, y1), 0.04, 4));
    }
  }
  parts.push(block(wBase + 0.5, 0.3, wBase + 0.5));
  return merge(parts);
}

/** Lattice beam along z, centred, at height y, of length L. */
export function latticeBeam(L: number, depth: number, y: number): Geo {
  const parts: Geo[] = [];
  const hw = depth / 2;
  const chords: [number, number][] = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (const [x, dy] of chords) parts.push(rod(new THREE.Vector3(x, y + dy, -L / 2), new THREE.Vector3(x, y + dy, L / 2), 0.07, 4));
  const n = Math.max(2, Math.round(L / 1.5));
  for (let i = 0; i < n; i++) {
    const z0 = -L / 2 + (i / n) * L;
    const z1 = -L / 2 + ((i + 1) / n) * L;
    for (const [x, dy] of [[-hw, -hw], [hw, -hw]] as [number, number][]) parts.push(rod(new THREE.Vector3(x, y + dy, z0), new THREE.Vector3(x, y - dy, z1), 0.03, 4));
    parts.push(rod(new THREE.Vector3(-hw, y - hw, z1), new THREE.Vector3(hw, y + hw, z1), 0.03, 4));
  }
  return merge(parts);
}

/** Steel support column for one item of equipment: H-section with base plate, height h. */
export function supportColumn(h: number, w = 0.32): Geo {
  return merge([
    block(w, h, 0.08, 0, -w / 2 + 0.04),
    block(w, h, 0.08, 0, w / 2 - 0.04),
    block(0.06, h, w, 0, 0),
    block(w + 0.3, 0.05, w + 0.3, 0, 0, h - 0.05),
    block(w + 0.4, 0.04, w + 0.4),
  ]);
}

/** Concrete plinth under a support. */
export const plinth = (w: number) => block(w, 0.35, w, 0, 0, -0.05);
