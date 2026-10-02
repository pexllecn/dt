/**
 * The 3D stage: renderer (WebGPU, falling back to WebGL2), camera and controls, post-processing,
 * environment lighting, picking and camera moves. Framework-free so it can later mount inside
 * the national twin.
 */
import * as THREE from 'three/webgpu';
import {
  emissive, float, mix, mrt, output, pass, saturation, screenUV, uniform, vec3, vec4, velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import CameraControls from 'camera-controls';
import type { ComponentId, SimState } from '../sim/types.ts';
import { YARD_CENTRE } from './layout.ts';
import { createMaterials, type Materials } from './materials.ts';
import { createSky, type SkyRig, type Theme } from './sky.ts';
import { buildStation, type StationScene } from './station.ts';
import { buildSurroundings, type Surroundings } from './surroundings.ts';
import { FlowLayer } from './flow.ts';
import { buildYard, terrainHeight } from './yard.ts';

CameraControls.install({
  THREE: {
    Vector2: THREE.Vector2, Vector3: THREE.Vector3, Vector4: THREE.Vector4, Quaternion: THREE.Quaternion, Matrix4: THREE.Matrix4,
    Spherical: THREE.Spherical, Box3: THREE.Box3, Sphere: THREE.Sphere, Raycaster: THREE.Raycaster,
  },
});

export type Tier = 'high' | 'medium' | 'low';
export type Lens = 'physical' | 'flow' | 'circuit';

/** The flow path whose direction a component's label arrow follows. */
const ARROW_KEY: Partial<Record<ComponentId, string>> = {
  GRID: 'L400-1', WIND: 'WIND', TIE_N: 'TIE_N', TIE_S: 'TIE_S', TIE_NI: 'T4-275', SOLAR: 'SOLAR', GAS: 'GAS', BESS: 'BESS',
  LD_NEW: 'LD_NEW', LD_IND: 'LD_IND', LD_TOWN: 'REG-A', BS220: 'BS220', T1: 'T1-HV', T2: 'T2-HV', T3: 'T3-220', T4: 'T4-220',
};

export interface StageOptions {
  canvas: HTMLCanvasElement;
  backend?: 'auto' | 'webgpu' | 'webgl';
  tier?: Tier;
  /** Deterministic capture: no automatic tier changes, fixed frame step. */
  capture?: boolean;
}

export interface StageStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  backend: string;
  tier: Tier;
}

export interface ProjectedLabel {
  id: ComponentId;
  x: number;
  y: number;
  visible: boolean;
  distance: number;
}

export class Stage {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  controls!: CameraControls;
  materials!: Materials;
  station!: StationScene;
  surroundings!: Surroundings;
  flow!: FlowLayer;
  lens: Lens = 'physical';
  private flowDim = uniform(0);
  private arrowRuns = new Map<string, { pts: THREE.Vector3[] }>();
  private pickables: THREE.Object3D[] = [];
  private bounds = new Map<ComponentId, THREE.Box3>();
  sky!: SkyRig;
  backend = 'unknown';
  tier: Tier;
  private pipeline: THREE.RenderPipeline | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene = new THREE.Scene();
  private envSky: THREE.Mesh | null = null;
  private envTarget: THREE.RenderTarget | null = null;
  private clock = new THREE.Timer();
  private state: SimState | null = null;
  private theme: Theme = 'daylight';
  private grade = uniform(0);
  private aoStrength = uniform(0.85);
  private selected: ComponentId | null = null;
  private selectionRing: THREE.Mesh | null = null;
  private time = 0;
  private frames = 0;
  private fpsAccum = 0;
  private stats: StageStats;
  private raycaster = new THREE.Raycaster();
  private capture: boolean;
  private needsEnv = true;
  private themeApplied = false;
  onFrame: ((stage: Stage) => void) | null = null;
  onPick: ((id: ComponentId | null) => void) | null = null;

  constructor(private opts: StageOptions) {
    const forceWebGL = opts.backend === 'webgl' || (opts.backend !== 'webgpu' && !('gpu' in navigator));
    this.renderer = new THREE.WebGPURenderer({ canvas: opts.canvas, antialias: false, forceWebGL } as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.8, 30000);
    this.tier = opts.tier ?? 'high';
    this.capture = !!opts.capture;
    this.stats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, backend: '', tier: this.tier };
  }

  async init(): Promise<void> {
    const r = this.renderer;
    await r.init();
    const backend = (r as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backend = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.tier === 'high' ? 2 : 1.25));
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 0.6;
    r.shadowMap.enabled = this.tier !== 'low';
    r.shadowMap.type = THREE.PCFShadowMap;

    this.materials = createMaterials();
    const focus = new THREE.Vector3(...YARD_CENTRE);
    this.sky = createSky(this.scene, this.materials, focus);
    if (this.tier === 'medium') this.sky.sun.shadow.mapSize.set(2048, 2048);
    const yard = buildYard(this.materials);
    this.scene.add(yard.group);
    this.station = buildStation(this.materials);
    this.scene.add(this.station.group);
    this.surroundings = buildSurroundings(this.materials, this.station.lineStarts, this.station.cableEnds);
    this.scene.add(this.surroundings.group);
    this.pickables = [...this.station.pickables, ...this.surroundings.pickables];
    // Plant outside the fence is framed by its site; everything else by its bay.
    this.bounds = new Map(this.station.bounds);
    for (const [id, b] of this.surroundings.bounds) this.bounds.set(id, b);
    this.flow = new FlowLayer([...this.station.paths, ...this.surroundings.paths]);
    this.scene.add(this.flow.group);
    this.scene.fog = new THREE.FogExp2(0xc9d3dc, 0.00007);

    // A copy of the sky for baking the environment map.
    this.envSky = this.sky.sky.clone();
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(r);

    this.camera.position.set(170, 150, 330);
    this.controls = new CameraControls(this.camera, this.opts.canvas);
    this.controls.smoothTime = 0.45;
    this.controls.draggingSmoothTime = 0.12;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 9000;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.dollyToCursor = true;
    this.controls.setLookAt(170, 150, 330, focus.x, 4, focus.z, false);

    const ringGeo = new THREE.RingGeometry(1, 1.06, 96);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicNodeMaterial({ color: 0xf2f4f6, transparent: true, opacity: 0.7, depthWrite: false });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 10;
    this.scene.add(this.selectionRing);

    this.buildPipeline();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.attachPicking();
    this.stats.backend = this.backend;
  }

  private buildPipeline(): void {
    if (this.tier === 'low') { this.pipeline = null; return; }
    const pipeline = new THREE.RenderPipeline(this.renderer);
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive, velocity }));
    const colour = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    // Normals are reconstructed from depth, which saves a render target.
    const aoPass = ao(depth, null as unknown as THREE.Node, this.camera);
    aoPass.resolutionScale = this.tier === 'high' ? 0.75 : 0.5;
    aoPass.radius.value = 1.2;
    aoPass.thickness.value = 1.0;
    const occlusion = aoPass.getTextureNode().sample(screenUV).r;
    const lit = colour.rgb.mul(mix(float(1), occlusion, this.aoStrength));
    const glow = bloom(scenePass.getTextureNode('emissive'), 0.9, 0.35, 0.05);
    // Flow lens: the scene dims so the glowing conductors and particles carry the picture.
    const emis = scenePass.getTextureNode('emissive').rgb;
    let rgb = mix(lit, lit.mul(0.36).add(emis.mul(0.64)), this.flowDim).add(glow.rgb);
    // Control Room grade: lower exposure, cooler, less saturated. Never changes simulated time.
    const graded = saturation(rgb.mul(vec3(0.42, 0.47, 0.6)), float(0.55));
    rgb = mix(rgb, graded, this.grade);
    const beauty = vec4(rgb, 1);
    // TRAA is opt-in (?aa=traa) until verified on a GPU: under software rendering it produced uniform frames.
    const useTraa = new URLSearchParams(location.search).get('aa') === 'traa';
    pipeline.outputNode = useTraa
      ? traa(beauty, depth, scenePass.getTextureNode('velocity'), this.camera)
      : smaa(beauty);
    this.pipeline = pipeline;
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme && this.themeApplied) return;
    this.themeApplied = true;
    this.theme = theme;
    this.grade.value = theme === 'control' ? 1 : 0;
    if (this.flow && this.lens === 'flow') this.applyLens();
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(theme === 'control' ? 0x1a2230 : 0xc9d3dc);
    fog.density = theme === 'control' ? 0.00011 : 0.00007;
    this.needsEnv = true;
  }

  setLens(lens: Lens): void {
    if (lens === 'circuit') lens = 'physical';
    if (lens === this.lens) return;
    this.lens = lens;
    this.applyLens();
  }

  private applyLens(): void {
    const on = this.lens === 'flow';
    this.flow.setActive(false, [], false);
    if (on) this.flow.setActive(true, [this.station.group, this.surroundings.group], this.theme === 'control');
    this.flowDim.value = on ? 1 : 0;
  }

  /** Screen-space angle (radians, 0 = right, clockwise) of the flow at a component's label, or null when nothing flows. */
  flowArrow(id: ComponentId, at: { x: number; y: number }): number | null {
    const key = ARROW_KEY[id];
    if (!key) return null;
    const v = this.flow.velocityOf(key);
    if (!v) return null;
    const far = this.isNetworkScale();
    const cacheKey = `${id}:${far ? 1 : 0}`;
    let run = this.arrowRuns.get(cacheKey);
    if (!run) {
      const anchor = (far ? this.surroundings.farAnchors.get(id) : null) ?? this.station.anchors.get(id);
      if (!anchor) return null;
      let best: { pts: THREE.Vector3[] } | null = null;
      let bestD = Infinity;
      for (const r of this.flow.runs) {
        if (r.key.key !== key) continue;
        // The longest path near the anchor reads best: prefer spans over droppers.
        const mid = r.path.pts[Math.floor(r.path.pts.length / 2)]!;
        const d = mid.distanceTo(anchor) - Math.min(60, r.path.length) * 0.5;
        if (d < bestD) { bestD = d; best = { pts: r.path.pts }; }
      }
      if (!best) return null;
      run = best;
      this.arrowRuns.set(cacheKey, run);
    }
    const a = run.pts[0]!;
    const b = run.pts[run.pts.length - 1]!;
    const pa = this.projectPoint(a);
    const pb = this.projectPoint(b);
    void at;
    let ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    if (v < 0) ang += Math.PI;
    return ang;
  }

  setState(state: SimState): void {
    this.state = state;
  }

  private resize(): void {
    const c = this.opts.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private bakeEnvironment(): void {
    if (!this.pmrem || !this.envSky) return;
    const src = this.sky.sky as unknown as { sunPosition: { value: THREE.Vector3 } } & Record<string, { value: unknown }>;
    const dst = this.envSky as unknown as Record<string, { value: unknown }>;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity']) dst[k]!.value = src[k]!.value;
    (dst.sunPosition!.value as THREE.Vector3).copy(src.sunPosition.value);
    (dst.showSunDisc as { value: number }).value = 0;
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.04, 1, 30000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = this.theme === 'control' ? 0.14 : 0.22;
  }

  // ---------------------------------------------------------------------------------------
  // Picking and camera
  // ---------------------------------------------------------------------------------------

  private attachPicking(): void {
    const c = this.opts.canvas;
    let down: { x: number; y: number } | null = null;
    c.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const id = this.pick(e.clientX, e.clientY);
      this.onPick?.(id);
    });
  }

  pick(clientX: number, clientY: number): ComponentId | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const owner = h.object.userData.owner as ComponentId | undefined;
      if (owner) return owner;
    }
    return null;
  }

  select(id: ComponentId | null): void {
    this.selected = id;
    const ring = this.selectionRing!;
    if (!id) { ring.visible = false; return; }
    const box = this.bounds.get(id);
    if (!box) { ring.visible = false; return; }
    const anchor = this.surroundings.bounds.has(id) ? null : this.station.anchors.get(id);
    const c = anchor ? anchor.clone() : box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const isTx = id === 'T1' || id === 'T2' || id === 'T3' || id === 'T4';
    const r = isTx ? 11 : this.surroundings.bounds.has(id) ? Math.max(s.x, s.z) * 0.62 : THREE.MathUtils.clamp(Math.min(s.x, s.z) * 0.6, 5, 22);
    ring.scale.set(r, 1, r);
    ring.position.set(c.x, 0.15, c.z);
    ring.visible = true;
  }

  /** Fly to a framed view of a component. */
  flyTo(id: ComponentId, close = false): void {
    const box = this.bounds.get(id);
    if (!box) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const r = Math.max(8, Math.max(s.x, s.z) * (close ? 0.45 : 0.85));
    const az = Math.atan2(this.camera.position.x - c.x, this.camera.position.z - c.z);
    const dist = r * 1.9;
    const y = Math.max(6, c.y + r * 0.7, terrainHeight(c.x + Math.sin(az) * dist, c.z + Math.cos(az) * dist) + 20);
    void this.controls.setLookAt(c.x + Math.sin(az) * dist, y, c.z + Math.cos(az) * dist, c.x, Math.max(2, c.y * 0.8), c.z, true);
  }

  /** Close-up from a fixed direction (used for capture and the guided tour). */
  view(target: [number, number, number], from: [number, number, number], smooth = true): void {
    void this.controls.setLookAt(from[0], from[1], from[2], target[0], target[1], target[2], smooth);
  }

  overview(smooth = true): void {
    const [x, , z] = YARD_CENTRE;
    void this.controls.setLookAt(170, 150, 330, x, 4, z, smooth);
  }

  /** Project label anchors to screen space. */
  project(ids: Iterable<ComponentId>): ProjectedLabel[] {
    const out: ProjectedLabel[] = [];
    const rect = this.opts.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    const far = this.isNetworkScale();
    for (const id of ids) {
      const a = (far ? this.surroundings.farAnchors.get(id) : null) ?? this.station.anchors.get(id);
      if (!a) continue;
      v.copy(a).project(this.camera);
      const distance = this.camera.position.distanceTo(a);
      out.push({ id, x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1, distance });
    }
    return out;
  }

  /** True when the camera is out at network scale, so labels move to the plant they name. */
  isNetworkScale(): boolean {
    const [x, , z] = YARD_CENTRE;
    return Math.hypot(this.camera.position.x - x, this.camera.position.y, this.camera.position.z - z) > 1100;
  }

  /** Project arbitrary world points (static labels). */
  projectPoint(p: THREE.Vector3): { x: number; y: number; visible: boolean; distance: number } {
    const rect = this.opts.canvas.getBoundingClientRect();
    const v = p.clone().project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05, distance: this.camera.position.distanceTo(p) };
  }

  getStats(): StageStats {
    return { ...this.stats, tier: this.tier };
  }

  /** Keep the shadow frustum on what the camera is looking at, sized to the viewing distance. */
  private fitShadows(): void {
    const sun = this.sky.sun;
    const target = this.controls.getTarget(new THREE.Vector3());
    const dist = this.camera.position.distanceTo(target);
    const half = THREE.MathUtils.clamp(dist * 0.7, 28, 1600);
    const texel = (half * 2) / sun.shadow.mapSize.x;
    target.x = Math.round(target.x / texel) * texel;
    target.z = Math.round(target.z / texel) * texel;
    target.y = 0;
    sun.target.position.copy(target);
    const sc = sun.shadow.camera;
    if (Math.abs(sc.right - half) > 0.5) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------------------

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Render one frame with a fixed step (capture mode). */
  async renderFrames(n: number, dt = 1 / 30): Promise<void> {
    for (let i = 0; i < n; i++) this.frame(dt);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  private frame(fixed?: number): void {
    this.clock.update();
    const dt = fixed ?? Math.min(0.1, this.clock.getDelta());
    this.time += dt;
    const t0 = performance.now();
    this.controls.update(dt);
    this.fitShadows();
    if (this.state) {
      const changed = this.sky.update(this.state.t, this.state.weather, this.theme);
      if (changed) this.needsEnv = true;
      this.station.update(this.state, dt, this.time);
      this.surroundings.update(this.state, dt, this.time);
      const viewDist = this.camera.position.distanceTo(this.controls.getTarget(new THREE.Vector3()));
      this.flow.setViewDistance(viewDist);
      this.materials.widen.value = Math.max(0, viewDist * 0.00045 - 0.15);
      // Keep depth precision where the camera is looking: the near plane follows the viewing distance.
      const near = THREE.MathUtils.clamp(viewDist * 0.002, 0.8, 12);
      if (Math.abs(near - this.camera.near) > 0.05) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
      this.flow.update(this.state, dt);
    }
    if (this.needsEnv) { this.bakeEnvironment(); this.needsEnv = false; }
    if (this.selectionRing?.visible) {
      const m = this.selectionRing.material as THREE.MeshBasicNodeMaterial;
      m.opacity = 0.45 + 0.2 * Math.sin(this.time * 3);
    }
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
    this.onFrame?.(this);
    const info = this.renderer.info.render;
    this.stats.drawCalls = info.drawCalls;
    this.stats.triangles = info.triangles;
    this.frames++;
    this.fpsAccum += dt;
    this.stats.frameMs = this.stats.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    if (this.fpsAccum >= 0.5) {
      this.stats.fps = this.frames / this.fpsAccum;
      this.frames = 0;
      this.fpsAccum = 0;
    }
  }
}
