# Milestone 2: World

Status: complete for review. Screenshots in `docs/screens/m2/` (Playwright, production build, WebGPU through SwiftShader unless the file name says webgl).

## What works

- **Terrain data pipeline** (`tools/`): Copernicus GLO-30 (37 tiles) reprojected to Irish Transverse Mercator at 32 m, coastline and country areas from OpenStreetMap via Overture Maps, 2,097 lakes. Output is a quadtree of 16-bit PNG tiles (64 m everywhere, 32 m in three focus regions: north Mayo, the north west corridor and west Dublin) plus national textures: a signed distance to water, a country mask (ROI, NI, GB) and baked sky visibility. 45.8 MB in total, reproducible with `make -C tools all`.
- **Terrain renderer**: chunked LOD (CDLOD) with geomorphing and skirts, streaming tiles in workers, nearest loaded ancestor as fallback so the island is never missing. Normals from the height data per fragment. Vertical exaggeration 2.5x at national scale easing to 1.0x below about 3 km, so site views are true scale.
- **Two themes**: Specimen (plaster relief on warm paper, soft north-west fill as in a gallery) and Control Room (basalt relief, hairline emissive contours that adapt their interval to altitude and fade where they would crowd). T cross-fades between them.
- **Sea**: subtle swell normals fading with distance, shelf colour from the distance field, shallow tint and foam from the true water depth read from the depth buffer.
- **Sky, sun and light**: sun from a solar position calculation (NOAA) for the scenario date and place, Irish civil time with summer time. Sky gradient and sun-side glow per theme, aerial haze thinning with height, image-based lighting re-baked from the sky as the sun moves, shadows from a sun shadow map framed to the view, simple eye adaptation for dusk and night.
- **Post-processing**: GTAO, temporal anti-aliasing, restrained bloom (off in daytime Specimen), vignette, AgX tone mapping.
- **Shell**: masthead, data badge, status pill, hairline 24-hour scrubber, debug overlay on D (fps, frame time, draw calls, triangles, terrain nodes, altitude, exaggeration, backend), fallback card when neither WebGPU nor WebGL2 is available.
- **Benchmark**: `?bench=1` flies a fixed national, regional and site path and reports fps, p50 and p95 frame time per tier, with a copy button.
- **WebGL2 fallback**: the same materials run on three's WebGL2 backend (`?backend=webgl`); see the two webgl screenshots.

## What is approximate

- Great Britain and the Isle of Man are context only and dissolve into the sea towards the edge of the data domain.
- Sea depth is shaped from distance to the coast, not real bathymetry (none reachable from this environment).
- Lowland texture in the bogs of Mayo is real surface data (Copernicus is a surface model, so it includes trees and hedges), not noise.

## Not yet verified

- **Frame rate on real hardware.** This container renders on the CPU. Please run `/?bench=1` on an M1/M2 MacBook Pro at 1440p and on a mid-range Windows laptop, and paste the copied result back.

## Next improvements

- Close-up terrain still looks soft below about 5 km: add a detail normal layer and land-cover tinting (bog, forest, rock) in M4 alongside the site assets.
- Dusk at national scale could be warmer; revisit in the polish pass with the network lit.
- Control Room night is intentionally dark ahead of the emissive network (M3).
