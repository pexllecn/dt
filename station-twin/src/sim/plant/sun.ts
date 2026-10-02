/** Solar position (NOAA approximation, accurate to a fraction of a degree) and solar availability. */
import { PLANT, SITE } from '../../config/assumptions.ts';

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

export function sunPosition(epochUtcMs: number, t: number, lat = SITE.latitude.value, lon = SITE.longitude.value): SunPosition {
  const ms = epochUtcMs + t * 1000;
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((ms - start) / 86400000) + 1;
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMin = hours * 60 + eqTime + 4 * lon;
  const ha = (trueSolarMin / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const elevation = 90 - zenith / RAD;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
  return { elevation, azimuth: (az + 360) % 360 };
}

/** Available solar output as a fraction of capacity, from sun elevation and cloud cover (0 to 1). */
export function solarFraction(elevationDeg: number, cloud: number): number {
  if (elevationDeg <= 0) return 0;
  const clear = Math.min(1, PLANT.solarGain.value * Math.pow(Math.sin(elevationDeg * RAD), PLANT.solarExponent.value));
  return clear * (1 - PLANT.cloudAttenuation.value * Math.max(0, Math.min(1, cloud)));
}
