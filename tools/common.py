"""Shared constants for the data pipeline.

The world domain is a square in Irish Transverse Mercator (EPSG:2157), sized as a
power of two in metres so that every quadtree level has an integer tile size.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
OUT = ROOT / "public" / "data"

ITM = "EPSG:2157"

# Domain: 524,288 m square. West edge leaves ~110 km of Atlantic for the fly-in.
DOMAIN_E0 = 320_000.0
DOMAIN_N0 = 478_000.0
DOMAIN_SIZE = 524_288.0
DOMAIN_E1 = DOMAIN_E0 + DOMAIN_SIZE
DOMAIN_N1 = DOMAIN_N0 + DOMAIN_SIZE

# Scene origin (domain centre). Scene x = E - ORIGIN_E, scene z = -(N - ORIGIN_N).
ORIGIN_E = DOMAIN_E0 + DOMAIN_SIZE / 2
ORIGIN_N = DOMAIN_N0 + DOMAIN_SIZE / 2

# Lon/lat bounding box used for source queries (generous).
BBOX_LONLAT = (-12.6, 51.0, -4.0, 55.9)

TILE_PX = 256           # intervals per tile; tiles store TILE_PX + 1 samples per side
MAX_LEVEL_ALL = 5       # 64 m spacing everywhere on land
MAX_LEVEL_FOCUS = 6     # 32 m spacing in focus regions

# Height encoding (tiles): 15-bit height code plus a lake flag in the low bit.
H_OFFSET = 100.0
H_SCALE = 4.0           # 0.25 m steps

# Signed distance to water encoding: uint16 = 32768 + clamp(d, -SDF_RANGE, SDF_RANGE) * SDF_SCALE
SDF_RANGE = 16_000.0
SDF_SCALE = 2.0         # 0.5 m steps

# Focus regions (ITM metres, E/N centre and half-size). Kept at 32 m.
FOCUS_REGIONS = {
    "north_mayo": (497_000.0, 828_000.0, 30_000.0),
    "north_west": (575_000.0, 830_000.0, 30_000.0),
    "west_dublin": (705_000.0, 735_000.0, 20_000.0),
}


def tile_size(level: int) -> float:
    return DOMAIN_SIZE / (2 ** level)
