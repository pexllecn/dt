"""Build the terrain tile pyramid and national textures from Copernicus GLO-30 and Overture.

Outputs (public/data/terrain):
  manifest.json            domain, levels, encodings, which tiles exist, provenance
  L{level}/{tx}_{ty}.png   16-bit grey PNG (Paeth-filtered), (TILE_PX+1)^2 samples, edge-inclusive
                           code = round((h + H_OFFSET) * H_SCALE) * 2 + lake_flag
                           Sea samples are exactly h = 0 with lake_flag = 0; land is never below +0.25 m.
  national_sdf.png         16-bit grey, 4097^2: signed distance to water (sea or lake), positive on land
                           code = 32768 + clamp(d, -SDF_RANGE, SDF_RANGE) * SDF_SCALE
  national_mask.png        8-bit RGB, 4097^2: R country (0 sea, 80 ROI, 160 NI, 240 GB/IoM),
                           G lake (255), B sky visibility at 2.5x exaggeration (0..255)

Tile (tx, ty) at level L covers easting [E0 + tx*T, E0 + (tx+1)*T] and northing
[N1 - (ty+1)*T, N1 - ty*T], where T = DOMAIN_SIZE / 2^L. Row 0 is the northern edge.
"""
import glob
import hashlib
import json
import shutil
import struct
import time
import zlib

import numpy as np
import pyarrow.parquet as pq
import rasterio
import shapely
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import Affine
from rasterio.warp import reproject
from scipy import ndimage

from common import (CACHE, DOMAIN_E0, DOMAIN_N1, DOMAIN_SIZE, FOCUS_REGIONS, H_OFFSET, H_SCALE, ITM,
                    MAX_LEVEL_ALL, MAX_LEVEL_FOCUS, OUT, SDF_RANGE, SDF_SCALE, TILE_PX, tile_size)

FINE = MAX_LEVEL_FOCUS
N_FINE = TILE_PX * 2 ** FINE + 1          # 16385 samples per side at 32 m
S_FINE = DOMAIN_SIZE / (N_FINE - 1)       # 32 m
NAT_LEVEL = 4
NAT = TILE_PX * 2 ** NAT_LEVEL + 1        # 4097 samples, 128 m
OUTDIR = OUT / "terrain"
WORK = CACHE / "terrain_work"


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


def sample_transform(spacing: float) -> Affine:
    # Pixel centres sit exactly on sample positions E0 + i*s, N1 - j*s.
    return Affine(spacing, 0, DOMAIN_E0 - spacing / 2, 0, -spacing, DOMAIN_N1 + spacing / 2)


def load_dem() -> np.ndarray:
    cached = WORK / "dem_itm.npy"
    if cached.exists():
        return np.load(cached)
    files = sorted(glob.glob(str(CACHE / "dem" / "*.tif")))
    log(f"merging {len(files)} DEM tiles")
    srcs = [rasterio.open(f) for f in files]
    mosaic, src_tf = merge(srcs, nodata=-9999.0)
    crs = srcs[0].crs
    for s in srcs:
        s.close()
    log("reprojecting to ITM at", S_FINE, "m")
    dst = np.full((N_FINE, N_FINE), -9999.0, dtype=np.float32)
    reproject(mosaic[0], dst, src_transform=src_tf, src_crs=crs, src_nodata=-9999.0,
              dst_transform=sample_transform(S_FINE), dst_crs=ITM, dst_nodata=-9999.0,
              resampling=Resampling.bilinear, num_threads=4)
    del mosaic
    dst[dst == -9999.0] = 0.0
    np.save(cached, dst)
    return dst


def to_itm(geoms):
    tr = Transformer.from_crs("EPSG:4326", ITM, always_xy=True)
    return [shapely.transform(g, lambda xy: np.column_stack(tr.transform(xy[:, 0], xy[:, 1]))) for g in geoms]


def load_polygons():
    div = pq.read_table(CACHE / "overture" / "division_area.parquet").to_pylist()
    country = {1: [], 2: [], 3: []}
    for r in div:
        if r["class"] != "land":
            continue
        g = shapely.from_wkb(r["geometry"])
        if r["subtype"] == "country" and r["country"] == "IE":
            country[1].append(g)
        elif r["subtype"] == "region" and r["region"] == "GB-NIR":
            country[2].append(g)
        elif r["subtype"] == "region" and (r["region"] in ("GB-SCT", "GB-WLS", "GB-ENG") or r["country"] == "IM"):
            country[3].append(g)
    water = pq.read_table(CACHE / "overture" / "water.parquet", columns=["subtype", "geometry"]).to_pylist()
    lakes = []
    for r in water:
        if r["subtype"] not in ("lake", "reservoir"):
            continue
        g = shapely.from_wkb(r["geometry"])
        if g.geom_type in ("Polygon", "MultiPolygon") and g.area > 4e-6:   # ~ 0.03 km2
            lakes.append(g)
    log("polygons:", {k: len(v) for k, v in country.items()}, "lakes", len(lakes))
    return {k: to_itm(v) for k, v in country.items()}, to_itm(lakes)


def rasterise(geoms_values, n: int, spacing: float) -> np.ndarray:
    return rasterize(geoms_values, out_shape=(n, n), transform=sample_transform(spacing), fill=0,
                     dtype=np.uint8, all_touched=False)


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, img: np.ndarray, bitdepth: int):
    """Minimal PNG writer with Paeth filtering on every row (far smaller than unfiltered)."""
    if img.ndim == 2:
        img = img[:, :, None]
    h, w, ch = img.shape
    colour_type = {1: 0, 2: 4, 3: 2, 4: 6}[ch]
    raw = np.ascontiguousarray(img.astype(">u2" if bitdepth == 16 else "u1")).tobytes()
    bpp = ch * (2 if bitdepth == 16 else 1)
    rows = np.frombuffer(raw, np.uint8).reshape(h, w * bpp).astype(np.int16)
    a = np.zeros_like(rows)
    a[:, bpp:] = rows[:, :-bpp]
    b = np.zeros_like(rows)
    b[1:] = rows[:-1]
    c = np.zeros_like(rows)
    c[1:, bpp:] = rows[:-1, :-bpp]
    p = a + b - c
    pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - c)
    pred = np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, c))
    filt = ((rows - pred) & 0xFF).astype(np.uint8)
    data = np.concatenate([np.full((h, 1), 4, np.uint8), filt], axis=1).tobytes()
    ihdr = struct.pack(">IIBBBBB", w, h, bitdepth, colour_type, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(data, 9))
                + _chunk(b"IEND", b""))


def encode_tile(h: np.ndarray, lake: np.ndarray) -> np.ndarray:
    q = np.clip(np.round((h + H_OFFSET) * H_SCALE), 0, 32767).astype(np.uint16)
    return q * 2 + lake.astype(np.uint16)


def encode_sdf(d):
    return np.clip(np.round(32768 + np.clip(d, -SDF_RANGE, SDF_RANGE) * SDF_SCALE), 0, 65535).astype(np.uint16)


def sky_visibility(h: np.ndarray, spacing: float, exaggeration=2.5, dirs=16, steps=14) -> np.ndarray:
    """Horizon-based ambient visibility (0..1): mean over directions of 1 - sin(horizon angle)."""
    log("sky visibility")
    he = h * exaggeration
    vis = np.zeros_like(he)
    for k in range(dirs):
        ang = 2 * np.pi * k / dirs
        dx, dy = np.cos(ang), np.sin(ang)
        best = np.zeros_like(he)
        for s in range(1, steps + 1):
            dist = 1.4 ** s                 # 1.4 .. 111 samples (180 m .. 14 km)
            ox, oy = int(round(dx * dist)), int(round(dy * dist))
            if ox == 0 and oy == 0:
                continue
            shifted = np.roll(np.roll(he, oy, axis=0), ox, axis=1)
            np.maximum(best, (shifted - he) / (np.hypot(ox, oy) * spacing), out=best)
        vis += 1 - np.sin(np.arctan(best))
    return vis / dirs


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    if OUTDIR.exists():
        shutil.rmtree(OUTDIR)
    OUTDIR.mkdir(parents=True)
    h = load_dem()
    country_polys, lakes = load_polygons()

    log("rasterising land and lakes")
    country = np.zeros((N_FINE, N_FINE), np.uint8)
    for code in (3, 2, 1):  # ROI last so it wins along the border
        m = rasterise([(g, code) for g in country_polys[code]], N_FINE, S_FINE)
        country[m > 0] = code
    land = country > 0
    lake = (rasterise([(g, 1) for g in lakes], N_FINE, S_FINE) > 0) & land

    # Heights: sea exactly 0 (the renderer shapes the shelf); land never below +0.25 m.
    h[~land] = 0.0
    np.maximum(h, 0.25, out=h, where=land)

    focus_tiles = set()
    tf = tile_size(FINE)
    for e, n, half in FOCUS_REGIONS.values():
        for tx in range(int((e - half - DOMAIN_E0) // tf), int((e + half - DOMAIN_E0) // tf) + 1):
            for ty in range(int((DOMAIN_N1 - (n + half)) // tf), int((DOMAIN_N1 - (n - half)) // tf) + 1):
                focus_tiles.add((tx, ty))

    manifest = {
        "domain": {"e0": DOMAIN_E0, "n1": DOMAIN_N1, "size": DOMAIN_SIZE, "crs": ITM},
        "tilePx": TILE_PX,
        "encoding": {"hOffset": H_OFFSET, "hScale": H_SCALE, "sdfRange": SDF_RANGE, "sdfScale": SDF_SCALE},
        "levels": {},
        "focusRegions": FOCUS_REGIONS,
        "national": {"samples": NAT, "spacing": DOMAIN_SIZE / (NAT - 1)},
        "sources": [
            {"name": "Copernicus DEM GLO-30", "label": "Public",
             "licence": "(c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018 provided under "
                        "COPERNICUS by the European Union and ESA; all rights reserved"},
            {"name": "OpenStreetMap via Overture Maps (coastline, country areas, lakes)", "label": "Public",
             "licence": "(c) OpenStreetMap contributors, ODbL; Overture Maps Foundation"},
        ],
    }

    pyramid = {}
    cur_h, cur_land, cur_lake = h, land, lake.astype(np.float32)
    for level in range(FINE, -1, -1):
        if level < FINE:
            # Average heights over land only so coasts do not get dragged towards sea level.
            lw = cur_land.astype(np.float32)
            num = ndimage.gaussian_filter(cur_h * lw, 1.0, mode="nearest")[::2, ::2]
            den = ndimage.gaussian_filter(lw, 1.0, mode="nearest")[::2, ::2]
            cur_lake = ndimage.gaussian_filter(cur_lake, 1.0, mode="nearest")[::2, ::2]
            cur_land = cur_land[::2, ::2]
            cur_h = np.where(cur_land, num / np.maximum(den, 1e-6), 0.0).astype(np.float32)
            np.maximum(cur_h, 0.25, out=cur_h, where=cur_land)
        pyramid[level] = (cur_h, cur_land, cur_lake > 0.5)

    total = 0
    for level in range(0, FINE + 1):
        hl, ll, lk = pyramid[level]
        land_any = ndimage.maximum_filter(ll, size=3)
        n_tiles = 2 ** level
        written = []
        for ty in range(n_tiles):
            for tx in range(n_tiles):
                if level == FINE and (tx, ty) not in focus_tiles:
                    continue
                if MAX_LEVEL_ALL < level < FINE:
                    continue
                r0, c0 = ty * TILE_PX, tx * TILE_PX
                win = (slice(r0, r0 + TILE_PX + 1), slice(c0, c0 + TILE_PX + 1))
                if not land_any[win].any():
                    continue
                d = OUTDIR / f"L{level}"
                d.mkdir(exist_ok=True)
                p = d / f"{tx}_{ty}.png"
                write_png(p, encode_tile(hl[win], lk[win]), 16)
                total += p.stat().st_size
                written.append([tx, ty])
        manifest["levels"][str(level)] = {"spacing": DOMAIN_SIZE / (n_tiles * TILE_PX), "tiles": written}
        log(f"L{level}: {len(written)} tiles, cumulative {total / 1e6:.1f} MB")

    # National textures at 128 m
    hn, ln, _ = pyramid[NAT_LEVEL]
    f = 2 ** (FINE - NAT_LEVEL)
    water_n = ~ln | (ndimage.uniform_filter(lake.astype(np.float32), f)[::f, ::f] > 0.5)
    sn = NAT
    d_land = ndimage.distance_transform_edt(~water_n).astype(np.float32)
    d_water = ndimage.distance_transform_edt(water_n).astype(np.float32)
    sdf = (d_land - d_water) * (DOMAIN_SIZE / (sn - 1))
    write_png(OUTDIR / "national_sdf.png", encode_sdf(sdf), 16)
    vis = sky_visibility(hn, DOMAIN_SIZE / (sn - 1))
    vis[~ln] = 1.0
    cn = ndimage.maximum_filter(country, size=1)[::f, ::f]
    lake_n = (ndimage.uniform_filter(lake.astype(np.float32), f)[::f, ::f] * 255).astype(np.uint8)
    rgb = np.stack([cn * 80, lake_n, np.clip(vis * 255, 0, 255).astype(np.uint8)], axis=-1).astype(np.uint8)
    write_png(OUTDIR / "national_mask.png", rgb, 8)

    files = sorted(OUTDIR.rglob("*.png"))
    digest = hashlib.sha256()
    for p in files:
        digest.update(p.read_bytes())
    manifest["contentHash"] = digest.hexdigest()[:16]
    manifest["bytes"] = sum(p.stat().st_size for p in files)
    (OUTDIR / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
    log("done", round(manifest["bytes"] / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
