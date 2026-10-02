import { Color } from 'three/webgpu';
import type { ThemeId } from '@/config/themes';

/**
 * Art-directed sky and light model keyed by sun elevation (degrees).
 * Sun direction is physical (solar position for the scenario date and place);
 * colours are art-directed per theme so both themes read as finished at any hour.
 */
export interface LightingState {
  zenith: Color;
  horizon: Color;
  glow: Color; // sun-side horizon glow
  sunColor: Color;
  sunIntensity: number;
  fillColor: Color;
  fillIntensity: number;
  envIntensity: number;
  night: number; // 0 day .. 1 full night (drives emissive network, lit windows)
  exposure: number; // simple eye adaptation so dusk and night stay legible
}

type Key = [elevation: number, zenith: string, horizon: string, glow: string];

const skyKeys: Record<ThemeId, Key[]> = {
  specimen: [
    [-18, '#232832', '#2e333d', '#2e333d'],
    [-8, '#39404e', '#4f5260', '#5e5560'],
    [-3, '#6f7a8c', '#a59aa0', '#c99a7e'],
    [2, '#b9c0c8', '#e6d3bd', '#f0b98a'],
    [8, '#d8dcdc', '#eee3d0', '#f2d6ae'],
    [20, '#e2e3df', '#efeae0', '#f1e6d2'],
    [60, '#e4e5e1', '#efeae0', '#efeae0'],
  ],
  control: [
    [-18, '#05070a', '#080b0f', '#080b0f'],
    [-6, '#06080c', '#0d1116', '#11131a'],
    [0, '#090c11', '#15181e', '#20191a'],
    [8, '#0b0f14', '#14191f', '#181a1e'],
    [60, '#0c1015', '#141920', '#151a1f'],
  ],
};

const tmpA = new Color();
const tmpB = new Color();

function sampleKeys(keys: Key[], e: number, index: 1 | 2 | 3, out: Color): Color {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (e <= first[0]) return out.set(first[index]);
  if (e >= last[0]) return out.set(last[index]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (e >= a[0] && e <= b[0]) {
      const t = (e - a[0]) / (b[0] - a[0]);
      tmpA.set(a[index]);
      tmpB.set(b[index]);
      return out.copy(tmpA).lerp(tmpB, t);
    }
  }
  return out.set(last[index]);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function computeLighting(theme: ThemeId, elevation: number, out?: LightingState): LightingState {
  const s =
    out ??
    ({
      zenith: new Color(),
      horizon: new Color(),
      glow: new Color(),
      sunColor: new Color(),
      sunIntensity: 0,
      fillColor: new Color(),
      fillIntensity: 0,
      envIntensity: 0,
      night: 0,
      exposure: 1,
    } satisfies LightingState);
  const keys = skyKeys[theme];
  sampleKeys(keys, elevation, 1, s.zenith);
  sampleKeys(keys, elevation, 2, s.horizon);
  sampleKeys(keys, elevation, 3, s.glow);

  // Sun colour warms through the last ten degrees, as air mass increases.
  const warm = 1 - smooth(-1, 22, elevation);
  s.sunColor.setRGB(1, 0.96 - 0.36 * warm, 0.9 - 0.6 * warm);
  const day = smooth(-2.5, 2.5, elevation);
  const high = smooth(0, 30, elevation);
  // Low sun stays strong (raking light at golden hour); ambient falls faster so relief deepens.
  s.sunIntensity = day * (theme === 'specimen' ? 2.6 + 0.8 * high : 1.6 + 0.4 * high);
  s.night = 1 - smooth(-7, 3, elevation);
  s.exposure = 1 + 0.55 * (1 - high) + 0.5 * s.night;

  // Fill: a soft lamp from the north west, as in a gallery. Keeps the relief legible at any hour.
  if (theme === 'specimen') {
    s.fillColor.setRGB(0.92, 0.95, 1.0);
    s.fillIntensity = 0.22 + 0.12 * high;
    s.envIntensity = 0.2 + 0.22 * high;
  } else {
    s.fillColor.setRGB(0.62, 0.74, 0.88);
    s.fillIntensity = 0.3 + 0.15 * day;
    s.envIntensity = 0.3 + 0.3 * day;
  }
  return s;
}
