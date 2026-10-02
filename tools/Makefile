# Rebuild everything under public/data from public sources.
PY ?= python3

all: terrain

deps:
	$(PY) -m pip install -r requirements.txt

dem:
	$(PY) fetch_dem.py

overture:
	$(PY) overture.py

terrain: dem overture
	$(PY) build_terrain.py

.PHONY: all deps dem overture terrain
