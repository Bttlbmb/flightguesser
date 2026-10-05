"""Build the compact local answer index from the attributed airport CSV.

Usage: python3 scripts/prepare-airports.py /path/to/airport-codes.csv
The download is intentionally separate: builds never depend on network access.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path, help="downloaded datasets/airport-codes CSV")
source = parser.parse_args().source
airports = []
identifiers = set()
with source.open(encoding="utf-8-sig", newline="") as csv_file:
    rows = csv.DictReader(csv_file)
    required = {"ident", "type", "name", "iata_code", "iso_country", "coordinates"}
    if not required.issubset(rows.fieldnames or []):
        sys.exit("The source is missing required airport-codes CSV columns.")
    for row in rows:
        if row["type"] not in ("large_airport", "medium_airport", "small_airport"):
            continue
        identifier = (row.get("icao_code") or row["ident"] or "").strip().upper()
        code = (row["iata_code"] or "").strip().upper()
        country = (row["iso_country"] or "").strip().upper()
        name = (row["name"] or "").strip()
        city = (row.get("municipality") or "").strip() or name
        if not (re.fullmatch(r"[A-Z0-9-]{3,8}", identifier)
                and re.fullmatch(r"[A-Z0-9]{3}", code)
                and re.fullmatch(r"[A-Z]{2}", country)
                and 0 < len(name) <= 300 and 0 < len(city) <= 300):
            continue
        try:
            # This source writes latitude first, unlike GeoJSON's longitude first.
            lat, lon = map(float, (row["coordinates"] or "").split(","))
        except ValueError:
            continue
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        # Conflicting identities cannot safely become selectable city choices.
        if identifier in identifiers:
            sys.exit(f"Duplicate airport identifier: {identifier}; the existing index was not changed.")
        identifiers.add(identifier)
        airports.append({
            "id": identifier, "code": code, "name": name, "city": city, "country": country,
            "lat": round(lat, 6), "lon": round(lon, 6),
            "major": row["type"] == "large_airport",
        })
if not airports:
    sys.exit("No usable airports found; the existing index was not changed.")
airports.sort(key=lambda airport: (not airport["major"], airport["city"], airport["code"]))
target = Path(__file__).resolve().parents[1] / "public/data/airports.json"
target.parent.mkdir(parents=True, exist_ok=True)
# Version 1 rows: id, code, name, city, country, latitude, longitude, optional major=1.
# Keep the schema in sync with decodeAirportData in public/airports.js.
packed = [[a["id"], a["code"], a["name"], a["city"], a["country"], a["lat"], a["lon"]]
          + ([1] if a["major"] else []) for a in airports]
target.write_text(json.dumps({"version": 1, "airports": packed}, ensure_ascii=False,
                            separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Prepared {len(airports)} airports; {target.stat().st_size:,} bytes")
print(f"Source SHA-256: {hashlib.sha256(source.read_bytes()).hexdigest()}")
