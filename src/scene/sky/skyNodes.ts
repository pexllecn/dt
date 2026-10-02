import { cameraPosition, clamp, dot, exp, float, fog, length, max, mix, normalize, positionWorld, positionWorldDirection, pow, smoothstep, vec3 } from 'three/tsl';
import { world } from '../world/uniforms';
import type { N } from '@/lib/tsl';

/** Colour of the sky in a given direction: zenith to horizon gradient plus a soft sun-side glow. */
export const skyColour = (dir: N<'vec3'>) => {
  const up = clamp(dir.y, -0.2, 1);
  const g = pow(clamp(up, 0, 1), 0.45);
  const base = mix(world.horizon, world.zenith, g);
  const sunAmt = pow(max(dot(normalize(dir), world.sunDirection), 0), 4);
  const horizonBand = float(1).sub(smoothstep(0, 0.35, up));
  const glow = mix(base, world.glow, sunAmt.mul(horizonBand).mul(0.75));
  // Below the horizon: fade to the haze colour so the sea meets the sky without a seam.
  return mix(glow, world.horizon, smoothstep(0, -0.08, up));
};

export function createBackgroundNode() {
  return skyColour(positionWorldDirection);
}

/**
 * Aerial perspective: exponential haze thinning with height, coloured by the sky in the
 * view direction so distant land takes on the horizon colour (and the dusk glow on the sun side).
 */
export function createHazeNode() {
  const toFrag = positionWorld.sub(cameraPosition);
  const dist = length(toFrag);
  const dir = toFrag.div(dist);
  const meanHeight = max(positionWorld.y.add(cameraPosition.y).mul(0.5), 0);
  const density = world.hazeDensity.mul(exp(meanHeight.div(-9000)));
  const factor = clamp(float(1).sub(exp(dist.mul(density).negate())), 0, 0.92);
  const colour = skyColour(vec3(dir.x, dir.y.mul(0.25), dir.z));
  return fog(colour, factor);
}
