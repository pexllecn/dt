/**
 * The Flow lens must tell the truth: every conductor's particles move in the direction the
 * solver says power flows, at a speed proportional to its MW.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Engine } from '../../src/sim/engine.ts';
import { SCENARIOS } from '../../src/sim/scenarios.ts';
import type { SimState } from '../../src/sim/types.ts';
import { bayFlow, particleVelocity, SPEED_PER_MW } from '../../src/scene/flowmap.ts';
import { FlowLayer } from '../../src/scene/flow.ts';
import { BAYS, YARD_CENTRE } from '../../src/scene/layout.ts';
import { createMaterials } from '../../src/scene/materials.ts';
import { buildStation } from '../../src/scene/station.ts';
import { buildSurroundings } from '../../src/scene/surroundings.ts';

const m = createMaterials();
const station = buildStation(m);
const surroundings = buildSurroundings(m, station.lineStarts, station.cableEnds);
const allPaths = [...station.paths, ...surroundings.paths];
const keys = [...new Set(allPaths.map((p) => p.key))];

const sum = (ks: string[], s: SimState) => ks.reduce((a, k) => a + bayFlow(k, s)!.mw, 0);
const B400 = ['L400-1', 'L400-2', 'T1-HV', 'T2-HV'];
const B220 = ['T1-LV', 'T2-LV', 'T4-220', 'WIND', 'TIE_N', 'SOLAR', 'GAS', 'REG-A', 'REG-B', 'LD_NEW', 'BESS', 'T3-220'];
const B110 = ['T3-110', 'LD_IND', 'TIE_S'];

function exporting(): Engine {
  const e = new Engine();
  for (const s of ['wind_up', 'add_solar', 'add_gas', 'imp_n'] as const) e.command({ type: 'scenario', id: s });
  e.command({ type: 'setGeneration', id: 'GAS', out: 180 });
  e.command({ type: 'setDemand', id: 'LD_TOWN', mw: 200 });
  e.advance(1800);
  return e;
}

describe('flow mapping', () => {
  it('has a mapping for every flow path in the scene', () => {
    for (const k of keys) expect(bayFlow(k, new Engine().s), k).not.toBeNull();
  });

  // Outward flows at a busbar sum to zero exactly when the signs agree with the solver.
  for (const sc of SCENARIOS) {
    it(`closes the balance at every busbar with the solver's signs: ${sc.id}`, () => {
      const e = new Engine();
      e.command({ type: 'scenario', id: sc.id });
      for (let i = 0; i < 12; i++) {
        e.advance(600);
        const s = e.s;
        if (s.C.BUS400.live) expect(Math.abs(sum(B400, s))).toBeLessThan(1e-6);
        if (s.C.BUS110.live) expect(Math.abs(sum(B110, s))).toBeLessThan(1e-6);
        expect(Math.abs(sum(B220, s))).toBeLessThan(1e-6);
      }
    });
  }

  it('reverses the 400 kV conductors on export', () => {
    const imp = new Engine().s;
    const exp = exporting().s;
    expect(imp.results.gridFlow).toBeGreaterThan(0);
    expect(exp.results.gridFlow).toBeLessThan(-100);
    for (const k of ['L400-1', 'L400-2']) {
      expect(bayFlow(k, imp)!.mw).toBeLessThan(0); // inward, towards the busbar
      expect(bayFlow(k, exp)!.mw).toBeGreaterThan(0); // outward, towards the 400 kV system
    }
  });

  it('makes speed proportional to MW and signed by direction', () => {
    expect(particleVelocity(100)).toBeCloseTo(100 * SPEED_PER_MW, 12);
    expect(particleVelocity(-250, 3)).toBeCloseTo(-250 * SPEED_PER_MW * 3, 12);
    expect(particleVelocity(0.2)).toBe(0);
  });
});

describe('flow path geometry runs outward', () => {
  const centre = new THREE.Vector3(...YARD_CENTRE);
  it('station paths run from the busbar into the bay', () => {
    for (const bay of BAYS) {
      const ps = station.paths.filter((p) => p.key === bay.key);
      expect(ps.length, bay.key).toBeGreaterThan(0);
      const dx = ps.reduce((a, p) => a + (p.pts[p.pts.length - 1]!.x - p.pts[0]!.x), 0);
      expect(dx * bay.dir, bay.key).toBeGreaterThan(0);
    }
    const bs = station.paths.filter((p) => p.key === 'BS220');
    expect(bs.reduce((a, p) => a + (p.pts[p.pts.length - 1]!.z - p.pts[0]!.z), 0)).toBeGreaterThan(0); // section A to B
  });
  it('lines and cables run away from the station', () => {
    const flat = (v: THREE.Vector3) => Math.hypot(v.x - centre.x, v.z - centre.z);
    const byKey = new Map<string, number>();
    for (const p of surroundings.paths) byKey.set(p.key, (byKey.get(p.key) ?? 0) + flat(p.pts[p.pts.length - 1]!) - flat(p.pts[0]!));
    expect(byKey.size).toBeGreaterThanOrEqual(12);
    for (const [k, d] of byKey) expect(d, k).toBeGreaterThan(0);
  });
});

describe('flow layer particles', () => {
  for (const [name, mk] of [['import', () => new Engine()], ['export', exporting]] as const) {
    it(`moves every key's particles at the solver's signed speed (${name})`, () => {
      const layer = new FlowLayer(allPaths);
      layer.setActive(true, [], false);
      layer.setViewDistance(300);
      const s = mk().s;
      const before = new Map([...layer.keys].map(([k, v]) => [k, v.offset]));
      const dt = 0.05;
      layer.update(s, dt);
      const scale = 300 / 220;
      for (const [k, ks] of layer.keys) {
        const f = bayFlow(k, s)!;
        const expected = f.live ? particleVelocity(f.mw, scale) * dt : 0;
        expect(ks.offset - before.get(k)!, k).toBeCloseTo(expected, 9);
      }
    });
  }

  it('moves a 400 kV particle along the conductor towards the station on import and away on export', () => {
    for (const [mk, sign] of [[() => new Engine(), -1], [exporting, 1]] as const) {
      const layer = new FlowLayer(allPaths);
      layer.setActive(true, [], false);
      layer.setViewDistance(300);
      const s = mk().s;
      layer.update(s, 0.01);
      const run = layer.runs.find((r) => r.key.key === 'L400-1' && r.path.length > 200)!;
      const centre = new THREE.Vector3(...YARD_CENTRE).setY(0);
      const read = () => {
        const out: THREE.Vector3[] = [];
        const mtx = new THREE.Matrix4();
        for (let i = 0; i < run.count; i++) {
          layer.particles.getMatrixAt(run.first + i, mtx);
          const p = new THREE.Vector3().setFromMatrixPosition(mtx);
          const sc = new THREE.Vector3().setFromMatrixScale(mtx);
          out.push(sc.x > 0 ? p : new THREE.Vector3(NaN));
        }
        return out;
      };
      const a = read();
      layer.update(s, 0.2);
      const b = read();
      let checked = 0;
      a.forEach((p, i) => {
        const q = b[i]!;
        if (Number.isNaN(p.x) || Number.isNaN(q.x) || p.distanceTo(q) > 30) return; // hidden or wrapped
        const d = q.clone().setY(0).distanceTo(centre) - p.clone().setY(0).distanceTo(centre);
        expect(Math.sign(d)).toBe(sign);
        checked++;
      });
      expect(checked).toBeGreaterThan(0);
    }
  });
});
