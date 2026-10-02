/** Data files produced by tools/build_network.py. */
export interface NetNode {
  id: string;
  kind: 'station' | 'tee' | 'plant';
  name: string;
  osmName?: string | null;
  e: number;
  n: number;
  country: 'ROI' | 'NI';
  county: string;
  kvs: number[];
  footprint: number[][] | null;
}

export interface NetBus {
  id: string;
  node: string;
  kv: number;
}

export interface NetBranch {
  id: string;
  from: string;
  to: string;
  kind: 'line' | 'cable' | 'transformer' | 'hvdc';
  kv: number;
  kvLow?: number;
  lengthKm: number;
  cableFraction?: number;
  circuits: number;
  name: string | null;
  osmWays?: string[];
}

export interface NetworkData {
  generated: string;
  source: string;
  crs: string;
  method: string;
  nodes: NetNode[];
  buses: NetBus[];
  branches: NetBranch[];
}

export interface AllocationData {
  note: string;
  demandWeights: Record<string, number>;
  turbinesByBus: Record<string, number>;
}

export interface PlantData {
  id: string;
  name: string | null;
  osmName: string | null;
  source: string | null;
  mwTag: number | null;
  e: number;
  n: number;
  bus: string;
  distanceToBusKm: number;
}

export interface NetworkBundle {
  network: NetworkData;
  allocation: AllocationData;
  plants: PlantData[];
}
