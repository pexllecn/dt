"""Build the transmission network graph from OpenStreetMap power data (via Overture Maps).

Output: public/data/network/
  network.json    stations, buses, branches (topology + lengths; electrical parameters are applied
                  at runtime from src/config so every figure carries its source label)
  lines.json      rendering polylines (ITM metres, simplified) keyed by branch id
  plants.json     generation sites with OSM capacity tags, attached to buses
  turbines.bin    Float32 [e, n] for every OSM wind turbine on the island (for M4)
  towers.bin      Float32 [e, n, kv/1000, kind] for every OSM tower or pole on a line >= 110 kV
  report.md       topology report: counts, unresolved ends, merges, assumptions

Method
  1. Lines and cables >= 110 kV on the island (plus HVDC interconnector cables). Ways carrying
     several voltages are split per voltage; circuits from the circuits tag, else cables/3.
  2. Way ends within SNAP m of each other are the same node. Ends inside a substation footprint
     (buffered) attach to that station. Remaining loose ends attach to the nearest station or
     generating plant within LOOSE m, else stay as recorded unresolved ends.
  3. Chains of ways through degree-2 junctions are merged into one branch per circuit group.
     Junctions with three or more ways are kept as tee buses (real teed 110 kV lines).
  4. Each station gets one bus per voltage level it connects at; transformers join the levels.
  5. Radial spurs and short tees are kept: DC power flow on a few hundred buses is cheap and
     keeping them avoids approximating anything that is not exact.
"""
import json
import math
import re
import struct
import time
from collections import Counter, defaultdict

import numpy as np
import pyarrow.parquet as pq
import shapely
from pyproj import Transformer
from shapely.strtree import STRtree

from common import CACHE, DOMAIN_E0, DOMAIN_E1, DOMAIN_N0, DOMAIN_N1, ITM, OUT

SNAP = 30.0          # m: way ends closer than this are one node
STATION_BUFFER = 250  # m: ends within this of a substation footprint attach to it
STATION_ENTRY = 1500  # m: a tee joined to a station by a shorter branch is the station's entry point
LOOSE = 600.0        # m: unresolved ends attach to a station or plant within this distance
MIN_KV = 110
HVDC_KV = {200, 250, 320}   # East West 200 kV, Moyle 250 kV, Greenlink 320 kV (DC)
OUTDIR = OUT / "network"

TO_ITM = Transformer.from_crs("EPSG:4326", ITM, always_xy=True)


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


def itm(g):
    return shapely.transform(g, lambda xy: np.column_stack(TO_ITM.transform(xy[:, 0], xy[:, 1])))


def kv_list(v):
    out = []
    for x in re.split(r"[;,]", v or ""):
        x = x.strip()
        if x.isdigit():
            k = int(x) // 1000
            out.append(400 if k == 380 else k)  # Irish 400 kV system is tagged 380 kV in places
    return out


def int_list(v):
    out = []
    for x in re.split(r"[;,]", v or ""):
        x = x.strip()
        out.append(int(x) if x.isdigit() else None)
    return out


def clean_name(n):
    if not n:
        return None
    n = re.sub(r"\b(\d{2,3}\s?[-/]?\s?)+k?V\b", "", n, flags=re.I)
    n = re.sub(r"\b\d{2,3}\s?-?\s?kV\b", "", n, flags=re.I)
    n = re.sub(r"\b(Transmission|Substation|Station|Sub-?station|GIS|Indoor|Converter|Static Inverter Plant|"
               r"HVDC|Cable Compound|Switching|Compound|AIS)\b", "", n, flags=re.I)
    n = re.sub(r"[()]", "", n)
    n = re.sub(r"\s{2,}", " ", n).strip(" -,_")
    if not re.search(r"[A-Za-z]{2,}", n):
        return None
    return n or None


class UnionFind:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, a):
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def merge_parallels(branches):
    groups = defaultdict(list)
    for b in branches:
        groups[(min(b["a"], b["z"]), max(b["a"], b["z"]), b["kv"], b["hvdc"])].append(b)
    out = []
    for bs in groups.values():
        if len(bs) == 1:
            out.append(bs[0])
            continue
        base = max(bs, key=lambda b: b["lengthM"])
        out.append(dict(base, circuits=sum(b["circuits"] for b in bs), parallelWays=len(bs)))
    return out


def simplify(branches):
    """Graph clean-up on node keys. Each step is exact in DC power flow or removes a data artefact."""
    stats = Counter()
    changed = True
    while changed:
        changed = False
        # 1. Station entry tees: a tee joined to a station by a short branch is the station's entry.
        for b in list(branches):
            if b["hvdc"] or b["lengthM"] >= STATION_ENTRY:
                continue
            ka, kz = b["a"], b["z"]
            if ka[0] == "J" and kz[0] == "S":
                tee, st = ka, kz
            elif kz[0] == "J" and ka[0] == "S":
                tee, st = kz, ka
            else:
                continue
            for o in branches:
                if o["a"] == tee:
                    o["a"] = st
                if o["z"] == tee:
                    o["z"] = st
            stats["station entry tees contracted"] += 1
            changed = True
        before = len(branches)
        branches = [b for b in branches if b["a"] != b["z"]]
        branches = merge_parallels(branches)
        # 2. Dangling tees carry no flow: drop the dead-end branch.
        deg = Counter()
        for b in branches:
            deg[b["a"]] += 1
            deg[b["z"]] += 1
        keep = []
        for b in branches:
            dead = (b["a"][0] == "J" and deg[b["a"]] == 1) or (b["z"][0] == "J" and deg[b["z"]] == 1)
            if dead and not b["hvdc"]:
                stats["dangling branches dropped"] += 1
                changed = True
                continue
            keep.append(b)
        branches = keep
        # 3. Pass-through tees (two branches, same voltage): merge in series (exact without injection).
        inc = defaultdict(list)
        for b in branches:
            inc[b["a"]].append(b)
            inc[b["z"]].append(b)
        for node, bs in list(inc.items()):
            if node[0] != "J" or len(bs) != 2:
                continue
            b1, b2 = bs
            if b1 is b2 or b1["kv"] != b2["kv"] or b1["hvdc"] or b2["hvdc"] or b1 not in branches or b2 not in branches:
                continue
            c1 = b1["coords"] if b1["z"] == node else b1["coords"][::-1]
            c2 = b2["coords"] if b2["a"] == node else b2["coords"][::-1]
            far1 = b1["a"] if b1["z"] == node else b1["z"]
            far2 = b2["z"] if b2["a"] == node else b2["a"]
            L = b1["lengthM"] + b2["lengthM"]
            nb = dict(b1, a=far1, z=far2, coords=c1 + c2[1:], lengthM=L,
                      cableFrac=(b1["cableFrac"] * b1["lengthM"] + b2["cableFrac"] * b2["lengthM"]) / max(L, 1),
                      circuits=min(b1["circuits"], b2["circuits"]), ways=b1["ways"] + b2["ways"],
                      name=b1["name"] or b2["name"])
            branches = [b for b in branches if b is not b1 and b is not b2] + [nb]
            stats["pass-through tees merged in series"] += 1
            changed = True
            break
        changed = changed or len(branches) != before
    return branches, dict(stats)


def load():
    t = pq.read_table(CACHE / "overture" / "infrastructure_power.parquet",
                      columns=["id", "class", "geometry", "source_tags", "names", "sources"])
    return t.to_pylist()


def island_mask():
    div = pq.read_table(CACHE / "overture" / "division_area.parquet").to_pylist()
    ie, ni = None, None
    counties = []
    for r in div:
        if r["class"] != "land":
            continue
        g = itm(shapely.from_wkb(r["geometry"]))
        if r["subtype"] == "country" and r["country"] == "IE":
            ie = g
        elif r["subtype"] == "region" and r["region"] == "GB-NIR":
            ni = g
        elif r["subtype"] == "region" and r["country"] == "IE":
            counties.append(((r["names"] or {}).get("primary", "").replace("County ", ""), g))
    return ie, ni, counties


def main():
    OUTDIR.mkdir(parents=True, exist_ok=True)
    rows = load()
    ie, ni, counties = island_mask()
    island = shapely.unary_union([ie, ni]).buffer(3000)
    domain = shapely.box(DOMAIN_E0, DOMAIN_N0, DOMAIN_E1, DOMAIN_N1)
    county_tree = STRtree([g for _, g in counties])

    def where(pt):
        if ni.contains(pt) or ni.distance(pt) < 200 and not ie.contains(pt):
            return "NI", "Northern Ireland"
        hits = county_tree.query(pt, predicate="intersects")
        if len(hits):
            return "ROI", counties[int(hits[0])][0]
        idx = county_tree.nearest(pt)
        return "ROI", counties[int(idx)][0]

    # ---- substations (>= 110 kV, or any voltage for snapping loose ends)
    stations = []
    for r in rows:
        if r["class"] != "substation":
            continue
        tags = dict(r["source_tags"] or [])
        g = itm(shapely.from_wkb(r["geometry"]))
        if not domain.contains(g.centroid) or not island.contains(g.centroid):
            continue
        kvs = kv_list(tags.get("voltage"))
        name = (r["names"] or {}).get("primary") or tags.get("name")
        foot = g if g.geom_type != "Point" else g.buffer(60)
        stations.append({"osm": r["id"], "name": name, "kvs": kvs, "maxkv": max(kvs) if kvs else 0,
                         "geom": foot, "point": g.geom_type == "Point", "tags": tags})
    log("substations in island:", len(stations), "of which >= 110 kV:", sum(s["maxkv"] >= MIN_KV for s in stations))

    # ---- plants
    plants = []
    for r in rows:
        if r["class"] != "plant":
            continue
        tags = dict(r["source_tags"] or [])
        g = itm(shapely.from_wkb(r["geometry"]))
        if not island.contains(g.centroid):
            continue
        out = tags.get("plant:output:electricity", "")
        m = re.match(r"\s*([\d.]+)\s*(MW|kW|GW)", out, re.I)
        mw = None
        if m:
            mw = float(m.group(1)) * {"mw": 1, "kw": 0.001, "gw": 1000}[m.group(2).lower()]
        plants.append({"osm": r["id"], "name": (r["names"] or {}).get("primary") or tags.get("name"),
                       "source": tags.get("plant:source"), "mw": mw, "geom": g})

    # ---- lines (split per voltage)
    ways = []
    for r in rows:
        if r["class"] not in ("power_line", "cable"):
            continue
        tags = dict(r["source_tags"] or [])
        kvs = kv_list(tags.get("voltage"))
        if not kvs or max(kvs) < MIN_KV:
            continue
        g = itm(shapely.from_wkb(r["geometry"]))
        if g.geom_type != "LineString" or not domain.intersects(g):
            continue
        hvdc = any(k in HVDC_KV for k in kvs) and r["class"] == "cable"
        if not hvdc and not island.intersects(g):
            continue
        circuits = int_list(tags.get("circuits"))
        cables = int_list(tags.get("cables"))
        name = (r["names"] or {}).get("primary") or tags.get("name")
        for i, kv in enumerate(kvs):
            if kv < MIN_KV:
                continue
            if kv in HVDC_KV and r["class"] == "cable":
                c = 1
            else:
                c = None
                if len(circuits) == len(kvs) and circuits[i]:
                    c = circuits[i]
                elif len(circuits) == 1 and circuits[0] and len(kvs) == 1:
                    c = circuits[0]
                elif len(cables) == len(kvs) and cables[i]:
                    c = max(1, round(cables[i] / 3))
                elif len(cables) == 1 and cables[0] and len(kvs) == 1:
                    c = max(1, round(cables[0] / 3))
                c = c or 1
            ways.append({"osm": r["id"], "kv": kv, "circuits": c, "cable": r["class"] == "cable",
                         "location": tags.get("location"), "name": name, "geom": g,
                         "hvdc": kv in HVDC_KV and r["class"] == "cable"})
    log("ways >= 110 kV:", len(ways), Counter(w["kv"] for w in ways))

    # ---- snap ends
    ends = []
    for wi, w in enumerate(ways):
        cs = list(w["geom"].coords)
        ends.append((wi, 0, cs[0]))
        ends.append((wi, 1, cs[-1]))
    pts = np.array([e[2][:2] for e in ends])
    uf = UnionFind(len(ends))
    tree = STRtree([shapely.Point(p) for p in pts])
    for i, p in enumerate(pts):
        for j in tree.query(shapely.Point(p).buffer(SNAP)):
            if j > i:
                uf.union(i, int(j))

    hv_stations = [s for s in stations if s["maxkv"] >= MIN_KV or True]
    st_tree = STRtree([s["geom"].buffer(STATION_BUFFER) for s in hv_stations])

    # node id per cluster: station or junction
    cluster_station = {}
    for i, p in enumerate(pts):
        root = uf.find(i)
        hits = st_tree.query(shapely.Point(p), predicate="intersects")
        if len(hits):
            # prefer the highest-voltage station if footprints overlap
            best = max((int(h) for h in hits), key=lambda h: (hv_stations[h]["maxkv"], -hv_stations[h]["geom"].area))
            prev = cluster_station.get(root)
            if prev is None or hv_stations[best]["maxkv"] > hv_stations[prev]["maxkv"]:
                cluster_station[root] = best

    # degree of each cluster
    deg = Counter(uf.find(i) for i in range(len(ends)))

    # loose ends: degree-1 clusters without station -> nearest station or plant within LOOSE
    plant_tree = STRtree([p["geom"] for p in plants]) if plants else None
    unresolved = []
    plant_attach = {}
    for i, p in enumerate(pts):
        root = uf.find(i)
        if root in cluster_station or deg[root] != 1:
            continue
        pt = shapely.Point(p)
        idx = st_tree.nearest(pt)
        d = hv_stations[int(idx)]["geom"].distance(pt)
        if d < LOOSE:
            cluster_station[root] = int(idx)
            continue
        if plant_tree is not None:
            pidx = int(plant_tree.nearest(pt))
            if plants[pidx]["geom"].distance(pt) < LOOSE:
                plant_attach[root] = pidx
                continue
        wi = ends[i][0]
        if not ways[wi]["hvdc"]:
            unresolved.append({"way": ways[wi]["osm"], "kv": ways[wi]["kv"], "e": round(p[0]), "n": round(p[1])})

    # ---- graph of clusters
    adj = defaultdict(list)   # cluster -> list of (way index, end index)
    for i, (wi, which, _) in enumerate(ends):
        adj[uf.find(i)].append((wi, which))

    def is_terminal(c):
        return c in cluster_station or c in plant_attach or len(adj[c]) != 2

    # Walk chains of ways between terminals, grouping by voltage.
    visited = set()
    raw_branches = []
    for c in list(adj):
        if not is_terminal(c):
            continue
        for wi, which in adj[c]:
            if wi in visited:
                continue
            chain = [(wi, which)]
            visited.add(wi)
            kv = ways[wi]["kv"]
            cur_c = uf.find(2 * wi + (1 - which))
            while not is_terminal(cur_c):
                nxt = [(w2, wh2) for (w2, wh2) in adj[cur_c] if w2 not in visited]
                if len(nxt) != 1 or ways[nxt[0][0]]["kv"] != kv:
                    break
                w2, wh2 = nxt[0]
                visited.add(w2)
                chain.append((w2, wh2))
                cur_c = uf.find(2 * w2 + (1 - wh2))
            raw_branches.append({"from": c, "to": cur_c, "chain": chain, "kv": kv})
    # isolated loops / chains not starting at a terminal
    log("chains:", len(raw_branches), "ways visited:", len(visited), "of", len(ways))

    # ---- node naming: station clusters merge by station; plants; junctions
    def node_key(c):
        if c in cluster_station:
            return ("S", cluster_station[c])
        if c in plant_attach:
            return ("P", plant_attach[c])
        return ("J", c)

    # Build branches with polylines
    branches = []
    for b in raw_branches:
        a, z = node_key(b["from"]), node_key(b["to"])
        if a == z:
            continue  # internal station wiring
        coords = []
        length = 0.0
        circuits = []
        cable_len = 0.0
        names = Counter()
        hvdc = False
        for wi, which in b["chain"]:
            w = ways[wi]
            cs = list(w["geom"].coords)
            if which == 1:
                cs = cs[::-1]
            coords.extend(cs if not coords else cs[1:])
            L = w["geom"].length
            length += L
            if w["cable"]:
                cable_len += L
            circuits.append((w["circuits"], L))
            if w["name"]:
                names[w["name"]] += 1
            hvdc |= w["hvdc"]
        # circuits: length-weighted mode
        cc = Counter()
        for c, L in circuits:
            cc[c] += L
        branches.append({"a": a, "z": z, "kv": b["kv"], "lengthM": length, "cableFrac": cable_len / max(length, 1),
                         "circuits": cc.most_common(1)[0][0], "name": names.most_common(1)[0][0] if names else None,
                         "hvdc": hvdc, "coords": coords, "ways": [ways[wi]["osm"] for wi, _ in b["chain"]]})
    log("branches:", len(branches))

    # Merge parallel branches (same endpoints and voltage): separate OSM ways for each circuit.
    groups = defaultdict(list)
    for b in branches:
        k = (min(b["a"], b["z"]), max(b["a"], b["z"]), b["kv"], b["hvdc"])
        groups[k].append(b)
    merged = []
    for k, bs in groups.items():
        if len(bs) == 1:
            merged.append(bs[0])
            continue
        # parallel ways along the same corridor: sum circuits, keep the longest geometry for drawing
        base = max(bs, key=lambda b: b["lengthM"])
        total = sum(b["circuits"] for b in bs)
        base = dict(base, circuits=total, parallelWays=len(bs),
                    altCoords=[b["coords"] for b in bs if b is not base])
        merged.append(base)
    branches = merged
    log("branches after merging parallels:", len(branches))
    branches, simplify_log = simplify(branches)
    log("branches after simplification:", len(branches), simplify_log)

    # ---- buses
    station_kvs = defaultdict(set)
    for b in branches:
        for end in (b["a"], b["z"]):
            station_kvs[end].add(b["kv"])

    def node_pos(key):
        kind, i = key
        if kind == "S":
            c = hv_stations[i]["geom"].centroid
        elif kind == "P":
            c = plants[i]["geom"].centroid
        else:
            c = shapely.Point(pts[i])
        return c.x, c.y

    nodes = {}
    for key, kvs in station_kvs.items():
        kind, i = key
        e, n = node_pos(key)
        country, county = where(shapely.Point(e, n))
        if kind == "S":
            s = hv_stations[i]
            name = clean_name(s["name"]) or None
            foot = s["geom"]
            nodes[key] = {"id": f"S{i}", "kind": "station", "name": name, "osmName": s["name"], "e": e, "n": n,
                          "country": country, "county": county, "kvs": sorted(kvs),
                          "footprint": None if s["point"] else [list(map(lambda v: round(v, 1), p))
                                                                for p in shapely.get_coordinates(
                                                                    foot.simplify(2).exterior if foot.geom_type == "Polygon"
                                                                    else max(foot.geoms, key=lambda g: g.area).simplify(2).exterior)]}
        elif kind == "P":
            p = plants[i]
            nodes[key] = {"id": f"P{i}", "kind": "plant", "name": clean_name(p["name"]) or "Generating site",
                          "e": e, "n": n, "country": country, "county": county, "kvs": sorted(kvs), "footprint": None}
        else:
            nodes[key] = {"id": f"J{i}", "kind": "tee", "name": None, "e": e, "n": n, "country": country,
                          "county": county, "kvs": sorted(kvs), "footprint": None}

    # Unnamed stations and tees are named after the nearest named station for readability
    named = [v for v in nodes.values() if v["kind"] == "station" and v["name"]]
    for v in nodes.values():
        if v["kind"] == "station" and not v["name"]:
            near = min(named, key=lambda s: (s["e"] - v["e"]) ** 2 + (s["n"] - v["n"]) ** 2)
            d = math.hypot(near["e"] - v["e"], near["n"] - v["n"]) / 1000
            v["name"] = f"{near['name']} area station" if d < 15 else f"Station {v['id']}"
    for v in nodes.values():
        if v["kind"] == "tee":
            near = min(named, key=lambda s: (s["e"] - v["e"]) ** 2 + (s["n"] - v["n"]) ** 2)
            d = math.hypot(near["e"] - v["e"], near["n"] - v["n"]) / 1000
            v["name"] = f"Tee near {near['name']} ({d:.0f} km)"

    buses = []
    bus_id = {}
    for key, v in nodes.items():
        for kv in v["kvs"]:
            bid = f"{v['id']}-{kv}"
            bus_id[(key, kv)] = bid
            buses.append({"id": bid, "node": v["id"], "kv": kv})

    out_branches = []
    lines_geom = {}
    for i, b in enumerate(sorted(branches, key=lambda b: (-b["kv"], -b["lengthM"]))):
        bid = f"L{i}"
        kind = "hvdc" if b["hvdc"] else ("cable" if b["cableFrac"] > 0.5 else "line")
        out_branches.append({"id": bid, "from": bus_id[(b["a"], b["kv"])], "to": bus_id[(b["z"], b["kv"])],
                             "kind": kind, "kv": b["kv"], "lengthKm": round(b["lengthM"] / 1000, 3),
                             "cableFraction": round(b["cableFrac"], 3), "circuits": b["circuits"],
                             "name": b["name"], "osmWays": b["ways"]})
        simp = shapely.LineString(b["coords"]).simplify(15)
        lines_geom[bid] = [[round(x, 1), round(y, 1)] for x, y in simp.coords]

    # transformers between voltage levels in a station
    tx = 0
    for key, v in nodes.items():
        kvs = sorted(v["kvs"], reverse=True)
        for hi, lo in zip(kvs, kvs[1:]):
            if hi in HVDC_KV or lo in HVDC_KV:
                continue
            out_branches.append({"id": f"T{tx}", "from": bus_id[(key, hi)], "to": bus_id[(key, lo)], "kind": "transformer",
                                 "kv": hi, "kvLow": lo, "lengthKm": 0, "circuits": 2, "name": f"{v['name']} {hi}/{lo} kV"})
            tx += 1

    # ---- connectivity
    parent = {b["id"]: b["id"] for b in buses}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for br in out_branches:
        if br["kind"] == "hvdc":
            continue
        ra, rb = find(br["from"]), find(br["to"])
        if ra != rb:
            parent[rb] = ra
    comps = Counter(find(b["id"]) for b in buses)
    main_root = comps.most_common(1)[0][0]
    islands = [(r, n) for r, n in comps.items() if r != main_root]
    log("buses:", len(buses), "branches:", len(out_branches), "AC islands besides main:", len(islands),
        "buses in islands:", sum(n for _, n in islands))

    # Drop AC islands that are not connected to the main system (data gaps); record them.
    keep = {b["id"] for b in buses if find(b["id"]) == main_root}
    hvdc_ends = {x for br in out_branches if br["kind"] == "hvdc" for x in (br["from"], br["to"])}
    keep |= hvdc_ends
    dropped_buses = [b for b in buses if b["id"] not in keep]
    buses = [b for b in buses if b["id"] in keep]
    out_branches = [br for br in out_branches if br["from"] in keep and br["to"] in keep]
    used_nodes = {b["node"] for b in buses}
    out_nodes = [v for v in nodes.values() if v["id"] in used_nodes]

    # ---- plants attached to nearest bus (prefer 110 kV level)
    node_by_id = {v["id"]: v for v in out_nodes}
    bus_by_node = defaultdict(list)
    for b in buses:
        bus_by_node[b["node"]].append(b)
    station_nodes = [v for v in out_nodes if v["kind"] in ("station", "plant")]
    st_pts = np.array([[v["e"], v["n"]] for v in station_nodes])
    out_plants = []
    for i, p in enumerate(plants):
        c = p["geom"].centroid
        d = np.hypot(st_pts[:, 0] - c.x, st_pts[:, 1] - c.y)
        j = int(np.argmin(d))
        node = station_nodes[j]
        bs = sorted(bus_by_node[node["id"]], key=lambda b: (b["kv"] != 110, b["kv"]))
        out_plants.append({"id": f"G{i}", "name": clean_name(p["name"]), "osmName": p["name"], "source": p["source"],
                           "mwTag": p["mw"], "e": round(c.x, 1), "n": round(c.y, 1), "bus": bs[0]["id"],
                           "distanceToBusKm": round(float(d[j]) / 1000, 2)})

    # ---- turbines and towers for rendering
    turbines = []
    towers = []
    hv_line_union = shapely.unary_union([w["geom"] for w in ways if not w["hvdc"]]).buffer(3)
    line_tree = STRtree([w["geom"] for w in ways if not w["hvdc"]])
    hv_ways = [w for w in ways if not w["hvdc"]]
    for r in rows:
        if r["class"] == "generator":
            tags = dict(r["source_tags"] or [])
            if tags.get("generator:source") == "wind":
                g = itm(shapely.from_wkb(r["geometry"])).centroid
                if island.contains(g):
                    turbines.append((g.x, g.y))
        elif r["class"] in ("power_tower", "power_pole"):
            pass
    tower_rows = [r for r in rows if r["class"] in ("power_tower",)]
    for r in tower_rows:
        g = itm(shapely.from_wkb(r["geometry"]))
        hits = line_tree.query(g, predicate="dwithin", distance=3)
        if len(hits):
            kv = max(hv_ways[int(h)]["kv"] for h in hits)
            towers.append((g.x, g.y, kv, 1))
    del hv_line_union
    with open(OUTDIR / "turbines.bin", "wb") as f:
        f.write(np.array(turbines, dtype=np.float32).tobytes())
    with open(OUTDIR / "towers.bin", "wb") as f:
        f.write(np.array(towers, dtype=np.float32).tobytes())

    # ---- synthetic demand weights and wind allocation per bus
    divs = pq.read_table(CACHE / "overture" / "division.parquet").to_pylist()
    load_buses = [b for b in buses if b["kv"] in (110, 220, 275) and node_by_id[b["node"]]["kind"] == "station"]
    lb_pts = np.array([[node_by_id[b["node"]]["e"], node_by_id[b["node"]]["n"]] for b in load_buses])
    lb_country = [node_by_id[b["node"]]["country"] for b in load_buses]
    pop_w = defaultdict(float)
    for r in divs:
        if r["subtype"] != "locality" or not r["population"] or r["country"] not in ("IE", "GB"):
            continue
        if r["country"] == "GB" and r["region"] != "GB-NIR":
            continue
        g = itm(shapely.from_wkb(r["geometry"]))
        c = g.centroid
        country = "NI" if r["country"] == "GB" else "ROI"
        mask = np.array([cc == country for cc in lb_country])
        is110 = np.array([b["kv"] == 110 for b in load_buses])
        d = np.hypot(lb_pts[:, 0] - c.x, lb_pts[:, 1] - c.y) + np.where(mask & is110, 0, 1e9)
        pop = r["population"]
        # Large towns and cities are supplied from several stations: spread over 110 kV
        # stations within a radius that grows with population, weighted by inverse distance.
        radius = 3000 + 14 * math.sqrt(pop)
        near = np.where(d < radius)[0]
        if pop > 30_000 and len(near) > 1:
            w = 1 / (d[near] + 1500)
            w = w / w.sum()
            for j, wj in zip(near, w):
                pop_w[load_buses[int(j)]["id"]] += pop * float(wj)
        else:
            pop_w[load_buses[int(np.argmin(d))]["id"]] += min(pop, 120_000)
    load_weights = {}
    for country in ("ROI", "NI"):
        ids = [b["id"] for b, cc in zip(load_buses, lb_country) if cc == country and b["kv"] == 110]
        tot_pop = sum(pop_w[i] for i in ids) or 1
        for i in ids:
            load_weights[i] = round(0.6 * pop_w[i] / tot_pop + 0.4 / len(ids), 6)
    turb_count = Counter()
    gen_buses = [b for b in buses if b["kv"] == 110 and node_by_id[b["node"]]["kind"] == "station"]
    gb_pts = np.array([[node_by_id[b["node"]]["e"], node_by_id[b["node"]]["n"]] for b in gen_buses])
    for x, y in turbines:
        d = np.hypot(gb_pts[:, 0] - x, gb_pts[:, 1] - y)
        turb_count[gen_buses[int(np.argmin(d))]["id"]] += 1
    (OUTDIR / "allocation.json").write_text(json.dumps({
        "note": "Synthetic allocation. Demand weights: 60% locality population (Overture), 40% even across 110 kV "
                "stations, per jurisdiction. Wind: OSM turbine count nearest each 110 kV station.",
        "demandWeights": load_weights, "turbinesByBus": dict(turb_count)}, separators=(",", ":")))

    net = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": "OpenStreetMap contributors (ODbL) via Overture Maps Foundation, release 2026-09-23.1",
        "crs": ITM,
        "method": __doc__.split("Method", 1)[1].strip(),
        "nodes": out_nodes,
        "buses": buses,
        "branches": out_branches,
    }
    (OUTDIR / "network.json").write_text(json.dumps(net, separators=(",", ":")))
    (OUTDIR / "lines.json").write_text(json.dumps({k: v for k, v in lines_geom.items() if any(
        br["id"] == k for br in out_branches)}, separators=(",", ":")))
    (OUTDIR / "plants.json").write_text(json.dumps(out_plants, separators=(",", ":")))

    # ---- report
    kv_count = Counter(br["kv"] for br in out_branches if br["kind"] in ("line", "cable"))
    km = defaultdict(float)
    for br in out_branches:
        if br["kind"] in ("line", "cable"):
            km[br["kv"]] += br["lengthKm"]
    rep = ["# Network topology report", "",
           f"Generated {net['generated']} from {net['source']}.", "",
           "## Counts", "",
           f"- Nodes: {len(out_nodes)} ({Counter(v['kind'] for v in out_nodes)})",
           f"- Buses: {len(buses)}",
           f"- Branches: {len(out_branches)} ({Counter(br['kind'] for br in out_branches)})",
           f"- Circuit groups by voltage: {dict(sorted(kv_count.items()))}",
           f"- Route length by voltage (km, merged parallel ways counted once): "
           f"{ {k: round(v) for k, v in sorted(km.items())} }",
           f"- Plants attached: {len(out_plants)}; wind turbines: {len(turbines)}; towers on >= 110 kV lines: {len(towers)}",
           "", "## Data gaps", "",
           f"- AC islands not connected to the main system (dropped): {len(islands)} groups, {len(dropped_buses)} buses",
           f"- Unresolved line ends (no station or plant within {LOOSE:.0f} m): {len(unresolved)}", ""]
    for u in unresolved[:60]:
        rep.append(f"  - way {u['way']} ({u['kv']} kV) at E {u['e']} N {u['n']}")
    rep += ["", "## Dropped buses", ""] + [f"- {b['id']} ({b['kv']} kV)" for b in dropped_buses[:80]]
    (OUTDIR / "report.md").write_text("\n".join(rep) + "\n")
    log("written", len(out_nodes), "nodes")


if __name__ == "__main__":
    main()
