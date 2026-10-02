export interface TerrainManifest {
  domain: { e0: number; n1: number; size: number; crs: string };
  tilePx: number;
  encoding: { hOffset: number; hScale: number; sdfRange: number; sdfScale: number };
  levels: Record<string, { spacing: number; tiles: [number, number][] }>;
  focusRegions: Record<string, [number, number, number]>;
  national: { samples: number; spacing: number };
  sources: { name: string; label: string; licence: string }[];
  contentHash: string;
  bytes: number;
}

export const DATA_ROOT = `${import.meta.env.BASE_URL}data/terrain`;

export async function loadManifest(): Promise<TerrainManifest> {
  const r = await fetch(`${DATA_ROOT}/manifest.json`);
  if (!r.ok) throw new Error(`terrain manifest: HTTP ${r.status}`);
  return (await r.json()) as TerrainManifest;
}
