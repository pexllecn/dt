/**
 * Physically based, procedural materials (no texture files). Surface detail on small parts comes
 * from noise evaluated on world position. The large surfaces (fields, gravel, roads, hedges,
 * water) sample a tileable noise texture generated at start-up instead: it is several times
 * cheaper per pixel, and mipmapped, so fine detail fades out cleanly with distance.
 */
import * as THREE from 'three/webgpu';
import {
  abs, bumpMap, clamp, color, float, floor, fract, max, mix, mx_cell_noise_float, mx_fractal_noise_float,
  mx_noise_float, normalLocal, positionLocal, positionWorld, smoothstep, step, texture, uniform, vec2, vec3,
} from 'three/tsl';
import { createNoiseTexture } from './noiseTexture.ts';

export interface Materials {
  galvanised: THREE.MeshStandardNodeMaterial;
  aluminium: THREE.MeshStandardNodeMaterial;
  conductor: THREE.MeshStandardNodeMaterial;
  porcelain: THREE.MeshPhysicalNodeMaterial;
  composite: THREE.MeshStandardNodeMaterial;
  tankPaint: THREE.MeshStandardNodeMaterial;
  cabinet: THREE.MeshStandardNodeMaterial;
  concrete: THREE.MeshStandardNodeMaterial;
  gravel: THREE.MeshStandardNodeMaterial;
  asphalt: THREE.MeshStandardNodeMaterial;
  grass: THREE.MeshStandardNodeMaterial;
  cladding: THREE.MeshStandardNodeMaterial;
  roof: THREE.MeshStandardNodeMaterial;
  glass: THREE.MeshStandardNodeMaterial;
  rubber: THREE.MeshStandardNodeMaterial;
  copper: THREE.MeshStandardNodeMaterial;
  lamp: THREE.MeshStandardNodeMaterial;
  fanBlade: THREE.MeshStandardNodeMaterial;
  hedge: THREE.MeshStandardNodeMaterial;
  water: THREE.MeshStandardNodeMaterial;
  /** 0 by day, 1 at night: drives lit windows and lamps. */
  night: THREE.UniformNode<'float', number>;
  /** Extra conductor radius with viewing distance (m). */
  widen: THREE.UniformNode<'float', number>;
}

const n3 = (scale: number, octaves = 3) => mx_fractal_noise_float(positionWorld.mul(scale), octaves, 2.0, 0.5);

export function createMaterials(): Materials {
  const night = uniform(0) as unknown as THREE.UniformNode<'float', number>;
  const noise = createNoiseTexture();
  /** Sample the noise texture at a ground position; `size` is the tile size in metres. */
  const tex = (xz: THREE.Node<'vec2'>, size: number) => texture(noise, xz.div(size));
  const ground = positionWorld.xz as unknown as THREE.Node<'vec2'>;
  /** The same position turned by about 37 degrees, so two scales of the tile never line up. */
  const turned = vec2(positionWorld.x.mul(0.8).sub(positionWorld.z.mul(0.6)), positionWorld.x.mul(0.6).add(positionWorld.z.mul(0.8))) as unknown as THREE.Node<'vec2'>;
  // Peat-dark lough water: mostly reflection of the sky, with a slow ripple in the normals.
  const water = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.0 });
  water.colorNode = mix(color(0x16232a), color(0x24353b), tex(ground, 160).r);

  const galvanised = new THREE.MeshStandardNodeMaterial({ metalness: 0.85 });
  {
    const spangle = mx_cell_noise_float(positionWorld.mul(9.0));
    const mottle = n3(0.9);
    galvanised.colorNode = mix(color(0x7d8589), color(0xaab0b3), clamp(spangle.mul(0.5).add(mottle.mul(0.6)).add(0.25), 0, 1));
    galvanised.roughnessNode = float(0.42).add(spangle.mul(0.18)).add(mottle.mul(0.08));
  }

  const aluminium = new THREE.MeshStandardNodeMaterial({ metalness: 1.0 });
  aluminium.colorNode = mix(color(0xc9ccce), color(0xdfe1e2), n3(0.6).mul(0.5).add(0.5));
  aluminium.roughnessNode = float(0.32).add(n3(4.0).mul(0.06));

  const conductor = new THREE.MeshStandardNodeMaterial({ metalness: 1.0, roughness: 0.45, color: 0xb8bbbc });
  // Overhead lines stay about a pixel wide out to network scale (set from the viewing distance).
  const widen = uniform(0) as unknown as THREE.UniformNode<'float', number>;
  conductor.positionNode = positionLocal.add(normalLocal.mul(widen));

  // Glazed porcelain: deep brown with a clear glaze.
  const porcelain = new THREE.MeshPhysicalNodeMaterial({ metalness: 0, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.08 });
  porcelain.colorNode = mix(color(0x4a2618), color(0x5e321f), n3(2.0).mul(0.5).add(0.5));

  // Silicone composite housings: matt light grey.
  const composite = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.62 });
  composite.colorNode = mix(color(0x8c9196), color(0x9da2a6), n3(3.0).mul(0.5).add(0.5));

  // Transformer paint (RAL 7033-like grey green), with weathering darker at the base.
  const tankPaint = new THREE.MeshStandardNodeMaterial({ metalness: 0.15 });
  {
    const grime = smoothstep(float(2.5), float(0.0), positionWorld.y).mul(0.35);
    tankPaint.colorNode = mix(mix(color(0x5c655d), color(0x6a736a), n3(1.2).mul(0.5).add(0.5)), color(0x4f544c), grime);
    tankPaint.roughnessNode = float(0.48).add(n3(6.0).mul(0.08));
  }

  const cabinet = new THREE.MeshStandardNodeMaterial({ metalness: 0.2, roughness: 0.45, color: 0xb9bcb8 });

  const concrete = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  {
    const blotch = n3(0.35, 4);
    const fine = mx_noise_float(positionWorld.mul(18.0));
    concrete.colorNode = mix(color(0x8a8881), color(0xa6a39a), clamp(blotch.mul(0.6).add(0.5).add(fine.mul(0.08)), 0, 1));
    concrete.roughnessNode = float(0.9).sub(fine.mul(0.05));
  }

  // Gravel: crushed limestone chippings. Each chip is a cell of the texture, with its own tone and
  // darker gaps between chips; two turned scales hide the tiling, broad patches add wear.
  const gravel = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  {
    const a = tex(ground, 0.9);
    const b = tex(turned, 0.63);
    const chip = a.g.min(b.g);
    const tone = mix(a.a, b.a, step(b.g, a.g));
    // Patchiness from damp, settling and vehicle wear at 3, 11 and 37 m, so the yard still reads
    // as loose stone when the chips themselves are smaller than a pixel.
    const wear = tex(ground, 3.1).b.mul(0.35).add(tex(turned, 11).r.mul(0.35)).add(tex(ground, 37).r.mul(0.3));
    const lit = clamp(tone.mul(0.4).add(0.42).sub(chip.mul(0.3)).add(wear.sub(0.5).mul(0.6)), 0, 1);
    gravel.colorNode = mix(color(0x47443e), color(0x9e998d), lit);
    gravel.roughnessNode = float(0.92);
    gravel.normalNode = bumpMap(float(1).sub(chip), float(0.5));
  }

  const asphalt = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  asphalt.colorNode = mix(color(0x3a3b3c), color(0x4b4c4c), tex(ground, 6).b.mul(0.6).add(tex(turned, 40).r.mul(0.4)));
  asphalt.roughnessNode = float(0.86);

  // Grass with a field patchwork: each field gets its own tone, hedgerow lines darken the edges.
  const grass = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  {
    const p = positionWorld.xz;
    const fieldSize = float(140.0);
    const cell = floor(vec2(p.x, p.y).div(fieldSize));
    // Neighbouring cells often share a tone, so fields read as irregular holdings, not a chequerboard.
    const big = floor(cell.div(vec2(2.0, 3.0)));
    const tone = mix(mx_cell_noise_float(vec3(cell.x, cell.y, 3.0)), mx_cell_noise_float(vec3(big.x, big.y, 7.0)), 0.65);
    const regional = tex(ground, 2400).r.sub(0.5).mul(2);
    const tilled = step(float(0.93), mx_cell_noise_float(vec3(cell.x, cell.y, 11.0)));
    const f = fract(vec2(p.x, p.y).div(fieldSize));
    const edge = max(abs(f.x.sub(0.5)), abs(f.y.sub(0.5)));
    const hedgeLine = smoothstep(float(0.485), float(0.497), edge);
    // Irish pasture: muted greens that drift towards olive and straw, never a uniform lawn.
    const pasture = mix(mix(color(0x55663a), color(0x72824a), tone), color(0x7d7e4c), smoothstep(float(0.2), float(1.0), regional).mul(0.35));
    const base = mix(pasture.mul(regional.mul(0.1).add(1.0)), color(0x6e5f45), tilled.mul(0.85));
    // Sward texture at two scales (tufts and grazing patches), from the noise texture.
    const sward = tex(ground, 13).b.mul(0.6).add(tex(turned, 90).r.mul(0.4));
    grass.colorNode = mix(mix(base.mul(0.78), base.mul(1.06), sward), color(0x2a361d), hedgeLine.mul(0.8));
    grass.roughnessNode = float(0.95);
  }

  const cladding = new THREE.MeshStandardNodeMaterial({ metalness: 0.3, roughness: 0.55 });
  {
    // Vertical profiled sheet: subtle stripes.
    const ribs = step(float(0.5), fract(positionWorld.x.add(positionWorld.z).mul(4.0)));
    cladding.colorNode = mix(color(0xc8ccc8), color(0xb9bdb9), ribs);
  }
  const roof = new THREE.MeshStandardNodeMaterial({ metalness: 0.4, roughness: 0.6, color: 0x4a5052 });

  const glass = new THREE.MeshStandardNodeMaterial({ metalness: 0.2, roughness: 0.08 });
  glass.colorNode = color(0x2a3338);
  glass.emissiveNode = color(0xffd9a1).mul(night.mul(2.2));

  const rubber = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.8, color: 0x1e1f20 });
  const copper = new THREE.MeshStandardNodeMaterial({ metalness: 1, roughness: 0.4, color: 0xa4693f });

  // Indicator lamps: colour comes from per-instance colour, brightness is emissive.
  const lamp = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.3 });
  lamp.colorNode = vec3(0.05, 0.05, 0.05);
  lamp.emissiveNode = color(0xffffff).mul(1.0);

  const fanBlade = new THREE.MeshStandardNodeMaterial({ metalness: 0.6, roughness: 0.4, color: 0x3a3e40, side: THREE.DoubleSide });
  const hedge = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
  hedge.colorNode = mix(color(0x22331a), color(0x3b4f24), tex(vec2(positionWorld.x.add(positionWorld.y), positionWorld.z) as unknown as THREE.Node<'vec2'>, 4).r);

  return {
    galvanised, aluminium, conductor, porcelain, composite, tankPaint, cabinet, concrete, gravel, asphalt, grass,
    cladding, roof, glass, rubber, copper, lamp, fanBlade, hedge, water, night, widen,
  };
}
