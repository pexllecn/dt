/**
 * Agent markers: a small ring and a line above each asset, calm by default. A marker brightens
 * while its agent's evaluation is changing, takes the colour of its worst report, and draws a
 * thin arc to a neighbour only when a published state changed that neighbour's evaluation.
 */
import * as THREE from 'three/webgpu';
import type { AgentView } from '../agents/types.ts';
import type { ComponentId } from '../sim/types.ts';

const COLOUR = { calm: 0x9aa3ad, info: 0x9aa3ad, advisory: 0x4f8fe0, warning: 0xf2a53a, critical: 0xff5a4a } as const;
const ARC_LIFE_S = 90;

export class Markers {
  readonly group = new THREE.Group();
  // Scratch objects for the per-frame update.
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();
  private c = new THREE.Color();
  private ids: ComponentId[];
  private pos: THREE.Vector3[];
  private rings: THREE.InstancedMesh;
  private stems: THREE.InstancedMesh;
  private arcPool: THREE.Mesh[] = [];
  private arcKey = '';

  constructor(anchors: Map<ComponentId, THREE.Vector3>) {
    this.group.name = 'markers';
    this.ids = [...anchors.keys()];
    this.pos = this.ids.map((id) => anchors.get(id)!.clone().add(new THREE.Vector3(0, 5, 0)));
    const ringGeo = new THREE.TorusGeometry(1.1, 0.09, 6, 32);
    ringGeo.rotateX(Math.PI / 2);
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5);
    stemGeo.translate(0, -1.3, 0);
    const mk = () => new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    this.rings = new THREE.InstancedMesh(ringGeo, mk(), this.ids.length);
    this.stems = new THREE.InstancedMesh(stemGeo, mk(), this.ids.length);
    this.pos.forEach((p, i) => {
      const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
      this.rings.setMatrixAt(i, m);
      this.stems.setMatrixAt(i, m);
      this.rings.setColorAt(i, new THREE.Color(COLOUR.calm));
      this.stems.setColorAt(i, new THREE.Color(COLOUR.calm));
    });
    this.rings.renderOrder = this.stems.renderOrder = 8;
    this.group.add(this.rings, this.stems);
    const arcMat = new THREE.MeshBasicNodeMaterial({ color: 0x8fc2ff, transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), arcMat.clone());
      m.visible = false;
      m.renderOrder = 9;
      this.arcPool.push(m);
      this.group.add(m);
    }
  }

  update(view: AgentView | null, simT: number, time: number, viewDist = 200): void {
    const k = Math.max(1, viewDist / 140);
    if (!view) return;
    const byId = new Map(view.statuses.map((s) => [s.id, s]));
    const c = this.c;
    this.ids.forEach((id, i) => {
      const st = byId.get(id);
      const level = st?.level ?? 'calm';
      const fresh = st ? Math.max(0, 1 - (simT - st.changedT) / 60) : 0;
      const pulse = level === 'critical' ? 0.75 + 0.25 * Math.sin(time * 5) : 1;
      c.set(COLOUR[level]).multiplyScalar((level === 'calm' ? 0.55 : 1) * (1 + fresh * 0.8) * pulse);
      this.rings.setColorAt(i, c);
      this.stems.setColorAt(i, c);
      const s = 1 + fresh * 0.35 + (level === 'calm' ? 0 : 0.25);
      const p = this.pos[i]!;
      const m = this.m.compose(this.v.copy(p).setY(p.y + (k - 1) * 3), this.q, this.sc.set(s * k, k, s * k));
      this.rings.setMatrixAt(i, m);
      this.stems.setMatrixAt(i, m);
    });
    this.rings.instanceMatrix.needsUpdate = true;
    this.stems.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    if (this.stems.instanceColor) this.stems.instanceColor.needsUpdate = true;
    // Arcs.
    const live = view.arcs.filter((a) => simT - a.t < ARC_LIFE_S && a.from !== a.to);
    const key = live.map((a) => `${a.from}>${a.to}@${a.t}`).join(',');
    if (key !== this.arcKey) {
      this.arcKey = key;
      this.arcPool.forEach((m, i) => {
        const a = live[live.length - 1 - i];
        const ia = a ? this.ids.indexOf(a.from) : -1;
        const ib = a ? this.ids.indexOf(a.to) : -1;
        if (!a || ia < 0 || ib < 0) { m.visible = false; return; }
        const p0 = this.pos[ia]!, p1 = this.pos[ib]!;
        const mid = p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, 6 + p0.distanceTo(p1) * 0.18, 0));
        const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
        m.geometry.dispose();
        m.geometry = new THREE.TubeGeometry(curve, 32, 0.12, 5, false);
        m.userData.t = a.t;
        m.visible = true;
      });
    }
    for (const m of this.arcPool) if (m.visible) (m.material as THREE.MeshBasicNodeMaterial).opacity = 0.85 * Math.max(0, 1 - (simT - (m.userData.t as number)) / ARC_LIFE_S);
  }
}
