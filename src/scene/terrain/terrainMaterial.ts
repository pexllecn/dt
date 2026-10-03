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
  mx_noise_float,
  positionWorld,
} from 'three/tsl';
import { Color } from 'three/webgpu';

const hex = (h: string) => {
  const c = new Color(h);
  return vec3(c.r, c.g, c.b);
};
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
  /** Land cover classes, 4096 x 4096 (128 m, pixel-area convention). */
  landcover: texture(null as unknown as Texture),
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
  const nBase = normalize(vec3(hx0.sub(hx1).mul(inv), 1, hz0.sub(hz1).mul(inv)));

  // Land cover (OSM via Overture), with a noise-jittered lookup so class edges read as organic.
  const fragXZ0 = modelWorldMatrix.mul(vec4(vUnit.x.mul(size), 0, vUnit.y.mul(size), 1)).xz;
  const jitter = vec2(mx_noise_float(vec3(fragXZ0.mul(0.011), 1.3)), mx_noise_float(vec3(fragXZ0.mul(0.011), 7.1))).mul(110);
  const lcUv = fragXZ0.add(jitter).sub(national.origin).div(national.size);
  const lc = national.landcover.sample(lcUv).r.mul(255);
  const cls = (c: number) => float(1).sub(smoothstep(0.4, 0.6, abs(lc.sub(c))));
  const forest = cls(1);
  const wet = cls(2);
  const heath = cls(3);
  const grass = cls(4);
  const rock = cls(5);
  const sand = cls(6);

  // Micro-relief near the camera: canopy texture in forest, hummocks on bog, fine grain elsewhere.
  const camDist = length(positionWorld.sub(cameraPosition));
  const near = float(1).sub(smoothstep(1200, 9000, camDist));
  const amp = float(0.12).add(forest.mul(0.55)).add(wet.mul(0.3)).add(heath.mul(0.22)).add(rock.mul(0.4)).mul(near);
  const nAt = (p: N<'vec2'>) => mx_noise_float(vec3(p.mul(0.09), 0)).add(mx_noise_float(vec3(p.mul(0.33), 3)).mul(0.45));
  const e = float(1.5);
  const n0 = nAt(fragXZ0);
  const dnx = nAt(fragXZ0.add(vec2(e, 0))).sub(n0);
  const dnz = nAt(fragXZ0.add(vec2(0, e))).sub(n0);
  const nWorld = normalize(nBase.add(vec3(dnx.negate(), 0, dnz.negate()).mul(amp.mul(0.9))));
  material.normalNode = transformNormalToView(nWorld);

  const centre = heightTex.sample(uvC);
  const lake = smoothstep(0.35, 0.65, centre.g);
  const h = vHeight;

  // Scene xz of this fragment for the national textures.
  const fragXZ = fragXZ0;
  const mask = national.mask.sample(nationalUv(fragXZ));
  const context = smoothstep(0.42, 0.5, mask.r); // NI, GB and Isle of Man
  const slope = float(1).sub(nWorld.y);

  const hyps = smoothstep(20, 650, h);
  const base = mix(world.terrainLow, world.terrainHigh, hyps);
  const sloped = mix(base, base.mul(0.93), smoothstep(0.02, 0.25, slope));
  // Class tints: Irish land cover in Specimen (pasture, conifer, bog, heath, rock), deeper tones in
  // Control Room. Strongest close up, still clearly green at national scale.
  const tintOf = (spec: string, ctrl: string) => mix(hex(spec), hex(ctrl), world.themeMix);
  const tintStrength = mix(float(0.55), float(0.85), smoothstep(80_000, 15_000, world.altitude));
  let tinted = sloped;
  tinted = mix(tinted, tintOf('#6f8e5e', '#22362a'), forest.mul(tintStrength));
  tinted = mix(tinted, tintOf('#a99a74', '#3b3a2b'), wet.mul(tintStrength));
  tinted = mix(tinted, tintOf('#9c8f7a', '#3a3433'), heath.mul(tintStrength));
  tinted = mix(tinted, tintOf('#9dbd7c', '#33493a'), grass.mul(tintStrength.mul(0.8)));
  tinted = mix(tinted, tintOf('#bdbcb4', '#565a5c'), rock.mul(tintStrength));
  tinted = mix(tinted, tintOf('#e2d8b8', '#5e5747'), sand.mul(tintStrength));
  const speckle = mx_noise_float(vec3(fragXZ0.mul(0.06), 2)).mul(0.04).mul(near);
  const land = mix(tinted.mul(float(1).add(speckle)), world.terrainContext, context.mul(0.85));
  material.colorNode = vec4(mix(land, world.lake, lake), 1);
  material.roughnessNode = mix(world.roughness, float(0.62), lake);
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
