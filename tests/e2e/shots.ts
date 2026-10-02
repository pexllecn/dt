/** Named views used for milestone screenshots. view = lon,lat,distance(m),polar(deg),azimuth(deg). */
export interface Shot {
  name: string;
  query: string;
  settleMs?: number;
}

const mayo = 'view=-9.55,53.95,60000,60,200';

export const m2Shots: Shot[] = [
  { name: 'specimen-national-1000', query: 'hours=10' },
  { name: 'specimen-national-1430', query: 'hours=14.5' },
  { name: 'specimen-national-1840-dusk', query: 'hours=18.65' },
  { name: 'control-national-1000', query: 'theme=control&hours=10' },
  { name: 'control-national-1430', query: 'theme=control&hours=14.5' },
  { name: 'control-national-2130-night', query: 'theme=control&hours=21.5' },
  { name: 'specimen-regional-mayo-1500', query: `${mayo}&hours=15`, settleMs: 22_000 },
  { name: 'specimen-regional-mayo-1745', query: `${mayo}&hours=17.75`, settleMs: 22_000 },
  { name: 'control-regional-mayo-1100', query: `theme=control&${mayo}&hours=11`, settleMs: 22_000 },
  { name: 'specimen-low-nephin-1600', query: 'view=-9.37,54.01,11000,70,135&hours=16', settleMs: 26_000 },
  { name: 'specimen-national-webgl', query: 'backend=webgl&hours=14.5' },
  { name: 'control-regional-webgl', query: `backend=webgl&theme=control&${mayo}&hours=11`, settleMs: 22_000 },
];
