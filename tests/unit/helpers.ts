import { readFileSync } from 'node:fs';
import type { NetworkBundle } from '@/sim/types';

export function loadBundle(): NetworkBundle {
  const dir = new URL('../../public/data/network/', import.meta.url);
  const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  return { network: read('network.json'), allocation: read('allocation.json'), plants: read('plants.json') };
}
