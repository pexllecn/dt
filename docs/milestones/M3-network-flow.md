# Milestone 3: Network and flow

Status: complete for review. Screenshots in `docs/screens/m3/`.

## What works

- **Network from OpenStreetMap** (`tools/build_network.py`, via Overture Maps): every line and cable at 110 kV and above on the island, plus the HVDC cables. After clean-up: 296 stations, 36 tee points, 382 buses, 480 branches (336 overhead circuits, 92 cables, 47 transformer groups, 5 HVDC sections). Route length: 400 kV 466 km, 275 kV 410 km, 220 kV 1,724 km, 110 kV 5,400 km. Named circuits come through, e.g. Flagford to Srananagh 220 kV (55.1 km, one circuit).
- **Clean-up steps, each exact or a data fix** (listed with counts in `public/data/network/report.md`): 42 station-entry tees contracted into their station, 22 dangling dead ends dropped, 17 pass-through tees merged in series (exact in DC flow), 11 tiny AC islands with no connection to the main system dropped (14 buses).
- **Simulation runs the full topology.** DC power flow on 382 buses is cheap, so there is no approximating reduction: a whole day (96 intervals with a full N-1 sweep each) computes in about 0.2 to 0.3 s in the worker.
- **Engine** (`src/sim`), deterministic and seeded: demand profiles, data centre load, synthetic wind field with exposure and fronts, solar from sun position, battery schedule, merit-order dispatch with the minimum-units constraint and the SNSP cap, DC power flow, transfer factors, and N-1 per circuit or per transformer unit.
- **N-1 is per circuit.** Losing one circuit of a double circuit, or one unit of a transformer group, uses the partial-outage form of the distribution factors: Δf_l = T_lk · α f_k / (1 − α s_k), with α = 1 for a single circuit (the classic LODF).
- **Calibration** against public figures: data centre share of ROI demand about 19% to 27% through an October day (23% annual, CSO 2025), reaching about 31% in 2034 (EirGrid forecast cited by the CRU); all-island evening peak about 6.6 GW on a mid-October weekday; SNSP stays at or below the 75% cap.
- **Rendering**: ribbons by voltage class (screen-space width, ink in Specimen, emissive in Control Room) coloured by loading (below 60%, 60 to 90% amber, above 90% crimson with a hatch, pulsing above 100%), and flow particles whose speed is proportional to MW and whose direction follows the flow sign. Tripped lines draw dashed.
- **Stats row**: Demand, Wind (with curtailment), SNSP, Data centre share, each with its source label.
- **Tests**: 17 unit tests, including a hand-calculated three-bus case, Kirchhoff balance at every bus for all 96 intervals on the real network (within 1e-6 MW), LODF against a full re-solve for a sample of outages (within 1e-6 MW), islanding detection, and plausibility of demand, SNSP and data centre share.

## What is approximate (and labelled)

- Electrical parameters are typical values by voltage class (`src/config/network.ts`), not utility data.
- **Transformer unit counts** are not in the map data. They are sized so that, with one unit out, the remainder carry a reference winter evening flow with 10% margin (minimum two). This mirrors how stations are planned and is stated as an assumption.
- **Demand allocation** is synthetic: 60% by town and city population (spread over nearby stations for large places), 40% evenly across 110 kV stations.
- Two documented overrides (`branchOverrides`): Huntstown's export circuits are modelled as two circuits where the map data tags one.
- Results inside Dublin city's 110 kV cable network are indicative only: the load allocation there is the weakest part of the model.

## Base case at 18:00 on 14 October 2026 (illustrative)

About 15 of 475 circuits exceed their rating under some single outage. The most notable are in central Dublin, the Letterkenny to Strabane 110 kV tie, and north Mayo. There, Glenree to Cunghill and Bellacorick to Castlebar back each other up at about 119%. That is the constraint the hero scenario turns on.

## Next

- HVDC interconnector cables drawn as subsea routes with their flow.
- Hover and click on a line for its label, MW, loading and worst N-1 case (feeds the asset inspector in M5).
- Rendering frame rate on real hardware still needs your `?bench=1` runs.
