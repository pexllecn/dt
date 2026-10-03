import { BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp,
  float,
  fract,
  length,
  varyingProperty,
  mix,
  mx_fractal_noise_float,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { Vector2 } from 'three/webgpu';
import { itmToScene, lonLatToItm } from '@/lib/geo';
import { segmentClip } from '../network/NetworkLayer';
import { world } from '../world/uniforms';

/** Weather state, set each frame from the scenario and clock. */
export const weather = {
  /** 0 clear .. 1 overcast. */
  cloud: uniform(0.4),
  /** 0 none .. 1 heavy (storm only). */
  rain: uniform(0),
  /** Unit vector the wind blows towards (scene x, z). */
  windTo: uniform(new Vector2(0.8, -0.3)),
  /** Reference wind speed, m/s. */
  windMs: uniform(8),
  /** Wind streamlines shown (0..1, faded). */
  streams: uniform(0),
};

const STREAKS = 7_000;
const STREAMS = 1_400;

/**
 * Clouds, rain and wind streamlines. Everything moves in the shaders from the time and wind
 * uniforms, so the layer adds no per-frame work on the main thread. Clouds sit above the
 * land but below the network in draw order, so circuits always read through them.
 */
export class Weather {
  readonly group = new Group();
  private readonly cloudMesh: Mesh;
  private readonly rain: Mesh;
  private readonly streams: Mesh;

  constructor() {
    this.cloudMesh = this.clouds();
    this.rain = this.rainMesh();
    this.streams = this.streamMesh();
    this.group.add(this.cloudMesh, this.rain, this.streams);
  }

  /** Skip passes that would draw nothing (no fragment or vertex work at all). */
  setVisibility(altitude: number, exaggeration: number) {
    this.cloudMesh.visible = weather.cloud.value > 0.05 && altitude > 2_600 * exaggeration * 2.5;
    this.rain.visible = weather.rain.value > 0.01 && altitude < 45_000;
    this.streams.visible = weather.streams.value > 0.01 && altitude > 30_000;
  }

  private clouds(): Mesh {
    const centre = lonLatToItm(-7.9, 53.4);
    const [cx, cz] = itmToScene(centre.e, centre.n);
    const g = new PlaneGeometry(1_600_000, 1_600_000, 1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.fog = true;
    const drift = vec2(weather.windTo.x, weather.windTo.y).mul(weather.windMs.mul(world.time).mul(40));
    const p = positionWorld.xz.sub(drift).div(90_000);
    const n = mx_fractal_noise_float(vec3(p, world.time.mul(0.004)), 4, 2.1, 0.5).mul(0.5).add(0.5);
    const detail = mx_fractal_noise_float(vec3(p.mul(4.3), 1.7), 2).mul(0.12);
    const cover = weather.cloud;
    const density = smoothstep(float(1).sub(cover).sub(0.05), float(1).sub(cover).add(0.3), n.add(detail));
    // Clouds thin out as the camera comes down through them, so close views stay clear.
    const height = float(2_600).mul(world.exaggeration);
    const viewFade = smoothstep(height.mul(2.5), height.mul(8), world.altitude);
    const colour = mix(vec3(0.97, 0.965, 0.95), vec3(0.17, 0.2, 0.24), world.themeMix);
    const shade = mix(float(0.78), float(1), smoothstep(0.3, 0.9, density));
    mat.colorNode = vec4(colour.mul(shade), 1);
    mat.opacityNode = density.mul(mix(float(0.42), float(0.32), world.themeMix)).mul(viewFade).mul(cover.mul(0.6).add(0.4));
    mat.positionNode = Fn(() => {
      const pos = attribute('position', 'vec3');
      return vec3(pos.x, height, pos.z);
    })();
    const mesh = new Mesh(g, mat);
    mesh.position.set(cx, 0, cz);
    mesh.renderOrder = 15;
    mesh.frustumCulled = false;
    mesh.name = 'clouds';
    return mesh;
  }

  /** Rain: streaks in a box that follows the camera, falling and slanting with the wind. */
  private rainMesh(): Mesh {
    const g = new InstancedBufferGeometry();
    g.setAttribute('corner', new BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    const seeds = new Float32Array(STREAKS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute('seed', new InstancedBufferAttribute(seeds, 4));
    g.instanceCount = STREAKS;
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    const seed = attribute('seed', 'vec4');
    const corner = attribute('corner', 'vec2');
    // Box size scales with altitude so rain reads from a few hundred metres to ~20 km up.
    const box = clamp(world.altitude.mul(1.4), 400, 30_000);
    const vNear = varyingProperty('float', 'vRainNear');
    mat.vertexNode = Fn(() => {
      const fall = fract(seed.y.sub(world.time.mul(0.9).div(box.div(600))));
      // World-fixed drops, wrapped into a box centred on the camera.
      const wrapX = fract(seed.x.sub(cameraPosition.x.div(box))).sub(0.5).mul(box);
      const wrapZ = fract(seed.z.sub(cameraPosition.z.div(box))).sub(0.5).mul(box);
      const base = vec3(cameraPosition.x.add(wrapX), cameraPosition.y.add(fall.sub(0.6).mul(box.mul(0.6))), cameraPosition.z.add(wrapZ));
      const len = box.mul(0.025);
      const slant = vec3(weather.windTo.x, 0, weather.windTo.y).mul(weather.windMs.div(25)).mul(len);
      const tip = base.sub(vec3(0, len, 0)).add(slant);
      vNear.assign(length(base.sub(cameraPosition)).div(box));
      return segmentClip(base, tip, corner.x, corner.y, float(0.9));
    })();
    mat.colorNode = vec4(mix(vec3(0.94, 0.95, 0.97), vec3(0.72, 0.82, 0.92), world.themeMix), 1);
    mat.opacityNode = weather.rain.mul(0.45).mul(smoothstep(0.05, 0.18, vNear)).mul(smoothstep(45_000, 8_000, world.altitude)).mul(seed.w.mul(0.6).add(0.4));
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    mesh.name = 'rain';
    return mesh;
  }

  /** Wind streamlines: short dashes drifting with the wind across the island at map scale. */
  private streamMesh(): Mesh {
    const centre = lonLatToItm(-7.9, 53.45);
    const [cx, cz] = itmToScene(centre.e, centre.n);
    const g = new InstancedBufferGeometry();
    g.setAttribute('corner', new BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    const seeds = new Float32Array(STREAMS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute('seed', new InstancedBufferAttribute(seeds, 4));
    g.instanceCount = STREAMS;
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    const seed = attribute('seed', 'vec4');
    const corner = attribute('corner', 'vec2');
    const span = 620_000;
    const vLife = fract(world.time.mul(weather.windMs.div(60)).add(seed.w));
    mat.vertexNode = Fn(() => {
      const life = vLife;
      const dir = vec3(weather.windTo.x, 0, weather.windTo.y);
      const side = vec3(dir.z.negate(), 0, dir.x);
      // A gentle meander so the field reads as flow rather than rain.
      const wobble = sin(seed.x.mul(40).add(life.mul(3))).mul(4_000);
      const travel = life.mul(45_000);
      const base = vec3(seed.x.sub(0.5).mul(span).add(cx), float(2_500), seed.z.sub(0.5).mul(span).add(cz))
        .add(dir.mul(travel))
        .add(side.mul(wobble));
      const len = weather.windMs.mul(280).add(2_000);
      return segmentClip(base, base.add(dir.mul(len)), corner.x, corner.y, float(0.55));
    })();
    const fade = smoothstep(0, 0.2, vLife).mul(float(1).sub(smoothstep(0.75, 1, vLife)));
    mat.colorNode = vec4(mix(vec3(0.2, 0.27, 0.34), vec3(0.62, 0.78, 0.88), world.themeMix), 1);
    mat.opacityNode = weather.streams.mul(fade).mul(0.4).mul(smoothstep(30_000, 120_000, world.altitude)).mul(abs(seed.y.sub(0.5)).add(0.5));
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;
    mesh.name = 'wind-streams';
    return mesh;
  }
}

/** Weather for a scenario at an hour (synthetic, scripted). */
export function weatherFor(scenario: string, hours: number, front?: { arrivalHour: number }): { cloud: number; rain: number; windFromDeg: number; ms: number } {
  if (scenario === 'storm') {
    const a = front?.arrivalHour ?? 9;
    const t = Math.max(0, Math.min(1, (hours - (a - 2)) / 3));
    const after = Math.max(0, Math.min(1, (hours - (a + 6)) / 3));
    const rain = Math.max(0, Math.min(1, (hours - (a - 0.5)) / 1.5)) * (1 - after * 0.8);
    return { cloud: 0.55 + 0.4 * t - 0.25 * after, rain, windFromDeg: 225 + 65 * after, ms: 9 + 9 * t - 4 * after };
  }
  if (scenario === 'y2034') return { cloud: 0.55, rain: 0, windFromDeg: 250, ms: 7 };
  return { cloud: 0.42, rain: 0, windFromDeg: 245, ms: 8 };
}

// Rehearsal and test hook (read-only by convention).
Object.assign(globalThis as unknown as Record<string, unknown>, { __twinWeather: weather });
