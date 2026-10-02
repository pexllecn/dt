import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import { itmToScene } from '@/lib/geo';
import { world } from '@/scene/world/uniforms';

/**
 * A narrow window from the DOM overlays into the 3D scene: projecting ITM positions to the
 * screen and picking network branches under the cursor. Filled in by the Stage once ready.
 */
export const bridge = {
  camera: null as PerspectiveCamera | null,
  heightAt: null as ((x: number, z: number) => number) | null,
  pickBranch: null as ((px: number, py: number, w: number, h: number) => number) | null,
};

const v = new Vector3();

/** Screen position (CSS px) of an ITM point at ground level plus a lift in metres; null if behind the camera. */
export function project(e: number, n: number, lift: number, w: number, h: number): { x: number; y: number; depth: number } | null {
  const cam = bridge.camera;
  if (!cam) return null;
  const [x, z] = itmToScene(e, n);
  const g = bridge.heightAt ? Math.max(0, bridge.heightAt(x, z)) : 0;
  v.set(x, g * world.exaggeration.value + lift, z);
  const depth = v.distanceTo(cam.position);
  v.project(cam);
  if (v.z > 1 || v.z < -1) return null;
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, depth };
}
