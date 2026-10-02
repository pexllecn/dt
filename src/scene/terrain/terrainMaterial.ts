import { MeshStandardNodeMaterial, Vector2, type DataTexture, type Texture } from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  clamp,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  cameraPosition,
  normalize,
  positionLocal,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
  vec4,
  varyingProperty,
  select,
} from 'three/tsl';
import { world } from '../world/uniforms';
import type { FloatU, N, Vec2U } from '@/lib/tsl';

export const GRID_N = 128;
const TEX_N = 257; // samples per tile side

/**
 * National textures shared by every terrain node (128 m): water SDF and the mask
 * (country, lake, sky visibility). Assigned once at start-up.
 */
export const national = {
  sdf: texture(null as unknown as Texture),
  mask: texture(null as unknown as Texture),
  /** Scene-space x and z of the domain's north-west corner, and its size. */
  origin: uniform(new Vector2()),
  size: uniform(524_288),
};

/** World xz (scene) to national texture uv, texel-centred (4097 samples per side). */
export const nationalUv = (xz: N<'vec2'>) => {
  const n = float(4097);
  const rel = xz.sub(national.origin).div(national.size);
  return rel.mul(n.sub(1)).add(0.5).div(n);
};

/** Distance (m) from a scene point to the nearest edge of the data domain. */
export const domainEdgeDistance = (xz: N<'vec2'>) => {
  const rel = xz.sub(national.origin).div(national.size);
  return min(min(rel.x, float(1).sub(rel.x)), min(rel.y, float(1).sub(rel.y))).mul(national.size);
};

/** Same for the SDF texture, whose rows are padded to 4098 texels for upload alignment. */
export const sdfUv = (xz: N<'vec2'>) => {
  const rel = xz.sub(national.origin).div(national.size).mul(4096).add(0.5);
  return vec2(rel.x.div(4098), rel.y.div(4097));
};

export interface TerrainNodeMaterial {
  material: MeshStandardNodeMaterial;
  size: FloatU;
  uvOffset: Vec2U;
  uvScale: FloatU;
  texSpacing: FloatU;
  morph: Vec2U;
  heightTex: ReturnType<typeof texture>;
  setTexture(t: DataTexture): void;
}

/**
 * Terrain node material: CDLOD geomorphing in the vertex stage, normals from the height
 * texture in the fragment stage, theme-dependent plaster or basalt shading.
 */
export function createTerrainMaterial(placeholder: DataTexture): TerrainNodeMaterial {
  const size = uniform(1);
  const uvOffset = uniform(new Vector2());
  const uvScale = uniform(1);
  const texSpacing = uniform(64); // metres per texel of the bound texture
  const morph = uniform(new Vector2(1e9, 2e9)); // start, end distance
  const heightTex = texture(placeholder);

  const vUnit = varyingProperty('vec2', 'vUnit');
  const vHeight = varyingProperty('float', 'vHeight');

  const texUv = (p: N<'vec2'>) => uvOffset.add(p.mul(uvScale)).mul(TEX_N - 1).add(0.5).div(TEX_N);

  const seaFloor = (h: N<'float'>, xz: N<'vec2'>, extra: N<'float'>) => {
    // Sea samples are exactly 0 in the data; shape a shelf from the national SDF so the
    // shoreline is the intersection with the water plane. Lakes keep their own level.
    const sdf = national.sdf.sample(sdfUv(xz)).level(float(0)).r;
    const depth = clamp(sdf.negate().mul(0.012).add(4), 4, 90).add(extra);
    const t = clamp(h.div(0.25), 0, 1);
    return mix(depth.negate(), h, t);
  };

  const position = Fn(() => {
    const p = positionLocal.xz;
    const skirt = attribute('skirt', 'float');
    const ex = world.exaggeration;

    const h0 = heightTex.sample(texUv(p)).level(float(0)).r;
    const local0 = vec3(p.x.mul(size), h0.mul(ex), p.y.mul(size));
    const w0 = modelWorldMatrix.mul(vec4(local0, 1)).xyz;
    const dist = length(w0.sub(cameraPosition));
    const k = clamp(dist.sub(morph.x).div(morph.y.sub(morph.x)), 0, 1);
    const pm = p.sub(fract(p.mul(GRID_N * 0.5)).mul(2 / GRID_N).mul(k));

    const sample = heightTex.sample(texUv(pm)).level(float(0));
    const wxz = modelWorldMatrix.mul(vec4(pm.x.mul(size), 0, pm.y.mul(size), 1)).xz;
    const isLake = sample.g.greaterThan(0.5);
    // Land cut by the data domain (Great Britain) sinks gently below the sea towards the edge,
    // so its coast dissolves along natural contours rather than a straight line.
    const drown = float(1).sub(smoothstep(6000, 48000, domainEdgeDistance(wxz))).mul(700);
    const hLand = sample.r.sub(drown);
    const h = select(isLake, sample.r, seaFloor(hLand, wxz, drown.mul(0.5)));
    vUnit.assign(pm);
    vHeight.assign(sample.r);
    const skirtDepth = size.div(GRID_N).mul(1.5).add(30);
    return vec3(pm.x.mul(size), h.mul(ex).sub(skirt.mul(skirtDepth)), pm.y.mul(size));
  });

  const material = new MeshStandardNodeMaterial();
  material.positionNode = position();

  // Fragment: normal from central differences of the height texture.
  const uvC = texUv(vUnit);
  const du = float(1 / TEX_N);
  const hx1 = heightTex.sample(uvC.add(vec2(du, 0))).r;
  const hx0 = heightTex.sample(uvC.sub(vec2(du, 0))).r;
  const hz1 = heightTex.sample(uvC.add(vec2(0, du))).r;
  const hz0 = heightTex.sample(uvC.sub(vec2(0, du))).r;
  const inv = world.exaggeration.mul(world.shadeBoost).div(texSpacing.mul(2));
  const nWorld = normalize(vec3(hx0.sub(hx1).mul(inv), 1, hz0.sub(hz1).mul(inv)));
  material.normalNode = transformNormalToView(nWorld);

  const centre = heightTex.sample(uvC);
  const lake = smoothstep(0.35, 0.65, centre.g);
  const h = vHeight;

  // Scene xz of this fragment for the national textures.
  const fragXZ = modelWorldMatrix.mul(vec4(vUnit.x.mul(size), 0, vUnit.y.mul(size), 1)).xz;
  const mask = national.mask.sample(nationalUv(fragXZ));
  const context = smoothstep(0.42, 0.5, mask.r); // NI, GB and Isle of Man
  const slope = float(1).sub(nWorld.y);

  const hyps = smoothstep(20, 650, h);
  const base = mix(world.terrainLow, world.terrainHigh, hyps);
  const sloped = mix(base, base.mul(0.93), smoothstep(0.02, 0.25, slope));
  const land = mix(sloped, world.terrainContext, context.mul(0.85));
  material.colorNode = vec4(mix(land, world.lake, lake), 1);
  material.roughnessNode = mix(world.roughness, float(0.3), lake);
  material.metalnessNode = float(0);

  // Baked sky visibility, computed at 2.5x; fades as exaggeration relaxes towards 1x.
  const aoStrength = clamp(world.exaggeration.sub(1).div(1.5), 0, 1).mul(0.85);
  material.aoNode = mix(float(1), mask.b, aoStrength);

  // Contours: interval adapts to altitude; drawn with screen-space width so they stay hairline.
  const interval = select(
    world.altitude.lessThan(12_000),
    float(10),
    select(world.altitude.lessThan(90_000), float(50), float(200)),
  );
  const t = h.div(interval);
  const dist = abs(fract(t.sub(0.5)).sub(0.5));
  const fw = max(fwidth(t), 1e-4);
  // Fade contours where they would crowd closer than a few pixels apart.
  const line = float(1).sub(smoothstep(0, fw.mul(1.1), dist)).mul(float(1).sub(smoothstep(0.04, 0.16, fw)));
  const contour = line.mul(world.contourStrength).mul(float(1).sub(lake)).mul(smoothstep(1, 8, h));
  material.emissiveNode = world.contour.mul(contour).mul(min(float(1), float(1).sub(context.mul(0.6))));

  material.fog = true;

  return {
    material,
    size,
    uvOffset,
    uvScale,
    texSpacing,
    morph,
    heightTex,
    setTexture(t) {
      heightTex.value = t;
    },
  };
}
