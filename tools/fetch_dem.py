"""Download Copernicus GLO-30 DEM tiles covering the domain from the AWS open data bucket.

Copernicus DEM GLO-30: (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH
2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.
"""
from concurrent.futures import ThreadPoolExecutor

import requests

from common import CACHE

BASE = "https://copernicus-dem-30m.s3.amazonaws.com"
LATS = range(51, 56)          # N51 .. N55 (tile named by its south edge)
LONS = range(12, 3, -1)       # W012 .. W004 (tile named by its west edge)


def name(lat: int, lon_w: int) -> str:
    return f"Copernicus_DSM_COG_10_N{lat:02d}_00_W{lon_w:03d}_00_DEM"


def fetch(args):
    lat, lon_w = args
    n = name(lat, lon_w)
    dst = CACHE / "dem" / f"{n}.tif"
    if dst.exists() and dst.stat().st_size > 0:
        return n, "cached"
    r = requests.get(f"{BASE}/{n}/{n}.tif", timeout=300)
    if r.status_code in (403, 404):
        return n, "absent (sea)"
    r.raise_for_status()
    dst.write_bytes(r.content)
    return n, f"{len(r.content) / 1e6:.1f} MB"


def main():
    (CACHE / "dem").mkdir(parents=True, exist_ok=True)
    jobs = [(lat, lon) for lat in LATS for lon in LONS]
    with ThreadPoolExecutor(8) as ex:
        for n, status in ex.map(fetch, jobs):
            print(n, status)


if __name__ == "__main__":
    main()
