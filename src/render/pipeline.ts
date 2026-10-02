import { RenderPipeline, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import {
  unpackRGBToNormal,
  packNormalToRGB,
  float,
  length,
  mix,
  mrt,
  normalView,
  output,
  pass,
  sample,
  screenUV,
  smoothstep,
  uniform,
  vec4,
  velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { FloatU } from '@/lib/tsl';

export interface Pipeline {
  render(): void;
  aoStrength: FloatU;
  vignette: FloatU;
  setAoRadius(r: number): void;
  setBloom(strength: number, threshold: number): void;
  dispose(): void;
}

/**
 * Scene pass with MRT (colour, view normal, velocity) feeding GTAO, temporal reprojection
 * anti-aliasing (essential for thin conductors and lattice members), restrained bloom and a
 * subtle vignette. Tone mapping and colour space conversion happen at the output.
 */
export function createPipeline(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera): Pipeline {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
  const colour = scenePass.getTextureNode('output');
  const normalTex = scenePass.getTextureNode('normal');
  const depth = scenePass.getTextureNode('depth');
  const vel = scenePass.getTextureNode('velocity');

  const sceneNormal = sample((uv) => unpackRGBToNormal(normalTex.sample(uv)));
  const aoPass = ao(depth, sceneNormal, camera);
  aoPass.resolutionScale = 0.5;
  const aoStrength = uniform(0.65);
  const aoTex = aoPass.getTextureNode();
  const occluded = vec4(colour.rgb.mul(mix(float(1), aoTex.sample(screenUV).r, aoStrength)), colour.a);

  const aa = traa(occluded, depth, vel, camera);
  const bloomPass = bloom(aa, 0.15, 0.45, 0.9);
  const vignette = uniform(0.18);
  const v = smoothstep(0.9, 0.3, length(screenUV.sub(0.5)));
  const graded = aa.add(bloomPass).mul(mix(float(1).sub(vignette), float(1), v));
  pipeline.outputNode = graded;

  return {
    render: () => pipeline.render(),
    aoStrength,
    vignette,
    setAoRadius(r: number) {
      aoPass.radius.value = r;
    },
    setBloom(strength: number, threshold: number) {
      bloomPass.strength.value = strength;
      bloomPass.threshold.value = threshold;
    },
    dispose: () => pipeline.dispose(),
  };
}
