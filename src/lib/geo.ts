/**
 * Coordinates. Everything is Irish Transverse Mercator (EPSG:2157) in metres.
 * Scene axes: x = easting - ORIGIN_E, y = up, z = -(northing - ORIGIN_N), so north is -z.
 * The origin is the centre of the data domain (see tools/common.py).
 */
export const DOMAIN_E0 = 320_000;
export const DOMAIN_N0 = 478_000;
export const DOMAIN_SIZE = 524_288;
export const DOMAIN_N1 = DOMAIN_N0 + DOMAIN_SIZE;
export const ORIGIN_E = DOMAIN_E0 + DOMAIN_SIZE / 2;
export const ORIGIN_N = DOMAIN_N0 + DOMAIN_SIZE / 2;

export interface ITM {
  e: number;
  n: number;
}

export function itmToScene(e: number, n: number): [x: number, z: number] {
  return [e - ORIGIN_E, -(n - ORIGIN_N)];
}

export function sceneToItm(x: number, z: number): ITM {
  return { e: x + ORIGIN_E, n: ORIGIN_N - z };
}

// ITM parameters (GRS80 ellipsoid).
const A = 6378137;
const F = 1 / 298.257222101;
const K0 = 0.99982;
const LAT0 = (53.5 * Math.PI) / 180;
const LON0 = (-8 * Math.PI) / 180;
const FE = 600000;
const FN = 750000;
const E2 = F * (2 - F);

function meridionalArc(lat: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * lat -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * lat) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * lat) -
      ((35 * e6) / 3072) * Math.sin(6 * lat))
  );
}

const M0 = meridionalArc(LAT0);

/** WGS84/ETRS89 degrees to ITM metres (transverse Mercator series, sub-metre over Ireland). */
export function lonLatToItm(lonDeg: number, latDeg: number): ITM {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const ep2 = E2 / (1 - E2);
  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const tan = Math.tan(lat);
  const nu = A / Math.sqrt(1 - E2 * sin * sin);
  const T = tan * tan;
  const C = ep2 * cos * cos;
  const Aa = (lon - LON0) * cos;
  const M = meridionalArc(lat);
  const e =
    FE +
    K0 * nu * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * Aa ** 5) / 120);
  const n =
    FN +
    K0 *
      (M -
        M0 +
        nu * tan * ((Aa * Aa) / 2 + ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * Aa ** 6) / 720));
  return { e, n };
}

/** Approximate inverse, good to ~100 m: enough for sun position and labels. */
export function itmToLonLatApprox(e: number, n: number): { lon: number; lat: number } {
  const lat = 53.5 + (n - FN) / 111_250;
  const lon = -8 + (e - FE) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lon, lat };
}
