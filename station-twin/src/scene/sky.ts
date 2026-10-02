/**
 * Sky, sun and environment lighting, driven by the simulation clock. The sun's direction comes
 * from solar geometry for the station's latitude and date. Themes change the grade, never the time.
 */
import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { SITE } from '../config/assumptions.ts';
import { sunPosition } from '../sim/plant/sun.ts';
import type { Materials } from './materials.ts';

export type Theme = 'daylight' | 'control';

export interface SkyRig {
  floods: THREE.SpotLight[];
  sky: SkyMesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Update for a simulation time; returns true when the environment map should be re-baked. */
  update(t: number, weather: { cloud: number; storm: boolean; rain: number }, theme: Theme): boolean;
  elevation: number;
}

export function createSky(scene: THREE.Scene, materials: Materials, focus: THREE.Vector3): SkyRig {
  const sky = new SkyMesh();
  sky.scale.setScalar(18000);
  sky.turbidity.value = 6;
  sky.rayleigh.value = 1.4;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.82;
  sky.cloudCoverage.value = 0.45;
  sky.cloudDensity.value = 0.5;
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260; sc.near = 10; sc.far = 2200;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.12;
  sun.target.position.copy(focus);
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xcfdcec, 0x4c5a3a, 0.6);
  scene.add(hemi);

  // Yard floodlights on the lighting masts, switched by the photocell at dusk.
  const floods: THREE.SpotLight[] = [];
  const masts: [number, number][] = [[-200, -100], [-200, 70], [-120, -120], [-120, 125], [-55, -10], [10, -130], [10, 85], [95, 70], [-150, 0], [-60, 70]];
  for (const [x, z] of masts) {
    const l = new THREE.SpotLight(0xfff1dc, 0, 0, Math.PI * 0.36, 0.55, 1.6);
    l.position.set(x, 25, z);
    l.target.position.set(x + Math.sign(-55 - x) * 18, 0, z + Math.sign(-z) * 18);
    scene.add(l, l.target);
    floods.push(l);
  }

  const dir = new THREE.Vector3();
  let lastKey = '';
  const rig: SkyRig = {
    sky, sun, hemi, floods, elevation: 0,
    update(t, weather, theme) {
      const p = sunPosition(SITE.epochUtcMs.value, t);
      rig.elevation = p.elevation;
      const el = THREE.MathUtils.degToRad(p.elevation);
      const az = THREE.MathUtils.degToRad(p.azimuth);
      // x east, z south: azimuth is clockwise from north.
      dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      sky.sunPosition.value.copy(dir);
      const day = THREE.MathUtils.smoothstep(p.elevation, -6, 8);
      const low = 1 - THREE.MathUtils.smoothstep(p.elevation, 2, 25);
      const overcast = Math.min(1, weather.cloud * 1.1);
      sky.cloudCoverage.value = 0.25 + overcast * 0.7;
      sky.cloudDensity.value = 0.35 + overcast * 0.55;
      sky.turbidity.value = 4 + overcast * 8 + (weather.storm ? 6 : 0);
      sky.rayleigh.value = weather.storm ? 0.6 : 1.3 + low * 0.8;
      sun.position.copy(dir).multiplyScalar(1000).add(sun.target.position);
      const directStrength = Math.max(0, Math.sin(el)) > 0 ? 1 : 0;
      sun.intensity = directStrength * day * (9.0 - overcast * 4.5) * (weather.storm ? 0.3 : 1);
      sun.color.setHSL(0.09, 0.55 * low + 0.1, 0.9 - low * 0.12);
      hemi.intensity = (0.16 + day * 0.4) * (weather.storm ? 0.6 : 1);
      hemi.color.setHSL(0.6, 0.35 - day * 0.1, 0.32 + day * 0.48);
      hemi.groundColor.setHSL(0.22, 0.25, 0.08 + day * 0.19);
      const night = 1 - THREE.MathUtils.smoothstep(p.elevation, -4, 3);
      materials.night.value = night;
      for (const f of floods) { f.intensity = night * 4200; f.visible = night > 0.01; }
      const key = `${Math.round(p.elevation / 1.5)}|${Math.round(p.azimuth / 6)}|${Math.round(overcast * 6)}|${weather.storm}|${theme}`;
      const changed = key !== lastKey;
      lastKey = key;
      return changed;
    },
  };
  return rig;
}
