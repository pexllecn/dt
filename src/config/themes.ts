/**
 * Scene palettes. UI tokens live in styles.css; these drive materials and light.
 * "Specimen": a painted relief model, pasture green on warm paper. "Control Room": dark moss on near-black.
 */
export type ThemeId = 'specimen' | 'control';

export interface ScenePalette {
  ground: string;
  terrainLow: string;
  terrainHigh: string;
  terrainContext: string; // Northern Ireland and Great Britain, greyed
  lake: string;
  seaShallow: string;
  seaDeep: string;
  foam: string;
  contour: string;
  roughness: number;
  sunScale: number;
  fillScale: number;
  envScale: number;
  hazeDensity: number; // per metre at sea level
  contourStrength: number;
}

export const palettes: Record<ThemeId, ScenePalette> = {
  specimen: {
    ground: '#efeae0',
    terrainLow: '#a7be8a',
    terrainHigh: '#b4b79c',
    terrainContext: '#bcc4b0',
    lake: '#8fa9b4',
    seaShallow: '#a9c1c9',
    seaDeep: '#93adb8',
    foam: '#f4f1ea',
    contour: '#8d877b',
    roughness: 0.93,
    sunScale: 2.4,
    fillScale: 0.55,
    envScale: 0.75,
    hazeDensity: 1 / 900_000,
    contourStrength: 0.0,
  },
  control: {
    ground: '#0a0c0f',
    terrainLow: '#34453a',
    terrainHigh: '#4a5348',
    terrainContext: '#2a2f2e',
    lake: '#111a22',
    seaShallow: '#16212b',
    seaDeep: '#0b1117',
    foam: '#3b4650',
    contour: '#6f8797',
    roughness: 0.82,
    sunScale: 1.6,
    fillScale: 0.22,
    envScale: 0.35,
    hazeDensity: 1 / 700_000,
    contourStrength: 0.35,
  },
};
