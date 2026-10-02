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

export const m3Shots: Shot[] = [
  { name: 'specimen-national-1500', query: 'hours=15' },
  { name: 'specimen-national-1800', query: 'hours=18' },
  { name: 'control-national-2100', query: 'theme=control&hours=21' },
  { name: 'specimen-regional-mayo-1800', query: 'view=-9.3,54.05,45000,58,200&hours=18', settleMs: 24_000 },
  { name: 'control-regional-dublin-1900', query: 'theme=control&view=-6.35,53.36,30000,55,180&hours=19', settleMs: 24_000 },
  { name: 'control-regional-northwest-1800', query: 'theme=control&view=-8.3,54.4,90000,50,190&hours=18', settleMs: 24_000 },
  { name: 'specimen-national-webgl', query: 'backend=webgl&hours=15' },
];

export const m4Shots: Shot[] = [
  { name: 'specimen-flagford-substation-1500', query: 'view=-8.1239,53.9117,650,58,150&hours=15', settleMs: 30_000 },
  { name: 'control-flagford-substation-1900', query: 'theme=control&view=-8.1239,53.9117,650,58,150&hours=19', settleMs: 30_000 },
  { name: 'specimen-400kv-tower-1600', query: 'view=-8.0086,52.8440,420,72,130&hours=16', settleMs: 30_000 },
  { name: 'specimen-oweninny-turbines-1100', query: 'view=-9.6150,54.1450,1400,68,160&hours=11', settleMs: 30_000 },
  { name: 'specimen-bellacorick-site-1700', query: 'view=-9.5735,54.1180,1300,60,200&hours=17', settleMs: 30_000 },
  { name: 'control-clonee-campus-1830', query: 'theme=control&view=-6.419,53.4135,1500,62,210&hours=18.5', settleMs: 30_000 },
];
