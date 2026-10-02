import {
  AgXToneMapping,
  Color,
  DirectionalLight,
  PMREMGenerator,
  Scene,
  Vector3,
  type PerspectiveCamera,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import { palettes, type ThemeId } from '@/config/themes';
import { itmToLonLatApprox, sceneToItm } from '@/lib/geo';
import { irishLocalToUtc, sunPosition } from '@/lib/solar';
import { frameStats, type WorldState } from '@/app/store';
import { createPipeline, type Pipeline } from '@/render/pipeline';
import { loadManifest } from './terrain/manifest';
import { TileStore } from './terrain/TileStore';
import { Terrain } from './terrain/Terrain';
import { national } from './terrain/terrainMaterial';
import { Ocean } from './ocean/Ocean';
import { createBackgroundNode, createHazeNode } from './sky/skyNodes';
import { computeLighting, type LightingState } from './world/lighting';
import { world } from './world/uniforms';

const debugFlags = new URLSearchParams(location.search);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Owns everything in the world that is not React: terrain, sea, sky, light, post-processing.
 * Updated once per frame from the store and the camera.
 */
export class WorldRuntime {
  readonly scene: Scene;
  readonly terrain: Terrain;
  readonly ocean: Ocean;
  readonly sun = new DirectionalLight(0xffffff, 2);
  readonly fill = new DirectionalLight(0xffffff, 0.4);
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGPURenderer;
  private readonly pipeline: Pipeline;
  private readonly lighting: LightingState;
  private readonly sunDir = new Vector3();
  private readonly target = new Vector3();
  private readonly skyScene = new Scene();
  private readonly pmrem: PMREMGenerator;
  private envTexture: Texture | null = null;
  private envKey = '';
  private themeBlend = 0;
  private readonly blendA = new Color();
  private readonly blendB = new Color();

  static async create(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, onProgress?: (m: string) => void) {
    onProgress?.('Loading terrain');
    const manifest = await loadManifest();
    const store = new TileStore(manifest);
    await store.preload(3);
    onProgress?.('Loading coastline');
    const { sdf, mask } = await store.loadNational();
    national.sdf.value = sdf;
    national.mask.value = mask;
    return new WorldRuntime(renderer, scene, camera, store);
  }

  private constructor(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, store: TileStore) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.terrain = new Terrain(store);
    this.ocean = new Ocean(renderer.reversedDepthBuffer === true);
    scene.add(this.terrain.group, this.ocean.mesh);
    this.ocean.mesh.visible = !debugFlags.has('noocean');

    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = !debugFlags.has('noshadow');

    scene.backgroundNode = createBackgroundNode();
    scene.fogNode = createHazeNode();
    this.skyScene.backgroundNode = createBackgroundNode();
    this.pmrem = new PMREMGenerator(renderer);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 2_000_000;
    scene.add(this.sun, this.sun.target, this.fill, this.fill.target);

    this.lighting = computeLighting('specimen', 30);
    this.pipeline = createPipeline(renderer, scene, camera);
  }

  /** Point the camera orbits around (for shadow framing and the sun's local latitude). */
  setFocus(target: Vector3) {
    this.target.copy(target);
  }

  update(state: Pick<WorldState, 'theme' | 'date' | 'hours'>, dt: number): void {
    const cam = this.camera;
    const altitude = Math.max(1, cam.position.y);
    world.time.value += dt;
    world.altitude.value = altitude;

    // Vertical exaggeration: 2.5x at national scale, true scale for site views.
    const ex = 1 + 1.5 * smooth(2_500, 30_000, altitude);
    world.exaggeration.value = ex;
    world.shadeBoost.value = 1 + 1.2 * smooth(60_000, 350_000, altitude);

    // Theme cross-fade.
    const goal = state.theme === 'control' ? 1 : 0;
    this.themeBlend += (goal - this.themeBlend) * Math.min(1, dt * 3.5);
    if (Math.abs(goal - this.themeBlend) < 1e-3) this.themeBlend = goal;
    world.themeMix.value = this.themeBlend;
    this.applyPalette();

    // Sun from the scenario date and clock, at the focus point's latitude and longitude.
    const itm = sceneToItm(this.target.x, this.target.z);
    const ll = itmToLonLatApprox(itm.e, itm.n);
    const utc = irishLocalToUtc(state.date.y, state.date.m, state.date.d, state.hours);
    const sp = sunPosition(utc, ll.lat, ll.lon);
    const az = (sp.azimuth * Math.PI) / 180;
    const el = (sp.elevation * Math.PI) / 180;
    // Scene: x east, z south. Azimuth clockwise from north.
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    world.sunDirection.value.copy(this.sunDir);

    const themeId: ThemeId = this.themeBlend > 0.5 ? 'control' : 'specimen';
    const L = computeLighting(themeId, sp.elevation, this.lighting);
    const other = computeLighting(themeId === 'control' ? 'specimen' : 'control', sp.elevation);
    const tb = themeId === 'control' ? 1 - this.themeBlend : this.themeBlend;
    world.zenith.value.copy(L.zenith).lerp(other.zenith, tb);
    world.horizon.value.copy(L.horizon).lerp(other.horizon, tb);
    world.glow.value.copy(L.glow).lerp(other.glow, tb);
    world.night.value = L.night;
    this.renderer.toneMappingExposure = L.exposure * (1 - 0.25 * tb) + other.exposure * 0.25 * tb;

    // Sun light, kept above the horizon a touch so the shadow camera stays valid at dusk.
    const shadowSpan = Math.min(420_000, Math.max(3_000, altitude * 1.6));
    const lightDir = this.sunDir.clone();
    lightDir.y = Math.max(lightDir.y, 0.03);
    lightDir.normalize();
    this.sun.position.copy(this.target).addScaledVector(lightDir, shadowSpan * 2);
    this.sun.target.position.copy(this.target);
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sunIntensity * (1 - 0.3 * tb);
    const sc = this.sun.shadow.camera;
    sc.left = -shadowSpan;
    sc.right = shadowSpan;
    sc.top = shadowSpan;
    sc.bottom = -shadowSpan;
    sc.near = 1;
    sc.far = shadowSpan * 4;
    sc.updateProjectionMatrix();
    this.sun.shadow.normalBias = shadowSpan / 4096 * 0.8;

    // Fill: gallery lamp from the north west, high.
    this.fill.position.copy(this.target).add(new Vector3(-0.55, 0.75, -0.55).multiplyScalar(100_000));
    this.fill.target.position.copy(this.target);
    this.fill.color.copy(L.fillColor);
    this.fill.intensity = L.fillIntensity;

    this.updateEnvironment(themeId, sp.elevation, L.envIntensity);

    // Post: AO radius follows viewing scale; bloom stronger on the dark theme and at night.
    this.pipeline.setAoRadius(Math.min(4000, Math.max(3, altitude * 0.015)));
    this.pipeline.setBloom((0.15 + 0.35 * L.night) * this.themeBlend + 0.2 * L.night, 0.92 - 0.2 * L.night);

    // Camera clip planes adapt to altitude (reversed depth keeps precision).
    const near = Math.min(400, Math.max(0.5, altitude * 0.0012));
    if (Math.abs(cam.near - near) / near > 0.2) {
      cam.near = near;
      cam.far = 6_000_000;
      cam.updateProjectionMatrix();
    }

    this.terrain.update(cam);
    this.ocean.update(cam);

    frameStats.altitude = altitude;
    frameStats.exaggeration = ex;
    frameStats.terrainNodes = this.terrain.stats.nodes;
  }

  private applyPalette() {
    const a = palettes.specimen;
    const b = palettes.control;
    const t = this.themeBlend;
    const mixColour = (u: { value: Color }, ca: string, cb: string) =>
      u.value.copy(this.blendA.set(ca)).lerp(this.blendB.set(cb), t);
    mixColour(world.terrainLow, a.terrainLow, b.terrainLow);
    mixColour(world.terrainHigh, a.terrainHigh, b.terrainHigh);
    mixColour(world.terrainContext, a.terrainContext, b.terrainContext);
    mixColour(world.lake, a.lake, b.lake);
    mixColour(world.seaShallow, a.seaShallow, b.seaShallow);
    mixColour(world.seaDeep, a.seaDeep, b.seaDeep);
    mixColour(world.foam, a.foam, b.foam);
    mixColour(world.contour, a.contour, b.contour);
    world.contourStrength.value = a.contourStrength + (b.contourStrength - a.contourStrength) * t;
    world.roughness.value = a.roughness + (b.roughness - a.roughness) * t;
    world.hazeDensity.value = a.hazeDensity + (b.hazeDensity - a.hazeDensity) * t;
  }

  /** Re-bake image-based lighting from the sky when the sun or theme has moved enough. */
  private updateEnvironment(theme: ThemeId, elevation: number, intensity: number) {
    const key = `${theme}:${Math.round(elevation / 2)}`;
    this.scene.environmentIntensity = intensity;
    if (key === this.envKey) return;
    this.envKey = key;
    const rt = this.pmrem.fromScene(this.skyScene, 0.04);
    this.envTexture?.dispose();
    this.envTexture = rt.texture;
    this.scene.environment = rt.texture;
  }

  render(renderer?: WebGPURenderer): void {
    if (renderer && debugFlags.has('nopost')) renderer.render(this.scene, this.camera);
    else this.pipeline.render();
  }

  dispose(): void {
    this.pipeline.dispose();
    this.pmrem.dispose();
  }
}
