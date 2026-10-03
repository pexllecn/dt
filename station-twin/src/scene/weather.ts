/**
 * Weather and protection effects, all driven by the state: rain while it rains, slanted by the
 * simulated wind; lightning (a bolt and a flash) when a lightning trip is logged, with occasional
 * sheet lightning while the storm lasts; and a protection pulse at any asset that trips.
 * Deterministic: everything follows simulated time and the log.
 */
import * as THREE from 'three/webgpu';
import type { ComponentId, SimState } from '../sim/types.ts';

const RAIN = 2600;
const BOX = 180;
const FLASH_OFFSET = new THREE.Vector3(-200, 400, -150);

function hash(n: number): number { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }

export class WeatherFx {
  readonly group = new THREE.Group();
  private rain: THREE.InstancedMesh;
  private rainMat: THREE.MeshBasicNodeMaterial;
  private seeds: Float32Array;
  private bolt: THREE.Mesh;
  private boltMat: THREE.MeshBasicNodeMaterial;
  private flash: THREE.PointLight;
  private pulses: { mesh: THREE.Mesh; t0: number }[] = [];
  private seenLog = 0;
  private boltUntil = -1;
  private boltAt = new THREE.Vector3();
  /** 0 to 1: how bright the sky flash is now (the stage adds it to the exposure). */
  flashLevel = 0;
  // Scratch objects for the per-frame rain update.
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private sc = new THREE.Vector3();

  constructor(private anchors: Map<ComponentId, THREE.Vector3>) {
    this.group.name = 'weather';
    const streak = new THREE.CylinderGeometry(0.035, 0.035, 3.2, 3, 1, true);
    this.rainMat = new THREE.MeshBasicNodeMaterial({ color: 0xd6dee6, transparent: true, opacity: 0.45, depthWrite: false });
    this.rain = new THREE.InstancedMesh(streak, this.rainMat, RAIN);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.seeds = new Float32Array(RAIN * 3);
    for (let i = 0; i < RAIN; i++) { this.seeds[i * 3] = hash(i + 1); this.seeds[i * 3 + 1] = hash(i + 7.3); this.seeds[i * 3 + 2] = hash(i + 13.9); }
    this.group.add(this.rain);
    this.boltMat = new THREE.MeshBasicNodeMaterial({ color: 0xeef3ff, transparent: true, opacity: 0, depthWrite: false });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);
    this.flash = new THREE.PointLight(0xdfe8ff, 0, 0, 2);
    this.group.add(this.flash);
    const ringGeo = new THREE.RingGeometry(0.9, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicNodeMaterial({ color: 0xff4a3a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      m.renderOrder = 11;
      this.group.add(m);
      this.pulses.push({ mesh: m, t0: -1 });
    }
  }

  update(s: SimState, time: number, target: THREE.Vector3): void {
    // New log entries: trips pulse, lightning trips strike.
    if (s.log.length < this.seenLog) this.seenLog = 0;
    for (; this.seenLog < s.log.length; this.seenLog++) {
      const e = s.log[this.seenLog]!;
      // Only recent events: on load (or after a jump in time) old trips do not replay.
      if (e.kind !== 'trip' || !e.id || e.t < s.t - 30) continue;
      const a = this.anchors.get(e.id);
      if (!a) continue;
      const p = this.pulses.find((x) => x.t0 < 0 || time - x.t0 > 2) ?? this.pulses[0]!;
      p.t0 = time;
      p.mesh.position.set(a.x, 0.3, a.z);
      p.mesh.visible = true;
      if (/lightning/i.test(e.text)) this.strike(a, time, e.t);
    }
    for (const p of this.pulses) {
      if (p.t0 < 0) continue;
      const k = (time - p.t0) / 1.8;
      if (k > 1) { p.mesh.visible = false; p.t0 = -1; continue; }
      const r = 4 + k * 26;
      p.mesh.scale.set(r, 1, r);
      (p.mesh.material as THREE.MeshBasicNodeMaterial).opacity = 0.85 * (1 - k);
    }
    // Sheet lightning: a few flashes a minute of simulated time while the storm lasts.
    const storm = s.weather.storm;
    let flash = 0;
    if (storm) {
      const slot = Math.floor(s.t / 20);
      if (hash(slot) > 0.86) { const ph = (s.t % 20) / 20; flash = Math.max(0, 1 - Math.abs(ph - 0.5) * 12) * 0.5; }
    }
    if (time < this.boltUntil) flash = Math.max(flash, (this.boltUntil - time) / 0.35);
    this.flashLevel = flash;
    this.flash.intensity = flash * 1.2e6;
    this.flash.position.copy(target).add(FLASH_OFFSET);
    if (time >= this.boltUntil) this.bolt.visible = false;
    else this.boltMat.opacity = Math.min(1, (this.boltUntil - time) / 0.2);
    // Rain: streaks in a box around the camera target, falling and slanted with the wind.
    const rain = s.weather.rain;
    this.rain.visible = rain > 0.05;
    if (this.rain.visible) {
      const wind = Math.min(1.2, s.C.WIND.windSpeed / 20);
      const fall = 9;
      const { m, v } = this;
      const q = this.q.setFromEuler(this.e.set(0, 0, -wind * 0.5));
      const sc = this.sc.set(1, 1 + wind, 1);
      const n = Math.floor(RAIN * Math.min(1, rain));
      for (let i = 0; i < RAIN; i++) {
        if (i >= n) { m.makeScale(0, 0, 0); this.rain.setMatrixAt(i, m); continue; }
        const y = BOX - (((this.seeds[i * 3 + 1]! * BOX + time * fall * 6) % BOX) + BOX) % BOX;
        v.set(target.x + (this.seeds[i * 3]! - 0.5) * BOX + y * wind * 0.5, Math.max(0, y * 0.5), target.z + (this.seeds[i * 3 + 2]! - 0.5) * BOX);
        m.compose(v, q, sc);
        this.rain.setMatrixAt(i, m);
      }
      this.rain.instanceMatrix.needsUpdate = true;
      this.rainMat.opacity = 0.3 + rain * 0.35;
    }
  }

  /** A forked bolt from the cloud base to the struck asset. Its shape follows the event time, so it is the same every run. */
  private strike(a: THREE.Vector3, time: number, seed: number): void {
    const top = new THREE.Vector3(a.x + (hash(seed) - 0.5) * 120, 520, a.z + (hash(seed + 1) - 0.5) * 120);
    const pts: THREE.Vector3[] = [];
    const end = a.clone().add(new THREE.Vector3(0, 6, 0));
    for (let i = 0; i <= 14; i++) {
      const k = i / 14;
      const p = top.clone().lerp(end, k);
      if (i > 0 && i < 14) p.add(new THREE.Vector3((hash(seed + i * 3) - 0.5) * 30 * (1 - k), 0, (hash(seed + i * 5) - 0.5) * 30 * (1 - k)));
      pts.push(p);
    }
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 80, 0.6, 5, false);
    this.bolt.visible = true;
    this.boltAt.copy(end);
    this.boltUntil = time + 0.35;
  }
}
