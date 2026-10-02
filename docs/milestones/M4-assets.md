# Milestone 4: Assets and level of detail

Status: complete for review. Screenshots in `docs/screens/m4/`.

## What works

- **Support structures at real positions.** `tools/build_network.py` exports 35,101 supports from the unsimplified OSM line geometry (OSM draws lines tower to tower). 17,400 are lattice towers (OSM tower nodes, and everything at 220 kV and above). 17,701 are 110 kV wood H-polesets where OSM has no tower tag. Long gaps are filled at the ruling span for the voltage class.
- **Procedural asset kit** (`src/scene/assets/geometry.ts`): lattice towers per class (tapered legs, girts, face bracing, truss crossarms, insulator strings, foundations), wood polesets, turbine tower, nacelle and rotor. All instanced, oriented to the bisector of adjacent spans, placed on the terrain and dissolved in with distance (dithered), so nothing pops.
- **Conductors** at site scale: a catenary for every phase and the earth wire between real supports. Sag comes from the conductor temperature model and swing from the simulated wind; colour follows loading (amber above 60%, crimson above 90%).
- **Thermal and sag model** (`src/sim/thermal.ts`, 5 tests): simplified IEEE 738 heat balance. Temperature reaches the design limit at full rating in rating conditions and runs cooler in wind. Sag follows thermal elongation of the conductor (a few metres between cool and hot on a 330 m span, as in practice). Blow-out comes from the drag-to-weight ratio.
- **Turbines** at all 3,809 OSM turbine positions. Rotor speed follows the simulated hub-height wind through tip-speed ratio, capped at rated rpm; rotors stop below cut-in and feather above cut-out.
- **Substations** laid out inside their real OSM footprints: minimum rotated rectangle, voltage sections sized by class, one bay per connected circuit (breaker, disconnectors, current transformers on post insulators), gantries, tubular busbars, transformer units (count from the sizing rule) with radiators, conservators and bushings, control building, palisade fence, gravel yard.
- **Data centre campuses** beside the cluster stations and for the hypothetical north west user: precast halls, glazed band lit at dusk by the simulated sun, rooftop dry coolers, generator rows with stacks, own 110 kV compound.
- **Land cover** from OSM via Overture (forest, bog and wetland, heath, grassland, rock, sand) as a 128 m texture. Close to the ground there is micro-relief by class (canopy in forest, hummocks on bog), fading with distance.
- Ribbons hand over to modelled conductors below about 4 km.

## What is approximate

- Tower and poleset geometry is typical for the class, not each structure's actual design.
- Substation internals are generated from the circuit count and voltages, not real single-line diagrams.
- Campus positions are offset from the station; the hero campus is composed in M6.
- Conductor motion is an analytic catenary with a wind-driven swing angle. Position-based dynamics on the GPU, from the plan, is deferred (allowed by the cut order), because the analytic result is what the PBD would converge to.

## Next improvements

- Lattice members read faint at mid distance; add a coarser impostor level with thicker members.
- Trees in forest areas at site scale.
- Heat shimmer over the dry coolers (M7).
