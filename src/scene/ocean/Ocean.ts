import { DepthTexture, FloatType, Mesh, MeshStandardNodeMaterial, PlaneGeometry, type PerspectiveCamera } from 'three/webgpu';
import {
  cameraFar,
  cameraNear,
  clamp,
  cos,
  dot,
  float,
  length,
  mix,
  mx_fractal_noise_float,
  normalize,
  perspectiveDepthToViewZ,
  positionView,
  positionWorld,
  screenUV,
  cameraPosition,
  select,
  smoothstep,
  transformNormalToView,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
} from 'three/tsl';
import { world } from '../world/uniforms';
import type { N } from '@/lib/tsl';
import { domainEdgeDistance, national, sdfUv } from '../terrain/terrainMaterial';

/**
 * Sea surface. Opaque in look but drawn in the transparent pass so it can read the depth
 * of the land beneath it: shallow tint and the foam line come from the true water depth
 * along the view ray, so the shore is crisp at every zoom.
 */
export class Ocean {
  readonly mesh: Mesh;

  /** @param floatDepth match a reversed-Z (depth32float) framebuffer when copying depth */
  constructor(floatDepth: boolean) {
    const geometry = new PlaneGeometry(14_000_000, 14_000_000, 160, 160);
    geometry.rotateX(-Math.PI / 2);
    const m = new MeshStandardNodeMaterial();
    m.transparent = true;
    m.depthWrite = true;

    const xz = positionWorld.xz;
    const dist = length(positionWorld.sub(cameraPosition));
    const t = world.time;

    // Swell: a few long-crested trains from the south west, fading with distance.
    const wave = (dir: N<'vec2'>, k: number, speed: number, amp: number) => {
      const d = normalize(dir);
      const ph = dot(d, xz).mul(k).sub(t.mul(speed));
      return vec3(d.x.mul(cos(ph)).mul(amp * k), 0, d.y.mul(cos(ph)).mul(amp * k));
    };
    const near = float(1).sub(smoothstep(1500, 26_000, dist));
    const slope = wave(vec2(0.8, -0.6), 0.045, 0.9, 0.35)
      .add(wave(vec2(0.95, -0.2), 0.11, 1.4, 0.12))
      .add(wave(vec2(0.5, -0.85), 0.27, 2.2, 0.05))
      .mul(near);
    const chop = mx_fractal_noise_float(vec3(xz.mul(0.02), t.mul(0.05)), 3, 2.0, 0.5).mul(near).mul(0.08);
    const n = normalize(vec3(slope.x.negate().add(chop), 1, slope.z.negate().sub(chop)));
    m.normalNode = transformNormalToView(n);

    // Shelf colour from the national water SDF (128 m): deeper water farther from land.
    // Beyond the data domain the texture would clamp; treat it as open sea.
    const edge = domainEdgeDistance(xz);
    const inside = smoothstep(2000, 30000, edge);
    const drowned = float(1).sub(smoothstep(6000, 48000, edge)).mul(30000);
    const sdf = mix(float(-16000), national.sdf.sample(sdfUv(xz)).r.sub(drowned).min(float(-1)).max(float(-16000)), inside);
    const shelf = smoothstep(0, 22_000, sdf.negate());
    const broad = mx_fractal_noise_float(vec3(xz.mul(0.00004), t.mul(0.002)), 3, 2.0, 0.5).mul(0.035);
    const base = mix(world.seaShallow, world.seaDeep, shelf).mul(float(1).add(broad));

    // True water thickness along the view ray from the depth of what lies beneath.
    const depthCopy = new DepthTexture(undefined as unknown as number, undefined as unknown as number);
    if (floatDepth) depthCopy.type = FloatType;
    const sceneZ = perspectiveDepthToViewZ((viewportDepthTexture as unknown as (uv: unknown, level: null, d: DepthTexture) => ReturnType<typeof viewportDepthTexture>)(screenUV, null, depthCopy), cameraNear, cameraFar);
    const rawThickness = positionView.z.sub(sceneZ).div(world.exaggeration);
    // Nothing behind the water (cleared depth) or a bad sample reads as open sea.
    const thickness = select(rawThickness.lessThan(0).or(sceneZ.lessThan(cameraFar.mul(-0.5))), float(1e6), rawThickness);
    const shallow = float(1).sub(smoothstep(0, 18, thickness));
    const foamNoise = mx_fractal_noise_float(vec3(xz.mul(0.08), t.mul(0.25)), 2, 2.0, 0.5).mul(0.5).add(0.5);
    const foam = float(1).sub(smoothstep(0, 2.2, thickness)).mul(smoothstep(0.25, 0.7, foamNoise).mul(0.6).add(0.4));
    const colour = mix(mix(base, world.seaShallow.mul(1.06), shallow.mul(0.5)), world.foam, clamp(foam, 0, 1).mul(0.85));

    m.colorNode = vec4(colour, 1);
    m.roughnessNode = mix(float(0.42), float(0.34), world.themeMix.oneMinus()).add(foam.mul(0.4));
    m.metalnessNode = float(0);
    m.fog = true;

    this.mesh = new Mesh(geometry, m);
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 10;
  }

  /** Keep the sea centred under the camera so near-field precision stays high. */
  update(camera: PerspectiveCamera): void {
    const snap = 50_000;
    this.mesh.position.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
  }
}
