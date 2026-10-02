"""Extract Overture Maps features for the island by bounding-box pushdown over HTTPS.

Overture republishes OpenStreetMap data (ODbL) alongside other sources. We read only the
Parquet footers, pick row groups whose bbox statistics intersect our area, and download
just those byte ranges. No DuckDB extensions or S3 SDK needed.

Usage: python overture.py            (fetches every layer below into tools/.cache/overture)
"""
import io
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import requests

from common import BBOX_LONLAT, CACHE

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
RELEASE = "2026-09-23.1"

LAYERS = {
    # name: (theme, type, optional row filter on 'subtype' / 'class', columns)
    "infrastructure_power": ("base", "infrastructure", ("subtype", ["power"]), None),
    "land": ("base", "land", None, ["id", "geometry", "subtype", "class", "bbox"]),
    "water": ("base", "water", ("subtype", ["ocean", "lake", "reservoir", "lagoon", "river"]),
              ["id", "geometry", "subtype", "class", "names", "is_salt", "bbox"]),
    "division_area": ("divisions", "division_area", ("subtype", ["country", "region"]),
                      ["id", "geometry", "subtype", "class", "names", "country", "region", "bbox"]),
    "division": ("divisions", "division", ("subtype", ["locality", "county"]),
                 ["id", "geometry", "subtype", "class", "names", "country", "region", "population", "bbox"]),
}


class RangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests."""

    def __init__(self, url: str, size: int):
        self.url, self.size, self.pos = url, size, 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else (self.pos + offset if whence == 1 else self.size + offset)
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        for attempt in range(5):
            try:
                r = requests.get(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"}, timeout=300)
                r.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 4:
                    raise
        b[:n] = r.content
        self.pos += n
        return n


def open_parquet(key: str, size: int) -> pq.ParquetFile:
    return pq.ParquetFile(io.BufferedReader(RangeFile(f"{BUCKET}/{key}", size), buffer_size=1 << 23))


def list_files(theme: str, typ: str):
    prefix = f"release/{RELEASE}/theme={theme}/type={typ}/"
    keys, token = [], None
    while True:
        url = f"{BUCKET}/?list-type=2&prefix={prefix}"
        if token:
            url += f"&continuation-token={requests.utils.quote(token)}"
        text = requests.get(url, timeout=60).text
        keys += [(k, int(s)) for k, s in re.findall(r"<Key>([^<]*)</Key>.*?<Size>(\d+)</Size>", text)]
        m = re.search(r"<NextContinuationToken>([^<]*)<", text)
        if not m:
            return keys
        token = m.group(1)


def intersecting_row_groups(key_size):
    key, size = key_size
    x0, y0, x1, y1 = BBOX_LONLAT
    md = open_parquet(key, size).metadata
    hits = []
    for i in range(md.num_row_groups):
        rg = md.row_group(i)
        st = {}
        for j in range(rg.num_columns):
            c = rg.column(j)
            if c.path_in_schema in ("bbox.xmin", "bbox.xmax", "bbox.ymin", "bbox.ymax") and c.statistics:
                st[c.path_in_schema] = (c.statistics.min, c.statistics.max)
        if len(st) < 4:
            hits.append(i)
            continue
        if st["bbox.xmin"][0] < x1 and st["bbox.xmax"][1] > x0 and st["bbox.ymin"][0] < y1 and st["bbox.ymax"][1] > y0:
            hits.append(i)
    return key, size, hits


def read_group(args):
    key, size, i, flt, columns = args
    t = open_parquet(key, size).read_row_group(i, columns=columns)
    x0, y0, x1, y1 = BBOX_LONLAT
    b = t["bbox"]
    m = pc.and_(
        pc.and_(pc.less(pc.struct_field(b, "xmin"), x1), pc.greater(pc.struct_field(b, "xmax"), x0)),
        pc.and_(pc.less(pc.struct_field(b, "ymin"), y1), pc.greater(pc.struct_field(b, "ymax"), y0)),
    )
    if flt:
        col, values = flt
        m = pc.and_(m, pc.is_in(t[col], value_set=pa.array(values)))
    return t.filter(m)


def fetch_layer(name: str):
    theme, typ, flt, columns = LAYERS[name]
    dst = CACHE / "overture" / f"{name}.parquet"
    if dst.exists():
        print(name, "cached")
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    files = list_files(theme, typ)
    with ThreadPoolExecutor(16) as ex:
        scanned = list(ex.map(intersecting_row_groups, files))
    jobs = [(k, s, i, flt, columns) for k, s, hits in scanned for i in hits]
    print(f"{name}: {len(files)} files, {len(jobs)} row groups intersect")
    with ThreadPoolExecutor(12) as ex:
        parts = [p for p in ex.map(read_group, jobs) if p.num_rows]
    table = pa.concat_tables(parts, promote_options="permissive") if parts else None
    if table is None:
        raise SystemExit(f"{name}: no features found")
    pq.write_table(table, dst)
    meta = {"release": RELEASE, "theme": theme, "type": typ, "rows": table.num_rows, "bbox_lonlat": BBOX_LONLAT}
    dst.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    print(name, table.num_rows, "rows")
    return dst


if __name__ == "__main__":
    for layer in sys.argv[1:] or LAYERS:
        fetch_layer(layer)
