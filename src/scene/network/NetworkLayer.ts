import {
  BufferAttribute,
  Color,
  DataTexture,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  RGBAFormat,
  type PerspectiveCamera,
} from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  float,
  fract,
  length,
  max,
  mix,
  normalize,
  screenSize,
  select,
  smoothstep,
  texture,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { itmToScene } from '@/lib/geo';
import type { ModelMeta } from '@/sim/protocol';
import type { NetworkData } from '@/sim/types';
import { world } from '../world/uniforms';
import type { N } from '@/lib/tsl';

/** Pixel width and conductor height (m above ground) by voltage class. */
const STYLE: Record<number, { px: number; lift: number }> = {
  400: { px: 3.4, lift: 36 },
  275: { px: 2.5, lift: 30 },
  220: { px: 2.3, lift: 27 },
  110: { px: 1.25, lift: 17 },
};
const style = (kv: number) => STYLE[kv] ?? (kv >= 300 ? STYLE[400]! : kv >= 200 ? STYLE[220]! : STYLE[110]!);

interface Polyline {
  branch: number;
  pts: Float64Array; // x, z pairs (scene)
  cum: Float64Array; // cumulative length (m)
  heights: Float32Array;
  length: number;
  kv: number;
  cable: boolean;
}

export interface NetworkFrame {
  /** Signed MW per branch (meta order). */
  flows: Float32Array;
  loading: Float32Array;
  n1: Float32Array;
  tripped: Set<number>;
  dt: number;
  altitude: number;
}

/** Linear-space colour from an sRGB hex string. */
const col = (hex: string) => {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
};

const MAX_SEGMENT = 450; // m: densify so ribbons follow the ground

/** Builds a clip-space position for a screen-space-width segment quad. */
export function segmentClip(
  pa: N<'vec3'>,
  pb: N<'vec3'>,
  end: N<'float'>,
  side: N<'float'>,
  widthPx: N<'float'>,
) {
  const ca = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(pa, 1)));
  const cb = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(pb, 1)));
  // Keep both ends in front of the camera so close-up segments do not flip.
  const eps = float(1e-3);
  const ta = clamp(eps.sub(ca.w).div(cb.w.sub(ca.w)), 0, 1);
  const tb = clamp(eps.sub(cb.w).div(ca.w.sub(cb.w)), 0, 1);
  const a2 = select(ca.w.lessThan(eps), mix(ca, cb, ta), ca);
  const b2 = select(cb.w.lessThan(eps), mix(cb, ca, tb), cb);
  const na = a2.xy.div(a2.w);
  const nb = b2.xy.div(b2.w);
  const d = nb.sub(na).mul(screenSize);
  const dir = normalize(select(length(d).lessThan(1e-4), vec2(1, 0), d));
  const normal = vec2(dir.y.negate(), dir.x);
  const c = mix(a2, b2, end);
  const offset = normal.mul(side).mul(widthPx).div(screenSize).mul(2);
  return vec4(c.xy.add(offset.mul(c.w)), c.z, c.w);
}

/**
 * The transmission network: ribbons by voltage class coloured by loading, and flow particles
 * whose speed is proportional to MW and whose direction follows the sign of the flow.
 */
export class NetworkLayer {
  readonly group = new Group();
  private readonly lines: Polyline[] = [];
  private readonly stateTex: DataTexture;
  private readonly state: Float32Array;
  private readonly nb: number;
  private ribbonA!: InstancedBufferAttribute;
  private ribbonB!: InstancedBufferAttribute;
  private particleGeo!: InstancedBufferGeometry;
  private particlePos!: InstancedBufferAttribute;
  private particleDir!: InstancedBufferAttribute;
  private readonly offsets: Float64Array;
  private spacing = 0;
  private particleSlots: { line: number; base: number }[] = [];
  private refreshTimer = 0;
  private readonly heightAt: (x: number, z: number) => number;
  readonly ribbonMaterial: MeshBasicNodeMaterial;
  readonly particleMaterial: MeshBasicNodeMaterial;
  private readonly maxParticles = 60_000;
  /** Index of the branch shown in the inspector (-1 for none). */
  readonly selected = uniform(-1);

  constructor(net: NetworkData, lines: Record<string, number[][]>, meta: ModelMeta, heightAt: (x: number, z: number) => number) {
    this.heightAt = heightAt;
    this.nb = meta.branches.length;
    this.state = new Float32Array(this.nb * 4);
    this.stateTex = new DataTexture(this.state, this.nb, 1, RGBAFormat, FloatType);
    this.stateTex.minFilter = NearestFilter;
    this.stateTex.magFilter = NearestFilter;
    this.stateTex.needsUpdate = true;
    this.offsets = new Float64Array(this.nb);

    const nodeById = new Map(net.nodes.map((n) => [n.id, n]));
    const busNode = new Map(net.buses.map((b) => [b.id, nodeById.get(b.node)!]));
    const netBranch = new Map(net.branches.map((b) => [b.id, b]));

    meta.branches.forEach((bm, i) => {
      const raw = lines[bm.id];
      if (!raw || raw.length < 2) return;
      const from = busNode.get(bm.from)!;
      // Orient the polyline from the from-bus to the to-bus so positive flow runs along it.
      const first = raw[0]!;
      const last = raw[raw.length - 1]!;
      const dFirst = Math.hypot(first[0]! - from.e, first[1]! - from.n);
      const dLast = Math.hypot(last[0]! - from.e, last[1]! - from.n);
      const ordered = dFirst <= dLast ? raw : [...raw].reverse();
      const pts: number[] = [];
      for (let k = 0; k < ordered.length; k++) {
        const [x, z] = itmToScene(ordered[k]![0]!, ordered[k]![1]!);
        if (k > 0) {
          const px = pts[pts.length - 2]!;
          const pz = pts[pts.length - 1]!;
          const L = Math.hypot(x - px, z - pz);
          const n = Math.ceil(L / MAX_SEGMENT);
          for (let s = 1; s < n; s++) pts.push(px + ((x - px) * s) / n, pz + ((z - pz) * s) / n);
        }
        pts.push(x, z);
      }
      const P = Float64Array.from(pts);
      const cum = new Float64Array(P.length / 2);
      for (let k = 1; k < cum.length; k++) cum[k] = cum[k - 1]! + Math.hypot(P[k * 2]! - P[k * 2 - 2]!, P[k * 2 + 1]! - P[k * 2 - 1]!);
      const nbr = netBranch.get(bm.id);
      this.lines.push({
        branch: i,
        pts: P,
        cum,
        heights: new Float32Array(cum.length),
        length: cum[cum.length - 1]!,
        kv: bm.kv,
        cable: (nbr?.cableFraction ?? 0) > 0.5,
      });
    });

    this.ribbonMaterial = this.buildRibbons(meta);
    this.particleMaterial = this.buildParticles();
    this.refreshHeights();
  }

  private buildRibbons(meta: ModelMeta): MeshBasicNodeMaterial {
    const segs = this.lines.reduce((s, l) => s + l.cum.length - 1, 0);
    const A = new Float32Array(segs * 4);
    const B = new Float32Array(segs * 4);
    const M = new Float32Array(segs * 4);
    let k = 0;
    for (const l of this.lines) {
      const st = style(l.kv);
      const ni = meta.branches[l.branch]!.country === 'NI' ? 1 : 0;
      for (let j = 0; j < l.cum.length - 1; j++, k++) {
        A.set([l.pts[j * 2]!, 0, l.pts[j * 2 + 1]!, l.cum[j]!], k * 4);
        B.set([l.pts[j * 2 + 2]!, 0, l.pts[j * 2 + 3]!, l.cum[j + 1]!], k * 4);
        M.set([l.branch, l.cable ? st.px * 0.75 : st.px, l.cable ? 1.5 : st.lift, ni + (l.cable ? 2 : 0)], k * 4);
      }
    }
    const g = new InstancedBufferGeometry();
    g.setAttribute('corner', new BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    this.ribbonA = new InstancedBufferAttribute(A, 4);
    this.ribbonB = new InstancedBufferAttribute(B, 4);
    g.setAttribute('iA', this.ribbonA);
    g.setAttribute('iB', this.ribbonB);
    g.setAttribute('iMeta', new InstancedBufferAttribute(M, 4));
    g.instanceCount = segs;

    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    const corner = attribute('corner', 'vec2');
    const iA = attribute('iA', 'vec4');
    const iB = attribute('iB', 'vec4');
    const iMeta = attribute('iMeta', 'vec4');
    const vAlong = varyingProperty('float', 'vAlong');
    const vSide = varyingProperty('float', 'vSide');
    const vBranch = varyingProperty('float', 'vBranch');
    const vFlags = varyingProperty('float', 'vFlags');
    const vWidth = varyingProperty('float', 'vWidth');
    const lift = iMeta.z.add(world.altitude.mul(0.0035));
    const zoomWidth = float(1).add(smoothstep(40_000, 3_000, world.altitude).mul(0.9));
    mat.vertexNode = Fn(() => {
      const pa = vec3(iA.x, iA.y.mul(world.exaggeration).add(lift), iA.z);
      const pb = vec3(iB.x, iB.y.mul(world.exaggeration).add(lift), iB.z);
      const isSel = float(1).sub(smoothstep(0.1, 0.5, abs(iMeta.x.sub(this.selected))));
      // Circuits near or over their rating are drawn wider so the incident reads at any scale.
      const stV = texture(this.stateTex, vec2(iMeta.x.add(0.5).div(this.nb), 0.5)).level(float(0));
      const hot = smoothstep(0.88, 0.95, stV.r).mul(float(1).sub(stV.b));
      const w = iMeta.y.mul(zoomWidth).mul(isSel.mul(1.6).add(1)).mul(hot.mul(0.9).add(1)).add(isSel.mul(3)).add(hot.mul(1.5)).add(1); // +1 px for the anti-aliased edge
      vAlong.assign(mix(iA.w, iB.w, corner.x));
      vSide.assign(corner.y);
      vBranch.assign(iMeta.x);
      vFlags.assign(iMeta.w);
      vWidth.assign(w);
      return segmentClip(pa, pb, corner.x, corner.y, w.mul(0.5));
    })();

    const st = texture(this.stateTex, vec2(vBranch.add(0.5).div(this.nb), 0.5));
    const loading = st.r;
    const tripped = st.b;
    const ni = fract(vFlags.mul(0.5)).mul(2); // bit 0
    const cable = smoothstep(1.5, 2.5, vFlags);
    // Colour: ink (Specimen) or emissive cool (Control Room) below 60%, amber 60 to 90%, crimson above 90%.
    const inkA = col('#1f1e1b');
    const coolB = col('#7cc0e0');
    const amber = mix(col('#a86a12'), col('#f0a83a'), world.themeMix);
    const crimson = mix(col('#a8231b'), col('#ff4d40'), world.themeMix);
    const base = mix(inkA, coolB.mul(0.9), world.themeMix);
    const c1 = mix(base, amber, smoothstep(0.58, 0.62, loading));
    const colour = mix(c1, crimson, smoothstep(0.88, 0.92, loading));
    // Above 90%: hatch along the line so loading is not shown by colour alone.
    const stripeLen = max(world.altitude.mul(0.012), 40);
    const stripe = smoothstep(0.35, 0.45, abs(fract(vAlong.div(stripeLen)).sub(0.5)));
    const over = smoothstep(0.9, 0.92, loading);
    const pulse = float(0.75).add(float(0.25).mul(world.time.mul(5).sin())).mul(smoothstep(0.99, 1.01, loading)).add(float(1).sub(smoothstep(0.99, 1.01, loading)));
    const dash = smoothstep(0.45, 0.55, fract(vAlong.div(stripeLen.mul(0.6))));
    const edge = float(1).sub(smoothstep(vWidth.sub(1.5).div(vWidth), 1, abs(vSide)));
    // At site scale the modelled conductors take over from the overhead ribbon.
    const siteFade = mix(smoothstep(1800, 5000, world.altitude), float(1), cable);
    const ribbonAlpha = mix(float(0.88), float(0.95), world.themeMix)
      .mul(siteFade)
      .mul(mix(float(1), float(0.45), ni))
      .mul(mix(float(1), float(0.55), cable))
      .mul(mix(float(1), mix(float(1), float(0.55), stripe), over))
      .mul(pulse);
    const trippedAlpha = dash.mul(0.6);
    const trippedColour = mix(vec3(0.45, 0.43, 0.4), vec3(0.6, 0.6, 0.62), world.themeMix);
    mat.colorNode = vec4(mix(colour, trippedColour, tripped), 1);
    mat.opacityNode = mix(ribbonAlpha, trippedAlpha, tripped).mul(edge);
    mat.fog = true;
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    mesh.name = 'network-ribbons';
    this.group.add(mesh);
    return mat;
  }

  private buildParticles(): MeshBasicNodeMaterial {
    const g = new InstancedBufferGeometry();
    g.setAttribute('corner', new BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    this.particlePos = new InstancedBufferAttribute(new Float32Array(this.maxParticles * 4), 4);
    this.particleDir = new InstancedBufferAttribute(new Float32Array(this.maxParticles * 4), 4);
    this.particlePos.setUsage(35048); // DynamicDrawUsage
    this.particleDir.setUsage(35048);
    g.setAttribute('pPos', this.particlePos);
    g.setAttribute('pDir', this.particleDir);
    g.instanceCount = 0;
    this.particleGeo = g;

    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    const corner = attribute('corner', 'vec2');
    const pPos = attribute('pPos', 'vec4');
    const pDir = attribute('pDir', 'vec4');
    const vBranch = varyingProperty('float', 'vPBranch');
    const vUv = varyingProperty('vec2', 'vPUv');
    const lift = pDir.w.add(world.altitude.mul(0.0035)).add(1);
    mat.vertexNode = Fn(() => {
      const p = vec3(pPos.x, pPos.y.mul(world.exaggeration).add(lift), pPos.z);
      const len = float(5).add(smoothstep(60_000, 4_000, world.altitude).mul(6));
      // Short streak along the line, a little wider than the ribbon.
      const tip = p.add(vec3(pDir.x, 0, pDir.z).mul(world.altitude.mul(0.002).add(2)));
      vBranch.assign(pPos.w);
      vUv.assign(corner);
      const c = segmentClip(p, tip, float(0), corner.y, float(1.5));
      // stretch towards the tip in screen space
      const ct = segmentClip(p, tip, float(1), corner.y, float(1.5));
      const dirPx = ct.xy.div(ct.w).sub(c.xy.div(c.w)).mul(screenSize);
      const unit = dirPx.div(max(length(dirPx), 1e-4));
      const shift = unit.mul(len).mul(corner.x.sub(0.5)).div(screenSize).mul(2);
      return vec4(c.xy.add(shift.mul(c.w)), c.z, c.w);
    })();
    const st = texture(this.stateTex, vec2(vBranch.add(0.5).div(this.nb), 0.5));
    const loading = st.r;
    const cool = mix(col('#2c5a78'), col('#bfe9ff').mul(2.2), world.themeMix);
    const amber = mix(col('#c07a10'), col('#ffbf55').mul(2), world.themeMix);
    const red = mix(col('#c42a1f'), col('#ff5a4a').mul(2.2), world.themeMix);
    const colour = mix(mix(cool, amber, smoothstep(0.58, 0.62, loading)), red, smoothstep(0.88, 0.92, loading));
    // Soft capsule with a bright head.
    const across = float(1).sub(abs(vUv.y));
    const along = smoothstep(0, 0.6, vUv.x);
    mat.colorNode = vec4(colour, 1);
    mat.opacityNode = smoothstep(0, 0.6, across).mul(along).mul(float(1).sub(st.b));
    mat.fog = true;
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;
    mesh.name = 'network-particles';
    this.group.add(mesh);
    return mat;
  }

  /** Re-sample ground heights under the network as finer terrain tiles arrive. */
  refreshHeights(): void {
    const A = this.ribbonA.array as Float32Array;
    const B = this.ribbonB.array as Float32Array;
    let k = 0;
    for (const l of this.lines) {
      for (let j = 0; j < l.cum.length; j++) l.heights[j] = Math.max(0, this.heightAt(l.pts[j * 2]!, l.pts[j * 2 + 1]!));
      for (let j = 0; j < l.cum.length - 1; j++, k++) {
        A[k * 4 + 1] = l.heights[j]!;
        B[k * 4 + 1] = l.heights[j + 1]!;
      }
    }
    this.ribbonA.needsUpdate = true;
    this.ribbonB.needsUpdate = true;
  }

  private layoutParticles(spacing: number) {
    this.spacing = spacing;
    this.particleSlots = [];
    for (let li = 0; li < this.lines.length; li++) {
      const l = this.lines[li]!;
      const n = Math.max(1, Math.floor(l.length / spacing));
      for (let k = 0; k < n && this.particleSlots.length < this.maxParticles; k++) this.particleSlots.push({ line: li, base: k * (l.length / n) });
    }
    this.particleGeo.instanceCount = this.particleSlots.length;
  }

  /**
   * Branch under a screen point (CSS px), by distance to each projected segment; -1 if none
   * lies within a few pixels. CPU side, only run on click.
   */
  pick(px: number, py: number, w: number, h: number, camera: PerspectiveCamera, exaggeration: number, altitude: number): number {
    const m = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
    const e = m.elements;
    const proj = (x: number, y: number, z: number, out: number[]) => {
      const cw = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
      if (cw <= 1e-3) return false;
      out[0] = (((e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / cw) * 0.5 + 0.5) * w;
      out[1] = (-((e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / cw) * 0.5 + 0.5) * h;
      return true;
    };
    const a = [0, 0];
    const b = [0, 0];
    let best = -1;
    let bestD = 9;
    for (const l of this.lines) {
      const lift = (l.cable ? 1.5 : style(l.kv).lift) + altitude * 0.0035;
      for (let j = 0; j < l.cum.length - 1; j++) {
        if (!proj(l.pts[j * 2]!, l.heights[j]! * exaggeration + lift, l.pts[j * 2 + 1]!, a)) continue;
        if (!proj(l.pts[j * 2 + 2]!, l.heights[j + 1]! * exaggeration + lift, l.pts[j * 2 + 3]!, b)) continue;
        const dx = b[0]! - a[0]!;
        const dy = b[1]! - a[1]!;
        const L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - a[0]!) * dx + (py - a[1]!) * dy) / L2));
        const d = Math.hypot(a[0]! + dx * t - px, a[1]! + dy * t - py);
        if (d < bestD) {
          bestD = d;
          best = l.branch;
        }
      }
    }
    return best;
  }

  update(frame: NetworkFrame, camera: PerspectiveCamera): void {
    const { flows, loading, n1, tripped, dt, altitude } = frame;
    for (let i = 0; i < this.nb; i++) {
      this.state[i * 4] = loading[i] ?? 0;
      this.state[i * 4 + 1] = n1[i] ?? 0;
      this.state[i * 4 + 2] = tripped.has(i) ? 1 : 0;
    }
    this.stateTex.needsUpdate = true;

    this.refreshTimer += dt;
    if (this.refreshTimer > 1.5) {
      this.refreshTimer = 0;
      this.refreshHeights();
    }

    // Particle spacing follows the viewing scale so the flow reads at every zoom.
    const want = Math.min(26_000, Math.max(260, altitude * 0.032));
    if (!this.spacing || Math.abs(Math.log(want / this.spacing)) > 0.5) this.layoutParticles(want);

    // Advance each branch's particle phase: speed proportional to MW (spacings per second).
    for (let i = 0; i < this.nb; i++) {
      const mw = flows[i] ?? 0;
      const rate = Math.max(-3, Math.min(3, mw / 300));
      this.offsets[i] = (this.offsets[i]! + rate * this.spacing * dt) % 1e9;
    }
    const P = this.particlePos.array as Float32Array;
    const D = this.particleDir.array as Float32Array;
    void camera;
    this.particleSlots.forEach((slot, idx) => {
      const l = this.lines[slot.line]!;
      let s = (slot.base + this.offsets[l.branch]!) % l.length;
      if (s < 0) s += l.length;
      // binary search on cumulative length
      let lo = 0;
      let hi = l.cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (l.cum[mid]! <= s) lo = mid;
        else hi = mid;
      }
      const segLen = l.cum[hi]! - l.cum[lo]! || 1;
      const t = (s - l.cum[lo]!) / segLen;
      const ax = l.pts[lo * 2]!;
      const az = l.pts[lo * 2 + 1]!;
      const bx = l.pts[hi * 2]!;
      const bz = l.pts[hi * 2 + 1]!;
      const sign = (flows[l.branch] ?? 0) >= 0 ? 1 : -1;
      P[idx * 4] = ax + (bx - ax) * t;
      P[idx * 4 + 1] = l.heights[lo]! + (l.heights[hi]! - l.heights[lo]!) * t;
      P[idx * 4 + 2] = az + (bz - az) * t;
      P[idx * 4 + 3] = l.branch;
      D[idx * 4] = ((bx - ax) / segLen) * sign;
      D[idx * 4 + 2] = ((bz - az) / segLen) * sign;
      D[idx * 4 + 3] = l.cable ? 1.5 : style(l.kv).lift;
    });
    this.particlePos.needsUpdate = true;
    this.particleDir.needsUpdate = true;
  }
}
