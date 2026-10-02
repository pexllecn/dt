import { useFrame, useThree } from '@react-three/fiber';
import CameraControls from 'camera-controls';
import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';
import {
  Box3,
  Matrix4,
  Quaternion,
  Raycaster,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
  type PerspectiveCamera,
} from 'three/webgpu';
import { itmToScene, lonLatToItm } from '@/lib/geo';
import type { Terrain } from '@/scene/terrain/Terrain';
import { world } from '@/scene/world/uniforms';

CameraControls.install({ THREE: { Box3, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } });

export interface ControlsHandle {
  target(): Vector3;
  setTerrain(t: Terrain): void;
  controls: CameraControls;
}

/** National framing: the island seen from the south, slightly west. */
export function nationalView(c: CameraControls, smooth = false) {
  const centre = lonLatToItm(-7.8, 53.28);
  const [x, z] = itmToScene(centre.e, centre.n);
  const dist = 780_000;
  const polar = (34 * Math.PI) / 180;
  const az = (-10 * Math.PI) / 180; // camera a little west of due south
  return c.setLookAt(
    x + dist * Math.sin(polar) * Math.sin(az),
    dist * Math.cos(polar),
    z + dist * Math.sin(polar) * Math.cos(az),
    x,
    0,
    z,
    smooth,
  );
}

/**
 * Explore mode camera. Left drag orbits, right drag pans across the land, wheel zooms
 * towards the cursor. The camera never goes below the terrain.
 */
export const ExploreControls = forwardRef<ControlsHandle>(function ExploreControls(_, ref) {
  const { camera, gl } = useThree();
  const controls = useMemo(() => new CameraControls(camera as PerspectiveCamera, gl.domElement), [camera, gl]);
  const terrainRef = useMemo(() => ({ current: null as Terrain | null }), []);
  const tmp = useMemo(() => new Vector3(), []);

  useEffect(() => {
    controls.minDistance = 150;
    controls.maxDistance = 1_400_000;
    controls.dollyToCursor = true;
    controls.infinityDolly = false;
    controls.smoothTime = 0.35;
    controls.draggingSmoothTime = 0.18;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
    controls.mouseButtons.right = CameraControls.ACTION.TRUCK;
    controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
    const params = new URLSearchParams(location.search);
    const view = params.get('view');
    if (view) {
      const [lon, lat, dist, polar, az] = view.split(',').map(Number) as [number, number, number, number, number];
      const p = lonLatToItm(lon, lat);
      const [x, z] = itmToScene(p.e, p.n);
      const r = dist;
      const pol = ((polar ?? 50) * Math.PI) / 180;
      const azr = ((az ?? 0) * Math.PI) / 180;
      controls.setLookAt(
        x + r * Math.sin(pol) * Math.sin(azr),
        r * Math.cos(pol),
        z + r * Math.sin(pol) * Math.cos(azr),
        x,
        0,
        z,
        false,
      );
    } else {
      void nationalView(controls);
    }
    return () => controls.dispose();
  }, [controls]);

  useImperativeHandle(
    ref,
    () => ({
      target: () => controls.getTarget(tmp),
      setTerrain: (t: Terrain) => {
        terrainRef.current = t;
      },
      controls,
    }),
    [controls, terrainRef, tmp],
  );

  useFrame((_, delta) => {
    controls.update(delta);
    const t = terrainRef.current;
    if (!t) return;
    // Keep the camera above ground and the orbit target on it.
    const ex = world.exaggeration.value;
    const p = camera.position;
    const ground = Math.max(0, t.heightAt(p.x, p.z)) * ex;
    const clearance = 40 + 0.02 * Math.max(0, p.y - ground);
    if (p.y < ground + clearance) {
      const target = controls.getTarget(tmp);
      controls.setLookAt(p.x, ground + clearance, p.z, target.x, target.y, target.z, false);
    }
  }, -1);

  return null;
});
