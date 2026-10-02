/**
 * Solar position (NOAA spreadsheet algorithm). Accurate to well under a degree,
 * which is all the lighting needs. Angles in degrees; azimuth clockwise from north.
 */
export interface SunPosition {
  azimuth: number;
  elevation: number;
}

const rad = Math.PI / 180;

export function sunPosition(dateUtc: Date, latDeg: number, lonDeg: number): SunPosition {
  const jd = dateUtc.getTime() / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545) / 36_525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * rad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * rad) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime =
    (4 / rad) *
    (y * Math.sin(2 * l0 * rad) -
      2 * e * Math.sin(m * rad) +
      4 * e * y * Math.sin(m * rad) * Math.cos(2 * l0 * rad) -
      0.5 * y * y * Math.sin(4 * l0 * rad) -
      1.25 * e * e * Math.sin(2 * m * rad));
  const minutes =
    dateUtc.getUTCHours() * 60 + dateUtc.getUTCMinutes() + dateUtc.getUTCSeconds() / 60;
  let tst = (minutes + eqTime + 4 * lonDeg) % 1440;
  if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  const lat = latDeg * rad;
  const cosZen =
    Math.sin(lat) * Math.sin(decl * rad) + Math.cos(lat) * Math.cos(decl * rad) * Math.cos(ha * rad);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen))) / rad;
  let az: number;
  const denom = Math.cos(lat) * Math.sin(zen * rad);
  if (Math.abs(denom) > 1e-6) {
    const cosAz = (Math.sin(lat) * Math.cos(zen * rad) - Math.sin(decl * rad)) / denom;
    const a = Math.acos(Math.min(1, Math.max(-1, cosAz))) / rad;
    az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  } else {
    az = lat > 0 ? 180 : 0;
  }
  return { azimuth: az, elevation: 90 - zen };
}

/** Irish civil time: GMT in winter, IST (UTC+1) from last Sunday of March to last Sunday of October. */
export function irishLocalToUtc(year: number, month: number, day: number, hours: number): Date {
  const lastSunday = (m: number) => {
    const d = new Date(Date.UTC(year, m + 1, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d;
  };
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const summer = probe >= lastSunday(2) && probe < lastSunday(9);
  const ms = Date.UTC(year, month - 1, day) + (hours - (summer ? 1 : 0)) * 3_600_000;
  return new Date(ms);
}
