import { describe, expect, it } from 'vitest';
import { bilinear } from '@/scene/terrain/TileStore';
import { benchPath, lerpKey, percentile } from '@/app/bench';

describe('terrain sampling', () => {
  it('interpolates bilinearly inside a cell', () => {
    // 2 x 2 samples: 0 1 / 2 3
    const data = new Float32Array([0, 1, 2, 3]);
    expect(bilinear(data, 2, 0, 0)).toBe(0);
    expect(bilinear(data, 2, 1, 1)).toBe(3);
    expect(bilinear(data, 2, 0.5, 0.5)).toBeCloseTo(1.5);
    expect(bilinear(data, 2, 0.25, 0)).toBeCloseTo(0.25);
  });
});

describe('benchmark path', () => {
  it('interpolates distance logarithmically so zooms feel even', () => {
    const k = lerpKey([0, 0, 1000, 0, 0], [0, 0, 100_000, 0, 0], 0.5);
    expect(k[2]).toBeCloseTo(10_000, 0);
  });
  it('covers the three LOD tiers', () => {
    expect(benchPath.map((s) => s.name)).toEqual(['national', 'regional', 'site']);
  });
  it('computes percentiles from sorted samples', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(51);
    expect(percentile(xs, 95)).toBe(96);
  });
});
