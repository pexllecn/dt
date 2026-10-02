import { Color, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * Uniforms shared by every material in the world, updated once per frame by WorldDirector.
 * Keeping them in one place guarantees that terrain, water, network and assets agree on
 * exaggeration, sun direction, theme and haze.
 */
export const world = {
  /** Vertical exaggeration applied to terrain and to the base height of everything on it. */
  exaggeration: uniform(2.5),
  /**
   * Extra slope applied to shading normals only (not geometry) at national scale, as in a
   * cartographic hillshade, so low Irish relief still reads from 500 km away.
   */
  shadeBoost: uniform(1),
  /** 0 = Specimen, 1 = Control Room (animated during theme changes). */
  themeMix: uniform(0),
  /** Seconds of presentation time, for wave and particle animation. */
  time: uniform(0),
  /** Unit vector towards the sun (scene space). */
  sunDirection: uniform(new Vector3(0.3, 0.6, -0.4)),
  zenith: uniform(new Color('#e4e5e1')),
  horizon: uniform(new Color('#efeae0')),
  glow: uniform(new Color('#f1e6d2')),
  /** Haze density per metre at sea level. */
  hazeDensity: uniform(1 / 900_000),
  /** 0 day .. 1 night. */
  night: uniform(0),
  /** Camera altitude above sea level in metres (for scale-dependent detail). */
  altitude: uniform(300_000),
  // Theme palette (blended)
  terrainLow: uniform(new Color()),
  terrainHigh: uniform(new Color()),
  terrainContext: uniform(new Color()),
  lake: uniform(new Color()),
  seaShallow: uniform(new Color()),
  seaDeep: uniform(new Color()),
  foam: uniform(new Color()),
  contour: uniform(new Color()),
  contourStrength: uniform(0),
  roughness: uniform(0.9),
};
