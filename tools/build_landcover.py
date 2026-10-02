"""Land cover texture from OpenStreetMap land polygons (via Overture), for terrain tinting.

Output: public/data/terrain/landcover.png, 8-bit grey, 4096 x 4096 pixels covering the domain
(128 m pixels, pixel-area convention). Codes: 0 none, 1 forest, 2 wetland or bog, 3 heath or
scrub, 4 grassland, 5 rock or scree, 6 sand or beach.
"""
import numpy as np
import pyarrow.parquet as pq
import shapely
from rasterio.features import rasterize
from rasterio.transform import Affine

from build_terrain import to_itm, write_png, log
from common import CACHE, DOMAIN_E0, DOMAIN_N1, DOMAIN_SIZE, OUT

N = 4096
CODES = {"forest": 1, "tree": 1, "wetland": 2, "shrub": 3, "grass": 4, "rock": 5, "sand": 6}
ORDER = ["grass", "shrub", "forest", "tree", "wetland", "rock", "sand"]  # later wins


def main():
    t = pq.read_table(CACHE / "overture" / "land.parquet", columns=["subtype", "geometry"]).to_pylist()
    tf = Affine(DOMAIN_SIZE / N, 0, DOMAIN_E0, 0, -DOMAIN_SIZE / N, DOMAIN_N1)
    out = np.zeros((N, N), np.uint8)
    for sub in ORDER:
        geoms = []
        for r in t:
            if r["subtype"] != sub:
                continue
            g = shapely.from_wkb(r["geometry"])
            if g.geom_type in ("Polygon", "MultiPolygon") and g.area > 2e-6:
                geoms.append(g)
        log(sub, len(geoms))
        if not geoms:
            continue
        geoms = to_itm(geoms)
        m = rasterize([(g, 1) for g in geoms], out_shape=(N, N), transform=tf, fill=0, dtype=np.uint8, all_touched=False)
        out[m > 0] = CODES[sub]
    write_png(OUT / "terrain" / "landcover.png", out, 8)
    log("done", np.bincount(out.ravel(), minlength=7))


if __name__ == "__main__":
    main()
