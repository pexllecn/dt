import {
  BufferAttribute,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type PerspectiveCamera,
} from 'three/webgpu';
import { Fn, attribute, float, length, mix, positionWorld, cameraPosition, smoothstep, varyingProperty, vec3, vec4 } from 'three/tsl';
import { itmToScene, sceneToItm } from '@/lib/geo';
import { blowoutAngle, conductorTemperature, sagAt } from '@/sim/thermal';
import { siteSpeed, type WindScenario } from '@/sim/wind';
import type { ModelMeta } from '@/sim/protocol';
import {
  TURBINE_HUB,
  latticeTower,
  polesetAttachments,
  towerAttachments,
  towerSpecs,
  turbineRotor,
  turbineTower,
  woodPoleset,
  type TowerSpec,
} from './geometry';
import { world } from '../world/uniforms';
import { segmentClip } from '../network/NetworkLayer';
import { frameStats } from '@/app/store';
import type { N } from '@/lib/tsl';

type SupportKind = 'l400' | 'l220' | 'l110' | 'pole';

interface Support {
  x: number;
  z: number;
  kind: SupportKind;
  branch: number; // index in meta.branches
  yaw: number;
}

interface Span {
  a: Support;
  b: Support;
  branch: number;
  kv: number;
  length: number;
}

const CHUNK = 10_000;
const key = (cx: number, cz: number) => `${cx},${cz}`;
const INSULATOR = 3.2;

function specFor(kind: SupportKind): TowerSpec | null {
  return kind === 'l400' ? towerSpecs['400'] : kind === 'l220' ? towerSpecs['220'] : kind === 'l110' ? towerSpecs['110'] : null;
}

function attachments(kind: SupportKind): Vector3[] {
  const spec = specFor(kind);
  return spec ? towerAttachments(spec, INSULATOR) : polesetAttachments;
}

function earthWire(kind: SupportKind): Vector3 | null {
  const spec = specFor(kind);
  return spec ? new Vector3(0, spec.height, 0) : null;
}

export interface AssetFrame {
  hours: number;
  dt: number;
  loading: Float32Array;
  wind: WindScenario;
  ambientC: number;
}

/**
 * Regional and site-scale assets: lattice towers and wood polesets at their OSM positions,
 * conductors as catenaries between them (sag from conductor temperature, swing from the wind),
 * and wind turbines whose rotors turn at the speed the simulated wind gives them.
 */
export class AssetLayer {
  readonly group = new Group();
  private readonly supports: Support[] = [];
  private readonly spans: Span[] = [];
  private readonly supportChunks = new Map<string, number[]>();
  private readonly spanChunks = new Map<string, number[]>();
  private readonly turbines: { x: number; z: number; e: number; n: number; angle: number }[] = [];
  private readonly turbineChunks = new Map<string, number[]>();
  private readonly towerMeshes: Record<string, InstancedMesh> = {};
  private readonly turbineTowerMesh: InstancedMesh;
  private readonly rotorMesh: InstancedMesh;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly cond: {
    geo: InstancedBufferGeometry;
    a: InstancedBufferAttribute;
    b: InstancedBufferAttribute;
    s: InstancedBufferAttribute;
    c: InstancedBufferAttribute;
  };
  private readonly maxCond = 12_000;
  private timer = 0;
  private readonly tmpM = new Matrix4();
  private readonly tmpQ = new Quaternion();
  private readonly tmpS = new Vector3(1, 1, 1);
  private readonly tmpP = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  /** Visual multiplier on sag; 1 = true scale. Shown on screen whenever it is not 1. */
  sagExaggeration = 1;

  constructor(
    meta: ModelMeta,
    supportIndex: Record<string, [number, number]>,
    supportData: Float32Array,
    turbineData: Float32Array,
    heightAt: (x: number, z: number) => number,
  ) {
    this.heightAt = heightAt;
    const branchIdx = new Map(meta.branches.map((b, i) => [b.id, i]));
    for (const [id, [start, count]] of Object.entries(supportIndex)) {
      const bi = branchIdx.get(id);
      if (bi === undefined) continue;
      const kv = meta.branches[bi]!.kv;
      const first = this.supports.length;
      for (let i = 0; i < count; i++) {
        const o = (start + i) * 3;
        const [x, z] = itmToScene(supportData[o]!, supportData[o + 1]!);
        const t = supportData[o + 2]!;
        const kind: SupportKind = t === 2 ? 'pole' : kv >= 300 ? 'l400' : kv >= 200 ? 'l220' : 'l110';
        this.supports.push({ x, z, kind, branch: bi, yaw: 0 });
      }
      // Orientation: crossarms perpendicular to the bisector of adjacent spans.
      for (let i = first; i < this.supports.length; i++) {
        const p = this.supports[Math.max(first, i - 1)]!;
        const n = this.supports[Math.min(this.supports.length - 1, i + 1)]!;
        this.supports[i]!.yaw = Math.atan2(-(n.z - p.z), n.x - p.x);
        if (i > first) {
          const a = this.supports[i - 1]!;
          const b = this.supports[i]!;
          this.spans.push({ a, b, branch: bi, kv, length: Math.hypot(b.x - a.x, b.z - a.z) });
        }
      }
    }
    this.supports.forEach((s, i) => {
      const k = key(Math.floor(s.x / CHUNK), Math.floor(s.z / CHUNK));
      (this.supportChunks.get(k) ?? this.supportChunks.set(k, []).get(k)!).push(i);
    });
    this.spans.forEach((s, i) => {
      const k = key(Math.floor((s.a.x + s.b.x) / 2 / CHUNK), Math.floor((s.a.z + s.b.z) / 2 / CHUNK));
      (this.spanChunks.get(k) ?? this.spanChunks.set(k, []).get(k)!).push(i);
    });
    for (let i = 0; i < turbineData.length; i += 2) {
      const [x, z] = itmToScene(turbineData[i]!, turbineData[i + 1]!);
      this.turbines.push({ x, z, e: turbineData[i]!, n: turbineData[i + 1]!, angle: (i * 0.618) % (Math.PI * 2) });
    }
    this.turbines.forEach((t, i) => {
      const k = key(Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK));
      (this.turbineChunks.get(k) ?? this.turbineChunks.set(k, []).get(k)!).push(i);
    });

    const steel = this.fadeMaterial('#9ba1a6', 0.75, 0.48);
    const wood = this.fadeMaterial('#6d5b48', 0, 0.86);
    const composite = this.fadeMaterial('#eceeed', 0.02, 0.42);
    const mk = (g: BufferGeometry, m: MeshStandardNodeMaterial, n: number, name: string) => {
      const mesh = new InstancedMesh(g, m, n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = name;
      this.group.add(mesh);
      return mesh;
    };
    this.towerMeshes.l400 = mk(latticeTower(towerSpecs['400'], 0), steel, 1500, 'towers-400');
    this.towerMeshes.l220 = mk(latticeTower(towerSpecs['220'], 0), steel, 3000, 'towers-220');
    this.towerMeshes.l110 = mk(latticeTower(towerSpecs['110'], 0), steel, 3000, 'towers-110');
    this.towerMeshes.pole = mk(woodPoleset(), wood, 4000, 'polesets');
    this.turbineTowerMesh = mk(turbineTower(), composite, 4000, 'turbine-towers');
    this.rotorMesh = mk(turbineRotor(), composite, 4000, 'turbine-rotors');

    this.cond = this.buildConductors();
  }

  /** PBR material that dissolves (dithered) with distance so assets never pop in. */
  private fadeMaterial(hex: string, metalness: number, roughness: number): MeshStandardNodeMaterial {
    const m = new MeshStandardNodeMaterial();
    m.color = new Color(hex);
    m.metalness = metalness;
    m.roughness = roughness;
    m.alphaHash = true;
    const d = length(positionWorld.sub(cameraPosition));
    const far = world.altitude.mul(2.2).add(4000).min(30_000);
    m.opacityNode = float(1).sub(smoothstep(far.mul(0.7), far, d));
    return m;
  }

  private buildConductors() {
    const SEG = 20;
    const corner: number[] = [];
    const index: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const t0 = i / SEG;
      const t1 = (i + 1) / SEG;
      const base = corner.length / 3;
      corner.push(t0, t1, 0, t0, t1, 1, t0, t1, 2, t0, t1, 3);
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const g = new InstancedBufferGeometry();
    g.setAttribute('seg', new BufferAttribute(new Float32Array(corner), 3));
    g.setAttribute('position', new BufferAttribute(new Float32Array(corner.length), 3));
    g.setIndex(index);
    const a = new InstancedBufferAttribute(new Float32Array(this.maxCond * 4), 4);
    const b = new InstancedBufferAttribute(new Float32Array(this.maxCond * 4), 4);
    const s = new InstancedBufferAttribute(new Float32Array(this.maxCond * 4), 4);
    const c = new InstancedBufferAttribute(new Float32Array(this.maxCond * 4), 4);
    for (const at of [a, b, s, c]) at.setUsage(35048);
    g.setAttribute('cA', a);
    g.setAttribute('cB', b);
    g.setAttribute('cS', s); // sag (m), blow-out angle (rad), lateral x, lateral z
    g.setAttribute('cC', c); // colour rgb, width px
    g.instanceCount = 0;

    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    const seg = attribute('seg', 'vec3');
    const cA = attribute('cA', 'vec4');
    const cB = attribute('cB', 'vec4');
    const cS = attribute('cS', 'vec4');
    const cC = attribute('cC', 'vec4');
    const vCol = varyingProperty('vec3', 'vCondCol');
    const vSide = varyingProperty('float', 'vCondSide');
    mat.vertexNode = Fn(() => {
      const point = (t: N<'float'>) => {
        const straight = mix(cA.xyz, cB.xyz, t);
        const drop = cS.x.mul(t.mul(4).mul(float(1).sub(t)));
        const vert = drop.mul(cS.y.cos());
        const lat = drop.mul(cS.y.sin());
        return straight.add(vec3(cS.z.mul(lat), vert.negate(), cS.w.mul(lat)));
      };
      const end = seg.z.greaterThan(1.5).select(float(1), float(0));
      const side = seg.z.mod(2).mul(2).sub(1);
      vCol.assign(cC.xyz);
      vSide.assign(side);
      return segmentClip(point(seg.x), point(seg.y), end, side, cC.w.mul(0.5));
    })();
    mat.colorNode = vec4(vCol, 1);
    mat.opacityNode = float(1).sub(smoothstep(0.55, 1, vSide.abs())).mul(0.9);
    mat.fog = true;
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 22;
    mesh.name = 'conductors';
    this.group.add(mesh);
    return { geo: g, a, b, s, c };
  }

  private chunksAround(map: Map<string, number[]>, x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const cx0 = Math.floor((x - r) / CHUNK);
    const cx1 = Math.floor((x + r) / CHUNK);
    const cz0 = Math.floor((z - r) / CHUNK);
    const cz1 = Math.floor((z + r) / CHUNK);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const list = map.get(key(cx, cz));
      if (list) for (const i of list) out.push(i);
    }
    return out;
  }

  update(camera: PerspectiveCamera, frame: AssetFrame): void {
    const alt = Math.max(1, camera.position.y);
    const ex = world.exaggeration.value;
    const cx = camera.position.x;
    const cz = camera.position.z;
    // Rotors turn every frame; placement is refreshed a few times a second.
    this.timer += frame.dt;
    const refresh = this.timer > 0.2;
    if (refresh) this.timer = 0;

    // ---- towers and polesets
    if (refresh) {
      const visible = alt < 32_000;
      const r = Math.min(26_000, alt * 2.6 + 3000);
      const counts: Record<string, number> = { l400: 0, l220: 0, l110: 0, pole: 0 };
      if (visible) {
        for (const i of this.chunksAround(this.supportChunks, cx, cz, r)) {
          const s = this.supports[i]!;
          if (Math.hypot(s.x - cx, s.z - cz) > r) continue;
          const mesh = this.towerMeshes[s.kind]!;
          const n = counts[s.kind]!;
          if (n >= mesh.instanceMatrix.count) continue;
          const h = Math.max(0, this.heightAt(s.x, s.z)) * ex;
          this.tmpQ.setFromAxisAngle(this.up, s.yaw + Math.PI / 2);
          this.tmpM.compose(this.tmpP.set(s.x, h, s.z), this.tmpQ, this.tmpS);
          mesh.setMatrixAt(n, this.tmpM);
          counts[s.kind] = n + 1;
        }
      }
      for (const [k, mesh] of Object.entries(this.towerMeshes)) {
        mesh.count = counts[k]!;
        mesh.instanceMatrix.needsUpdate = true;
      }
      frameStats.supports = Object.values(counts).reduce((a, b) => a + b, 0);
    }

    // ---- conductors (site scale)
    if (refresh) {
      let n = 0;
      if (alt < 9000) {
        const r = Math.min(7000, alt * 2 + 1500);
        const A = this.cond.a.array as Float32Array;
        const B = this.cond.b.array as Float32Array;
        const S = this.cond.s.array as Float32Array;
        const C = this.cond.c.array as Float32Array;
        const theme = world.themeMix.value;
        const ink = new Color('#2a2b2c').lerp(new Color('#9fb3c2'), theme);
        const amber = new Color('#b0731a');
        const crimson = new Color('#b3261e').lerp(new Color('#ff5040'), theme);
        const col = new Color();
        const pa = new Vector3();
        const pb = new Vector3();
        for (const i of this.chunksAround(this.spanChunks, cx, cz, r)) {
          const sp = this.spans[i]!;
          const mx = (sp.a.x + sp.b.x) / 2;
          const mz = (sp.a.z + sp.b.z) / 2;
          if (Math.hypot(mx - cx, mz - cz) > r || sp.length > 1500) continue;
          const loading = frame.loading[sp.branch] ?? 0;
          const mi = sceneToItm(mx, mz);
          const wind = siteSpeed(frame.wind, mi.e, mi.n, frame.hours, 0);
          const temp = conductorTemperature(sp.kv, loading, frame.ambientC, wind);
          const sag = sagAt(sp.kv, temp, sp.length) * this.sagExaggeration;
          const swing = blowoutAngle(sp.kv, wind) * (1 + 0.1 * Math.sin(frame.hours * 900 + i));
          const ha = Math.max(0, this.heightAt(sp.a.x, sp.a.z)) * ex;
          const hb = Math.max(0, this.heightAt(sp.b.x, sp.b.z)) * ex;
          const atA = attachments(sp.a.kind);
          const atB = attachments(sp.b.kind);
          const lx = -(sp.b.z - sp.a.z) / (sp.length || 1);
          const lz = (sp.b.x - sp.a.x) / (sp.length || 1);
          col.copy(ink);
          if (loading > 0.6) col.copy(ink).lerp(amber, Math.min(1, (loading - 0.6) / 0.05));
          if (loading > 0.9) col.copy(amber).lerp(crimson, Math.min(1, (loading - 0.9) / 0.05));
          const width = alt < 1500 ? 1.6 : 1.1;
          const phases = Math.min(atA.length, atB.length);
          const put = (va: Vector3, vb: Vector3, sagM: number, w: number, c: Color) => {
            if (n >= this.maxCond) return;
            A.set([va.x, va.y, va.z, 0], n * 4);
            B.set([vb.x, vb.y, vb.z, 0], n * 4);
            S.set([sagM, swing, lx, lz], n * 4);
            C.set([c.r, c.g, c.b, w], n * 4);
            n++;
          };
          const toWorld = (s: Support, local: Vector3, h: number, out: Vector3) => {
            const c = Math.cos(s.yaw + Math.PI / 2);
            const si = Math.sin(s.yaw + Math.PI / 2);
            return out.set(s.x + local.x * c + local.z * si, h + local.y, s.z - local.x * si + local.z * c);
          };
          for (let p = 0; p < phases; p++) {
            toWorld(sp.a, atA[p]!, ha, pa);
            toWorld(sp.b, atB[p]!, hb, pb);
            put(pa, pb, sag, width, col);
          }
          const ea = earthWire(sp.a.kind);
          const eb = earthWire(sp.b.kind);
          if (ea && eb) {
            toWorld(sp.a, ea, ha, pa);
            toWorld(sp.b, eb, hb, pb);
            put(pa, pb, sag * 0.8, width * 0.7, ink);
          }
        }
      }
      this.cond.geo.instanceCount = n;
      frameStats.conductors = n;
      for (const at of [this.cond.a, this.cond.b, this.cond.s, this.cond.c]) at.needsUpdate = true;
    }

    // ---- turbines
    const turbinesVisible = alt < 45_000;
    if (!turbinesVisible) {
      this.turbineTowerMesh.count = 0;
      this.rotorMesh.count = 0;
      return;
    }
    const r = Math.min(40_000, alt * 3 + 4000);
    const near = this.chunksAround(this.turbineChunks, cx, cz, r);
    // Prevailing wind from the west-south-west: rotors face into it.
    const windFrom = (250 * Math.PI) / 180;
    const faceX = -Math.sin(windFrom);
    const faceZ = Math.cos(windFrom);
    const yaw = Math.atan2(-faceX, -faceZ);
    const qYaw = new Quaternion().setFromAxisAngle(this.up, yaw);
    const qSpin = new Quaternion();
    const zAxis = new Vector3(0, 0, 1);
    let n = 0;
    for (const i of near) {
      const t = this.turbines[i]!;
      if (Math.hypot(t.x - cx, t.z - cz) > r || n >= 4000) continue;
      const v = siteSpeed(frame.wind, t.e, t.n, frame.hours, 0);
      // Rotor speed: tip-speed ratio 8, capped at 14.5 rpm; stopped below cut-in and feathered above cut-out.
      const rpm = v < 3 || v >= 25 ? 0 : Math.min(14.5, ((8 * v) / 56) * (60 / (2 * Math.PI)));
      t.angle = (t.angle + rpm * (Math.PI / 30) * frame.dt) % (Math.PI * 2);
      const h = Math.max(0, this.heightAt(t.x, t.z)) * ex;
      this.tmpM.compose(this.tmpP.set(t.x, h, t.z), qYaw, this.tmpS);
      this.turbineTowerMesh.setMatrixAt(n, this.tmpM);
      qSpin.setFromAxisAngle(zAxis, t.angle);
      const q = qYaw.clone().multiply(qSpin);
      const hub = new Vector3(0, TURBINE_HUB, 4.2).applyQuaternion(qYaw);
      this.tmpM.compose(this.tmpP.set(t.x + hub.x, h + hub.y, t.z + hub.z), q, this.tmpS);
      this.rotorMesh.setMatrixAt(n, this.tmpM);
      n++;
    }
    this.turbineTowerMesh.count = n;
    this.rotorMesh.count = n;
    frameStats.turbines = n;
    this.turbineTowerMesh.instanceMatrix.needsUpdate = true;
    this.rotorMesh.instanceMatrix.needsUpdate = true;
  }
}
