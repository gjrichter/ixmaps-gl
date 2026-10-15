#!/usr/bin/env python3
"""Build data/comuni_centro_2024.json: one "city centre" point per comune (01/01/2024 codes).

The centre is the comune's town hall (sede comunale) from the ISTAT list of
administrative units 2011, as published by Andrea Borruso
(github.com/aborruso/centroidiurbanfabric, ElencoUnitaAmministrative2011.geojson;
its point geometry equals ISTAT's X/Y_WGS84_32N sede-comunale coordinates).
It is used by js/comune_selector.js to centre the map on a comune.

Comuni that have merged since 2011 (no 2011 point under their 2024 code) take the
town hall of their most populous (POP_2011) predecessor that lies inside the new
boundary; if none does, the centre of the boundary's bounding box.

No dependencies beyond the Python 3 standard library.
  python3 build_comuni_centro.py [out.json]     (default: ../data/comuni_centro_2024.json)
"""
import gzip, json, os, sys, urllib.request

BOUNDARIES = "https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/Istat/comuni_2024/ondata_confini_amministrativi_api_v2_it_20240101_comuni.s.topo.json.gz"
ELENCO_2011 = "https://raw.githubusercontent.com/aborruso/centroidiurbanfabric/master/output/ElencoUnitaAmministrative2011.geojson"


def fetch_json(url):
    raw = urllib.request.urlopen(url).read()
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass  # already plain
    return json.loads(raw)


def decode_arcs(topo):
    t = topo["transform"]
    out = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * t["scale"][0] + t["translate"][0], y * t["scale"][1] + t["translate"][1]))
        out.append(pts)
    return out


def rings_of(geom_arcs, arcs):
    """Every ring (list of points) of a Polygon/MultiPolygon."""
    def ring(idxs):
        pts = []
        for i in idxs:
            seg = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.extend(seg if not pts else seg[1:])
        return pts
    rings = []
    def walk(a):
        if a and isinstance(a[0], int):
            rings.append(ring(a))
        else:
            for e in a:
                walk(e)
    walk(geom_arcs)
    return rings


def inside(pt, rings):
    """Even-odd point-in-polygon over all rings (holes and multipolygons included)."""
    x, y = pt
    hit = False
    for r in rings:
        j = len(r) - 1
        for i in range(len(r)):
            xi, yi = r[i]; xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "comuni_centro_2024.json")
    topo = fetch_json(BOUNDARIES)
    elenco = fetch_json(ELENCO_2011)["features"]
    town = {int(f["properties"]["PRO_COM"]): (tuple(f["geometry"]["coordinates"]), f["properties"].get("POP_2011") or 0) for f in elenco}
    arcs = decode_arcs(topo)
    geoms = topo["objects"][next(iter(topo["objects"]))]["geometries"]
    codes24 = {g["properties"]["pro_com"] for g in geoms}
    orphans = {c: v for c, v in town.items() if c not in codes24}   # 2011 comuni that no longer exist under that code

    centre, stats = {}, {"town_hall": 0, "merged_predecessor": 0, "bbox_centre": 0}
    for g in geoms:
        code = g["properties"]["pro_com"]
        if code in town:
            centre[code] = town[code][0]; stats["town_hall"] += 1
            continue
        rings = rings_of(g["arcs"], arcs)
        xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
        box = (min(xs), min(ys), max(xs), max(ys))
        cands = [(pop, pt) for pt, pop in orphans.values()
                 if box[0] <= pt[0] <= box[2] and box[1] <= pt[1] <= box[3] and inside(pt, rings)]
        if cands:
            centre[code] = max(cands)[1]; stats["merged_predecessor"] += 1
        else:
            centre[code] = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2); stats["bbox_centre"] += 1

    doc = {
        "about": "City centre per comune (01/01/2024 codes): town hall (sede comunale) of the comune, or of its most populous predecessor for merged comuni.",
        "source": "ISTAT Elenco unita amministrative 2011 (sede comunale) via github.com/aborruso/centroidiurbanfabric; boundaries: ISTAT 01/01/2024 (ondata confini amministrativi)",
        "centre": {str(c): [round(p[0], 4), round(p[1], 4)] for c, p in sorted(centre.items())},
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote %s: %d comuni, %d bytes; %s" % (out_path, len(centre), os.path.getsize(out_path), stats))


if __name__ == "__main__":
    main()
