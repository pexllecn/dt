/**
 * The Flow lens: conductors glow by voltage and loading, particles travel along them in the
 * direction of power flow at a speed proportional to MW, structures turn to glass, and the
 * transformer tanks show thermography from the thermal model.
 */
import * as THREE from 'three/webgpu';
import { abs, clamp, color, exp, float, instanceColor, mix, normalLocal, positionLocal, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import type { SimState, TransformerId } from '../sim/types.ts';
import { ambientAt } from '../sim/thermal/iec60076.ts';
import { bayFlow, particleVelocity } from './flowmap.ts';
import type { Voltage } from './layout.ts';
import { TRANSFORMERS } from './layout.ts';
import type { FlowPath } from './station.ts';

type F = THREE.UniformNode<'float', number>;
const u = (v: number) => uniform(v) as unknown as F;

export const VOLTAGE_COLOUR: Record<Voltage, number> = { 400: 0xff5a36, 275: 0xb07cff, 220: 0xffb02e, 110: 0x38c6ff };

interface KeyState { key: string; voltage: Voltage; glow: F; live: F; offset: number; velocity: number }
interface PathRun { path: FlowPath; key: KeyState; cum: number[]; d0: number; spacing: number; first: number; count: number }

/** Ironbow palette for thermography, t in 0..1. */
function ironbow(t: THREE.Node<'float'>) {
  const c0 = color(0x0b0630), c1 = color(0x5a0a8a), c2 = color(0xc8204a), c3 = color(0xf26a12), c4 = color(0xffd23c), c5 = color(0xfffbe0);
  let c = mix(c0, c1, smoothstep(0.0, 0.2, t));
  c = mix(c, c2, smoothstep(0.2, 0.42, t));
  c = mix(c, c3, smoothstep(0.42, 0.62, t));
  c = mix(c, c4, smoothstep(0.62, 0.82, t));
  c = mix(c, c5, smoothstep(0.82, 1.0, t));
  return c;
}

export const THERMO_RANGE: [number, number] = [10, 120];

export class FlowLayer {
  readonly group = new THREE.Group();
  readonly keys = new Map<string, KeyState>();
  readonly runs: PathRun[] = [];
  /** Shared widening of conductors and particles with viewing distance (metres). */
  private widen = u(0);
  readonly particles: THREE.InstancedMesh;
  private particleSize = 0.3;
  private viewScale = 1;
  readonly thermo = new Map<TransformerId, { material: THREE.MeshStandardNodeMaterial; top: F; bottom: F; hot: F; y0: F; y1: F }>();
  private ghostDay: THREE.MeshBasicNodeMaterial;
  private ghostNight: THREE.MeshBasicNodeMaterial;
  private swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; cast: boolean }[] = [];
  active = false;

  constructor(paths: FlowPath[]) {
    this.group.name = 'flow';
    this.group.visible = false;
    // Group paths by key, then chain them so particles flow continuously across joins.
    const byKey = new Map<string, FlowPath[]>();
    for (const p of paths) { const l = byKey.get(p.key) ?? []; l.push(p); byKey.set(p.key, l); }
    let total = 0;
    for (const [key, list] of byKey) {
      const voltage = this.voltageOf(key);
      const ks: KeyState = { key, voltage, glow: u(0), live: u(0), offset: 0, velocity: 0 };
      this.keys.set(key, ks);
      const d0 = list.map(() => 0);
      // Relax: a path starting where another ends continues its arc length.
      for (let iter = 0; iter < 40; iter++) {
        let changed = false;
        list.forEach((p, i) => {
          for (let j = 0; j < list.length; j++) {
            if (i === j) continue;
            const q = list[j]!;
            if (q.pts[q.pts.length - 1]!.distanceTo(p.pts[0]!) < 0.6) {
              const v = d0[j]! + q.length;
              if (v > d0[i]! + 1e-6) { d0[i] = v; changed = true; }
            }
          }
        });
        if (!changed) break;
      }
      // Tube per key.
      const geos: THREE.BufferGeometry[] = [];
      list.forEach((p, i) => {
        const cum = [0];
        for (let k = 1; k < p.pts.length; k++) cum.push(cum[k - 1]! + p.pts[k]!.distanceTo(p.pts[k - 1]!));
        const len = cum[cum.length - 1]!;
        const spacing = len > 120 ? 70 : 6;
        const count = Math.max(1, Math.ceil(len / spacing) + 1);
        this.runs.push({ path: p, key: ks, cum, d0: d0[i]!, spacing, first: total, count });
        total += count;
        const curve = new THREE.CatmullRomCurve3(p.pts);
        geos.push(new THREE.TubeGeometry(curve, Math.max(4, p.pts.length * 2), 0.09, 5, false));
      });
      const geo = mergeAll(geos);
      const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
      const vc = color(VOLTAGE_COLOUR[ks.voltage]);
      mat.colorNode = mix(color(0x2a3038), color(0x000000), ks.live);
      mat.emissiveNode = vc.mul(ks.live.mul(ks.glow.mul(2.2).add(0.35)));
      mat.positionNode = positionLocal.add(normalLocal.mul(this.widen));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.flowKey = key;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    // Particles: a bright head with a short tail behind it, pointing along the flow.
    const head = new THREE.SphereGeometry(1, 10, 6);
    const tail = new THREE.ConeGeometry(0.85, 3.4, 8, 1, true);
    tail.rotateZ(Math.PI / 2); // tip towards -x
    tail.translate(-1.7, 0, 0);
    const pg = mergeAll([head, tail]);
    const pm = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    pm.colorNode = color(0x000000);
    pm.emissiveNode = vec3(instanceColor).mul(3.2);
    this.particles = new THREE.InstancedMesh(pg, pm, Math.max(1, total));
    this.particles.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < total; i++) { this.particles.setMatrixAt(i, zero); this.particles.setColorAt(i, new THREE.Color(0xffffff)); }
    this.group.add(this.particles);

    this.ghostDay = new THREE.MeshBasicNodeMaterial({ color: 0x6f7c88, transparent: true, opacity: 0.16, depthWrite: false });
    this.ghostNight = new THREE.MeshBasicNodeMaterial({ color: 0x9fb8cf, transparent: true, opacity: 0.1, depthWrite: false });

    for (const t of TRANSFORMERS) {
      const top = u(60), bottom = u(35), hot = u(75), y0 = u(0), y1 = u(5);
      const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
      const h = clamp(positionWorld.y.sub(y0).div(y1.sub(y0)), 0, 1);
      // Oil stratifies: bottom oil at the base rising to top oil; the winding hot spot near the top centre.
      const r = vec3(positionWorld.x.sub(t.x), 0, positionWorld.z.sub(t.z)).length();
      const spot = exp(r.mul(r).div(-9).sub(abs(h.sub(0.8)).mul(4))).mul(hot.sub(top)).mul(0.8);
      const temp = mix(bottom, top, smoothstep(0.0, 0.95, h)).add(spot);
      const tn = clamp(temp.sub(THERMO_RANGE[0]).div(THERMO_RANGE[1] - THERMO_RANGE[0]), 0, 1);
      mat.colorNode = color(0x000000);
      mat.emissiveNode = ironbow(tn).mul(float(0.9));
      this.thermo.set(t.id, { material: mat, top, bottom, hot, y0, y1 });
    }
  }

  private voltageOf(key: string): Voltage {
    if (key.startsWith('L400') || key.endsWith('-HV')) return 400;
    if (key === 'T4-275') return 275;
    if (key === 'T3-110' || key === 'LD_IND' || key === 'TIE_S') return 110;
    return 220;
  }

  /** Swap the given scene groups to glass (or back), and the transformer tanks to thermography. */
  setActive(on: boolean, roots: THREE.Object3D[], night: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.group.visible = on;
    if (!on) {
      for (const s of this.swapped) { s.mesh.material = s.material; s.mesh.castShadow = s.cast; }
      this.swapped = [];
      return;
    }
    const ghost = night ? this.ghostNight : this.ghostDay;
    for (const root of roots) root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || o.userData.landscape || o.parent === this.group) return;
      this.swapped.push({ mesh, material: mesh.material, cast: mesh.castShadow });
      const owner = o.userData.owner as TransformerId | undefined;
      const th = owner ? this.thermo.get(owner) : undefined;
      if (th && o.userData.matKey === 'tankPaint') {
        mesh.geometry.computeBoundingBox();
        const b = mesh.geometry.boundingBox!;
        th.y0.value = b.min.y + 0.4;
        th.y1.value = b.max.y;
        mesh.material = th.material;
      } else {
        mesh.material = ghost;
        mesh.castShadow = false;
      }
    });
  }

  /** Conductors and particles stay a few pixels wide at any distance. */
  setViewDistance(dist: number): void {
    this.widen.value = Math.max(0, dist * 0.0011 - 0.09);
    this.particleSize = Math.max(0.28, dist * 0.0017);
    this.viewScale = THREE.MathUtils.clamp(dist / 220, 1, 30);
  }

  /** Advance particles and update glow from the state. Runs whether or not the lens is visible, so tests can drive it. */
  update(state: SimState, dt: number): void {
    for (const ks of this.keys.values()) {
      const f = bayFlow(ks.key, state);
      const mw = f ? f.mw : 0;
      ks.live.value = f && f.live ? 1 : 0;
      ks.glow.value = f ? Math.min(1, Math.abs(mw) / f.scale) : 0;
      ks.velocity = f && f.live ? particleVelocity(mw, this.viewScale) : 0;
      ks.offset += ks.velocity * dt;
    }
    for (const [id, th] of this.thermo) {
      const c = state.C[id];
      const amb = ambientAt(state.t % 86400);
      th.top.value = c.topOil;
      th.hot.value = c.temp;
      th.bottom.value = amb + (c.topOil - amb) * 0.45;
    }
    if (!this.active) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const X = new THREE.Vector3(1, 0, 0);
    const col = new THREE.Color();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const size = this.particleSize;
    for (const run of this.runs) {
      const ks = run.key;
      const L = run.cum[run.cum.length - 1]!;
      const moving = ks.velocity !== 0;
      col.set(VOLTAGE_COLOUR[ks.voltage]).lerp(new THREE.Color(0xffffff), 0.35);
      const period = run.count * run.spacing;
      for (let i = 0; i < run.count; i++) {
        const idx = run.first + i;
        if (!moving) { this.particles.setMatrixAt(idx, zero); continue; }
        const along = mod(ks.offset - run.d0 + i * run.spacing, period);
        if (along > L) { this.particles.setMatrixAt(idx, zero); continue; }
        pointAt(run, along, pos, tan);
        if (ks.velocity < 0) tan.negate();
        q.setFromUnitVectors(X, tan);
        const s = size * (0.75 + 0.5 * Math.min(1, ks.glow.value * 1.4));
        m.compose(pos, q, sc.set(s, s, s));
        this.particles.setMatrixAt(idx, m);
        this.particles.setColorAt(idx, col);
      }
    }
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  /** Signed particle velocity on a key (m/s), for tests and labels. */
  velocityOf(key: string): number {
    return this.keys.get(key)?.velocity ?? 0;
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function pointAt(run: PathRun, along: number, out: THREE.Vector3, tangent: THREE.Vector3): void {
  const { cum, path } = run;
  let k = 1;
  while (k < cum.length - 1 && cum[k]! < along) k++;
  const a = path.pts[k - 1]!;
  const b = path.pts[k]!;
  const seg = Math.max(1e-6, cum[k]! - cum[k - 1]!);
  out.lerpVectors(a, b, THREE.MathUtils.clamp((along - cum[k - 1]!) / seg, 0, 1));
  tangent.subVectors(b, a).normalize();
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Non-indexed merge of position and normal only (enough for emissive lines and particles).
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position!.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    nor.set(g.attributes.normal!.array as Float32Array, o * 3);
    o += g.attributes.position!.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

