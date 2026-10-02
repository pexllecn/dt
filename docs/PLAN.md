# Cognitive Grid Twin: build plan

Milestone 1 of 8. For approval. No application code has been written yet.
2 October 2026

---

## 1. Summary

A browser-based, cinematic 3D twin of the all-island transmission grid. The renderer is three.js WebGPU with a WebGL2 fallback. A deterministic simulation runs in a Web Worker: DC power flow, merit-order dispatch with an SNSP cap, N-1 by LODF, and a conductor thermal and sag model. Rule-based agents sit on every modelled asset and publish typed, explainable traces. A coordinator turns those traces into recommendations that a human must approve. Four scripted scenarios run in Director mode, and the same world is open in Explore mode with Hand, Cut, Load and Restore tools.

The engineering is designed to survive the follow-up meeting:

- Every number in config carries its source label in the type system.
- The network reduction is exact, or documented where it is not.
- Firm capacity uses the standard PTDF/LODF method.
- Scenario outcomes come from calibrated inputs, never from scripted outputs.
- The Method notes state plainly what the model does not do: AC flow, voltage, stability and protection.

**The picture people should remember.** Dusk over north Mayo, looking inland from the Atlantic edge. A wind cluster turns on the bog ridge and flow particles run down the 110 kV line into the lit campus of the hypothetical 50 MW user. Around the campus a *firmness dial* is set into the ground: a 24-hour ring of 96 segments, one per 15 minutes. A segment is ink where the network can serve the load firmly under N-1 and crimson where it cannot. An inner ring shows the share matched by local wind. In one image it answers the planners' question: *firm here, not firm then, and this is why.* The ring is a lit 3D object in the scene, not a UI overlay.

---

## 2. What I verified in this environment before planning

| Item | Finding | Consequence |
|---|---|---|
| Repository | Empty, branch `claude/friendly-mccarthy-yce60l` | Greenfield |
| Machine | Node 22, Python 3.11, 4 CPUs, 15 GB RAM, **no GPU** | Frame rate can't be measured here (see Risks) |
| OSM sources | Overpass API and Geofabrik are **blocked** by this environment's network policy (HTTP 403) | Use the Overture Maps mirror of OSM (below), or you add those hosts to the environment's allowed domains |
| Overture Maps (S3) | Reachable. Release `2026-09-23.1`, `base/infrastructure`, OSM-derived (ODbL), original OSM tags preserved in `source_tags`. I ran a test extract for Ireland. | Viable OSM source with the same content |
| Test extract (island) | 2,225 `power=line` ways, 3,412 cables, 1,732 substations (389 at 110 kV or above: 320 × 110, 52 × 220, 11 × 275, 5 × 400, 1 HVDC converter), **23,321 tower positions**, 235 plants (many with MW tags, e.g. Moneypoint 915 MW, Whitegate 445 MW), 33,150 generator points (individual turbines). Voltage tags present. Named circuits present, e.g. "Srananagh - Flagford 220kV", "Cashla - Flagford 220kV". | Real tower and turbine positions, real substation footprints and real circuit names are all available |
| DEM | Copernicus GLO-30 COG tiles on AWS reachable (about 30 MB per 1° tile, about 35 tiles for the island) | Terrain pipeline is feasible as specified |
| Headless Chromium | WebGPU works with `--enable-unsafe-webgpu` through SwiftShader (CPU). WebGL2 also works through SwiftShader. | Playwright can screenshot both backends. Real fps can't be measured here. |
| three.js 0.186.1 | Has WebGPURenderer, `RenderPipeline`, TRAA, GTAO, Bloom, SMAA, Depth of Field, `CSMShadowNode`, `SkyMesh`, `Line2NodeMaterial`, reversed depth buffer | Everything in the visual spec has a WebGPU-native building block |
| React Three Fiber | v9.8 (the WebGPU-capable line) requires **React 19** (`>=19 <19.4`). v8 (React 18) has no first-class async WebGPU renderer. | See deviation 1 |
| @react-three/postprocessing | v3 requires React 19 and is **WebGL-only** (its EffectComposer targets WebGLRenderer) | See deviation 2 |
| ffmpeg | Installed | The video safety net can be encoded here |

---

## 3. Deviations from the brief that need your approval

1. **React 19 instead of React 18.** The WebGPU path requires R3F v9, and R3F v9 requires React 19. Nothing in the brief depends on React 18.
2. **three.js native TSL post-processing (`RenderPipeline`) instead of `@react-three/postprocessing`.** The latter cannot run on WebGPURenderer. The effects are the same: bloom, GTAO (the SSAO role), TRAA/SMAA, depth of field, vignette, AgX/ACES. As a bonus, the identical pipeline runs on the WebGL2 backend.
3. **OSM via the Overture Maps extract**, because Overpass and Geofabrik are blocked here. The content is the same OSM data under ODbL. Credits read "© OpenStreetMap contributors (ODbL), via Overture Maps Foundation". The tool also accepts a Geofabrik `.pbf` if you open that host.
4. **GSAP rather than Theatre.js** for camera choreography. GSAP drives a custom spline camera rig, with keyframes authored in TypeScript next to each scenario script. Theatre's studio adds weight for little gain here.
5. **drei only for renderer-agnostic helpers** (camera-controls, loaders, PerformanceMonitor). Many drei components are WebGL-only. Labels and trace cards are DOM overlays projected from 3D. This also gives exact control of the typography.
6. **Northern Ireland greyed visually but simulated** as part of the all-island synchronous system. SNSP is an all-island metric, and Moyle and the North South tie are in NI. NI detail is reduced to the 275 kV backbone plus aggregated 110 kV.

---

## 4. Architecture

### 4.1 Runtime overview

```
 Main thread                                        Sim worker (deterministic)
┌─────────────────────────────────┐   commands    ┌───────────────────────────────────┐
│ React 19 UI (Tailwind overlays) │ ────────────▶ │ Clock: 15 min steps, seeded PRNG  │
│ Zustand stores                  │               │ Demand profiles, wind field       │
│ R3F <Canvas> (thin shell)       │ ◀──────────── │ Dispatch, SNSP, curtailment       │
│ Imperative render systems       │  snapshots    │ DC power flow, PTDF/LODF, N-1     │
│ Director (GSAP camera rig)      │  (transfer-   │ Conductor thermal + sag model     │
└─────────────────────────────────┘  able arrays) │ Agents, rules, coordinator        │
              │ optional, off by default          └───────────────────────────────────┘
              ▼
  /api/narrate (one Vercel function): receives a trace, returns "Narration"
```

Principles:

- **Imperative core, declarative shell.** Terrain, network, particles, conductors and instancing are plain TypeScript classes that own their three.js objects and GPU buffers. R3F components mount them and pass props. Per-frame updates read typed arrays through refs. React never re-renders at frame rate.
- **The worker owns the truth.** The main thread never computes a flow or an agent decision. It renders snapshots and sends commands. Agents run in the worker beside the engine, so a scenario is a pure function of (scenario, seed, input log).
- **Any state is reproducible.** A full simulated day solves in well under a second, so jumping to any Director beat replays the input log from scenario start. Backward navigation, Explore-mode undo and Playwright capture of any beat all rely on this.

### 4.2 State and messaging

- Stores:
  - `simStore`: current and previous snapshot for interpolation, topology, study results.
  - `agentStore`: trace feed and open recommendations.
  - `auditStore`.
  - `uiStore`: mode, tool, theme, panels, selection.
  - `directorStore`.
- Worker commands form a typed union: `loadScenario`, `setInput`, `seek`, `play`, `trip`, `restore`, `adjustLoad`, `runStudy` and `decide(recId, 'approve' | 'reject' | 'modify', terms)`.
- Worker responses:
  - `snapshot`, as transferable Float32Arrays: per branch MW, loading, conductor temperature and sag; per bus injection and angle; per unit output; plus wind field parameters.
  - `traceDelta`, `recommendation` and `studyResult`.
- **Time.** The engine computes 15-minute steps and the renderer interpolates between them. A trip solves instantly. The on-screen move to the new flows takes about 0.8 s. The Method notes call that animation what it is: a transition between two steady states, not a transient simulation.

### 4.3 Rendering

**Renderer.** three.js 0.186.1 (pinned exactly, because the WebGPU APIs still move between releases), using WebGPURenderer, TSL node materials and the R3F 9 async `gl` factory. The same materials run on WebGPU and on three's WebGL2 backend. Feature tiers:

| Feature | WebGPU | WebGL2 fallback |
|---|---|---|
| Flow particles | Analytic along-path in the vertex stage (no compute needed) | Identical |
| Conductor dynamics | Position-based dynamics in a compute shader | Analytic catenary plus damped analytic sway (same physics inputs) |
| Wind streamlines | Compute-advected particles | Fewer, CPU-advected |
| Storm clouds | Half-resolution raymarched slab | Layered cloud sheets |
| Post | GTAO, bloom, TRAA, depth of field, vignette | Bloom, SMAA, vignette, reduced-resolution GTAO |

If neither backend is available, a framed fallback card in the reference style links to the pre-rendered videos.

**Coordinates and precision.** All coordinates are Irish Transverse Mercator (EPSG:2157) in metres. Generated data is stored as Float32 offsets from integer tile origins. Rendering uses a floating origin: the world re-centres on the camera focus whenever it moves more than about 5 km. A reversed-Z depth buffer completes the picture, so site-scale detail (a 3 cm conductor) is jitter-free in a 500 km world.

**Vertical exaggeration.** 2.5× at national scale, easing to 1.0× below about 3 km altitude, so site views are true scale. Both values are configurable. Assets sit on the exaggerated ground but are never stretched.

**Levels of detail.** LOD is driven by altitude with hysteresis and cross-fades with dithered alpha, so nothing pops.

| Tier | What renders |
|---|---|
| National (> 60 km) | National heightmap terrain. Lines as screen-space ribbons weighted by voltage class. Flow particles and loading colour. Agent glyphs only for non-normal states, to avoid clutter. Town lights at dusk. |
| Regional (5 to 60 km) | Pylons instanced at the **real OSM tower positions**: lattice towers on 220/400 kV, and on 110 kV wood H-polesets where OSM tags poles and steel angle towers where it tags towers (a 110 kV line drawn with 400 kV lattice is the kind of detail an engineer notices). Turbines at the **real OSM turbine positions**, rotor speed from simulated wind. Conductors as analytic catenaries. Substations as footprint-accurate massing. |
| Site (< 5 km) | PBD conductors: three phases per circuit plus earth wire, with insulator strings. A procedural substation laid out inside the real OSM footprint: tubular busbars, lattice gantries, breakers, disconnectors, CTs and VTs, transformers with radiators and conservators, control building, palisade fence, gravel. The data centre campus: precast halls, rooftop dry coolers with heat shimmer, generator rows with stacks, a 110 kV compound, fencing. Terrain from 30 m tiles plus procedural micro-relief. |

**Terrain.** Quadtree chunked LOD (CDLOD-style geomorphing, so no cracks and no popping) with heightmaps sampled in the vertex stage and precomputed normal maps.

- *Specimen*: plaster relief under soft north skylight, a faint hypsometric tint, lakes as a polished inset, and a hint of contours at regional scale.
- *Control Room*: basalt-dark relief with faint emissive contours and an emissive network.

Themes set palette and material response. Time of day sets the sun. In Specimen the relief never goes black at night: it is lit like a gallery model with a raking lamp.

**Ocean.** TSL shader with subtle Gerstner swell, Fresnel against the sky and foam from a coastal signed distance field. No public bathymetry is reachable from here, so shelf colour comes from distance to the coast. That is marked as an approximation.

**Sky and light.** Physical sky (`SkyMesh`). The sun position comes from a solar calculation for the scenario date at Irish latitude, so the real winter sunset of about 16:20 lines up with the evening peak. The PMREM environment is re-baked when the sun has moved enough. Tone mapping is AgX by default, with ACES selectable. Aerial-perspective haze varies with distance and height.

**Shadows.** `CSMShadowNode` (three cascades) at regional and site zoom. At national zoom, precomputed terrain horizon shadows plus cloud shadows from the advected storm cloud field.

**Network rendering.**

- *Ribbons*: screen-space width with distinct weight per voltage class, ink in Specimen and emissive in Control Room.
- *Flow particles*: each branch path sits in a storage buffer with particles evenly spaced along it. A per-branch distance accumulator, integrated each frame from MW (about 200 branches, trivial on the CPU), gives speed proportional to |MW| and direction from the flow sign.
  - Colour by loading: cool under 60%, amber 60 to 90%, red above 90%, pulsing above 100%.
  - Notes carry the speed scale, so the motion reads as data.
- *Not colour alone*: above 90% the ribbon gains a hatch pattern and a numeric chip ("104%").

**Conductors: the grid's equivalent of the jelly.**

- Conductor temperature per span comes from a simplified IEEE 738 heat balance: Joule heating against convective and radiative cooling, plus solar gain. It uses simulated current, ambient temperature, and wind speed and angle to the span.
- Thermal elongation gives the conductor length. A PBD solver (Verlet, distance constraints, gravity, wind drag from the wind field) then produces the shape, so sag and blow-out *emerge* rather than being animated.
- A unit test asserts that the PBD solution converges to the analytic catenary sag within 2%.
- A faint ghost catenary at maximum design temperature and a ground-clearance marker show how close each span is to its limit.
- Honesty about scale: a real hot-versus-cool sag change is a few metres on a sag of about 10 m. That is clearly visible at site zoom and invisible at national zoom, where colour, pattern and particles carry loading. Sag is true scale by default. A presentation exaggeration factor exists but is labelled on screen whenever it is not 1.0.

**Turbines.** Rotor rpm comes from simulated hub-height wind through a power curve and tip-speed ratio, capped at rated rpm. Above cut-out (25 m/s) the blades feather and stop. The storm shows real high-wind shutdown, which in turn changes the flows.

**Data centres.** Shimmer intensity follows simulated heat rejection (load) and falls with wind. Halls light at dusk. Battery containers show state of charge.

**Agents.** A small ring plus line icon, billboarded SDF, whose brightness follows evaluation activity. A thin animated arc to a neighbour appears only when a published state changes that neighbour's evaluation. Trace cards are DOM overlays anchored to the asset.

**Post.** `RenderPipeline` with GTAO, bloom (restrained in Specimen) and TRAA (essential for thin conductors and lattice members; SMAA on the fallback). Depth of field is used only in Director shots. Subtle vignette.

**Performance.**

- Instancing everywhere, KTX2 textures and frustum culling.
- Per-tier budgets: national under 150 draw calls; site under 400 draw calls and 4 M triangles.
- Quality tiers are chosen automatically by PerformanceMonitor.
- The `D` overlay shows fps, GPU ms (WebGPU timestamp queries), draw calls and the active backend.

### 4.4 Simulation engine (worker)

**Network model.** Built in `/tools` from OSM and committed as a graph.

1. The full topology at 110 kV and above: lines and cables with their `circuits` count. Line ends snap to substation footprints. T-junctions are kept as nodes.
2. Each station is split into voltage buses joined by 400/220 kV and 220/110 kV transformers. Transformer count and size come from config by station class (Assumption).
3. The reduction is exact, or documented where it is not:
   - (a) Radial 110 kV spurs fold into their parent bus with their load. This is exact for every other branch in DC flow.
   - (b) Degree-2 junctions without injection merge in series. Also exact: reactances add and the rating is the minimum.
   - (c) Outside the focus regions only, meshed 110 kV stations with small injections merge into a neighbour. This is approximate, and every merge is listed in a committed topology report.
4. The focus regions keep full 110 kV detail: the north west, north Mayo, the west Dublin data centre cluster and the storm corridor.

The expected size is about 90 substations, 120 buses and 180 branches, inside the brief's 60 to 120 substations. The topology report lists islands, unmatched line ends and every merge.

**Branch parameters.** Reactance per km for overhead line and cable, seasonal thermal ratings (summer and winter), and transformer reactance and rating, all by voltage class in `/src/config` and labelled Assumption. Per unit on a 100 MVA base.

**Demand.**

- Profile shapes for residential, commercial, industrial and data centre load by season and day type. Data centre load is flat with a small cooling term.
- Allocation to buses uses a settlement proxy (Overture places), plus explicit large loads.
- Totals are calibrated so national peak, annual energy and the data centre share match public orders of magnitude (§6).
- Transmission losses are a fixed percentage (Assumption).

**Wind and solar.**

- A synthetic wind field driven by the scenario: large-scale flow, moving fronts and seeded turbulence on a grid over the island.
- Hub-height speed per cluster, then a power curve (cut-in, rated, cut-out).
- Cluster capacities come from OSM tags, scaled by region to the configured national installed capacity (Approximate).
- Solar is small, from sun position and the cloud field.

**Dispatch.**

- Wind, solar and interconnector schedules (inputs) are taken first, then thermal units in merit order from configured costs.
- Two constraints are enforced with system-wide curtailment: minimum synchronous units online, and the SNSP cap (default 75%, Assumption).
- Slack is distributed across dispatchable units in proportion to headroom.
- Dispatch-down is reported split into *curtailment* (system, SNSP) and *constraint* (network), as Irish practice reports it.

**Power flow and contingency.**

- *DC power flow*: B-matrix solve (dense LU at this size, under 1 ms). PTDF and LODF are recomputed only when the topology changes.
- *N-1*: every branch and transformer outage via LODF, in milliseconds for the full sweep.
  - Islanding is detected (the LODF is undefined) and reported as islanding, not as an overload.
  - Post-contingency loading is compared against the seasonal continuous rating. That is conservative, because short-term emergency ratings are not modelled, and the Method notes say so.
- *Firm capacity at a bus* (hero scenario): for each interval, firm MW is the minimum over monitored branches and contingencies of remaining headroom divided by the bus-to-branch sensitivity (PTDF, or PTDF and LODF combined). This is the standard linear method a planning engineer will recognise.
- *Re-dispatch proposals*: greedy and sensitivity-based. Injections with positive sensitivity on the overloaded branch are reduced and those with negative sensitivity raised, cheapest first, until the overload is relieved. The engine computes, the coordinator proposes, and nothing is applied without approval.

**Determinism.** A seeded PRNG (xoshiro128\*\*), fixed iteration order and no wall clock inside the worker. A scenario hash appears in the evidence pack. A test asserts that two runs produce identical trace hashes.

**Stated limits** (shown in the Method notes in plain English):

- No AC flow, voltage, reactive power, stability, protection or market modelling.
- In weak parts of the west, voltage limits often bind before thermal ones.
- A real connection study would use AC load flow and dynamic studies.

### 4.5 Agents

**Types.** Line, Transformer, Substation, Wind Farm, Battery, Large Load and Interconnector, plus the Coordinator. There is one agent per modelled asset, about 450 in all, with aggregated agents for NI.

**Rules.** Typed, frozen and versioned objects in `/src/agents/rules/*.ts`:

```ts
interface Rule<I> {
  id: string;                    // e.g. 'TX-E-017'
  version: string;               // semver, part of the rule-set hash
  assetType: AssetType;
  maturity: 'base' | 'extended';
  description: string;           // plain English, shown verbatim in the trace
  reference?: string;            // e.g. 'IEC 60076-7 normal cyclic loading'
  inputs: (keyof I)[];
  threshold: Sourced<number>;    // value, unit, source label
  condition: (input: I, threshold: number) => boolean;
  action: AgentAction;           // alarm | publish | recommend | localSafeMode
  severity: 'info' | 'advisory' | 'warning' | 'critical';
  examples: { fires: I[]; quiet: I[] };   // drives the per-rule unit tests
}
```

**Trace.** Rules are evaluated every step. Trace entries are emitted on *transitions*, not every step, so the feed stays readable. Each entry carries the agent, rule ID and version, rule text, input values, threshold, outcome and sim time. Coordinator decisions also cite method IDs (for example `METHOD-FIRM-01`), each with its formula documented in the Notes.

**Neighbour state.** Each agent sees the last published state of its graph neighbours, with a timestamp.

**Rule maturity.**

- About 5 base rules per asset type.
- Extended sets of 30 to 50 rules for transformers and for lines, and about 10 for each other type.
  - *Transformers*: IEC 60076-7 thermal model and ageing rate, DGA by IEC 60599 ratios and the Duval triangle, moisture, tap-changer operations, bushing tan delta, cooling status, emergency loading duration.
  - *Lines*: N and N-1 loading, conductor temperature against design, clearance margin, wind blow-out, icing conditions, lightning proximity, auto-reclose count, dynamic rating headroom, vegetation survey age.
- Condition-monitoring inputs (DGA, tan delta and so on) are synthetic and labelled Synthetic.
- A seeded anomaly shows the difference: a gas trend on a transformer near the hero site is invisible to the base set and caught by the extended set. Moving the maturity slider changes what appears in the feed and the inspector.

**Governance view.** A pipeline from observed pattern, to draft rule, to engineer review (offline), to versioned release, to shadow mode, to active. A worked example shows a proposed rule with the evidence that triggered it. The rule set is immutable at runtime. Its version and content hash are on screen and logged with every decision.

**Comms loss.** A region's agents stop publishing.

- Their state goes stale after one step and is drawn hatched.
- They fall back to local safe rules: lines assume the lowest seasonal rating less a margin, batteries hold reserve and wind farms hold their last setpoint.
- Coordinator confidence falls, calculated from the share of stale inputs on the constraints that matter.
- The consistency-versus-availability choice is an explicit, labelled UI setting. By default, actions on stale assets are withheld (consistency) and advisory output is shown, flagged stale (availability).

### 4.6 Human approval and audit

- Every recommendation offers Approve, Reject or Modify. Modify opens the editable terms (for example storage MW): the engine re-runs the study and the difference is shown before the decision.
- The audit log records sim time, wall time, operator label, decision, recommendation ID, rule-set version and hash, input hash and scenario seed. It can be viewed in the app and exported as JSON or CSV.

### 4.7 Narration

- Default: templated narration, fully offline, always labelled "Narration".
- Optional: one Vercel function, `/api/narrate`, with the key in an environment variable. It is disabled by default.
  - It receives the trace JSON and nothing else, and its prompt forbids adding facts.
  - The model is configurable.
  - The token and cost counter uses the API's reported usage multiplied by configured prices.

### 4.8 UI

Layout follows §9 of the brief exactly:

- Masthead top left, status pill top right.
- Specimen panel on the right: scenario swatches, sliders with italic named ends bound to model inputs, "Run contingency sweep", "Reset".
- Stats row bottom left: Demand, Wind, SNSP, Data centre share, in large tabular mono figures with hairline dividers.
- Notes bottom right, collapsible.
- Agent feed as a right-edge drawer.
- Hairline timeline scrubber along the bottom, with event ticks.
- Evidence pack as a framed editorial modal.
- Asset inspector with live state, rules, recent decisions and a sparkline.
- The permanent data-labelling badge.
- An EY logo slot set in config, empty by default.

Editorial details:

- Thin hairlines and high contrast. No dashboard cards, no neon.
- **Fonts.** Iowan Old Style is macOS-only. The stack is Iowan Old Style, then Palatino, then a bundled OFL italic serif (Source Serif 4), so Windows, the Igloo PC and the Playwright screenshots match. Helvetica Neue falls back to the system sans. A bundled IBM Plex Mono with tabular numerals is the fallback for every figure.
- **Copy rules are enforced by a test**: UI strings are scanned for em dashes and common US spellings.

### 4.9 Director and camera

- **Script format.** Beats, each with:
  - a camera move (spline through ITM waypoints, look-at, FOV, focus distance, ease, duration);
  - a caption (italic serif);
  - timed engine events;
  - an optional `waitFor: 'approval'`;
  - the sim state the beat needs, expressed as an input-log prefix, so jumping to any beat is deterministic.
- **Controls.** Space plays and pauses. Right and Left move between beats. 1 to 4 jump to a scenario.
- **Camera.** Director mode never orbits. Moves are eased and motivated, with terrain clearance enforced. Explore mode uses camera-controls with damping and terrain collision.
- **Immersive.** A configurable wide canvas (default 5760 × 1080) with a multi-camera cylindrical rig: N cameras at equal yaw steps, one per viewport. UI is scaled for reading at distance.

---

## 5. Scenarios: the story, and what the engine must produce

Each scenario's key claims are asserted in tests. Outcomes come from calibrated *inputs*, never scripted *outputs*. If no plausible calibration produces an outcome, I will change the story and tell you rather than fake it.

**1. The grid today (90 s).**

- Dawn fly-in from the Atlantic over Achill and Clew Bay, rising to national view.
- The network lights by voltage class: 400, then 220, then 110 kV.
- 24 hours pass in 30 seconds. The sun crosses, shadows swing, the network and the Dublin data centre halls light at dusk.
- Wind surplus in the north west, with constraint flagged on the corridors towards Dublin.
- Captions carry the CSO figures with sources.

**2. Hero: a 50 MW large load connection request in the north west (3 to 4 min).**

1. The request arrives and the camera descends to north Mayo.
2. Local agents report headroom.
3. The coordinator runs four studies, each a full sweep of 15-minute intervals:
   - a typical day;
   - a winter evening peak;
   - a low-wind week (672 intervals);
   - N-1 on the main 110 kV feed.
4. The twin keeps **two questions apart**, because conflating them is the usual flaw in this debate:
   - (a) *network firmness*: can the network deliver the load securely, interval by interval?
   - (b) *local renewable matching*: what share of the load is matched, interval by interval, by output from named local wind clusters?
5. It shows the benefit side as well. In high-wind hours the new load absorbs output that would otherwise be constrained in north Mayo, shown as avoided dispatch-down in MWh. This keeps the twin from taking a side.
6. The coordinator assembles a conditional offer, every term computed and traceable:
   - firm import capacity (the minimum firm MW across intervals);
   - the non-firm windows;
   - flexible demand required in those windows (MW and hours in the study cases);
   - on-site generation or storage of X MW and Y MWh, sized from the largest shortfall and the largest contiguous shortfall energy;
   - a renewable power purchase arrangement with named local clusters and its interval match percentage;
   - curtailment or load intertrip terms on loss of the main feed.
7. The firmness dial forms around the site.
8. The evidence pack opens: charts, rules fired, methods, the assumptions table with source labels, and the engine version, rule-set hash and scenario seed.
9. The presenter clicks Approve, and the audit log records it.

**3. Storm event (2 min).**

1. A front arrives from the west: cloud field, rain, wind streamlines, cloud shadows.
2. Western turbines reach cut-out and stop, so flows change direction.
3. Flagford to Srananagh 220 kV trips. Flows redistribute, overloads are flagged, and the overloaded conductors droop and turn crimson.
4. Agents propose re-dispatch and battery discharge.
5. Comms to Region W are lost. The status pill turns crimson ("COMMS LOST · REGION W"), the coordinator's confidence drops, and actions on stale assets are withheld, with the reason shown.
6. A human approves the actions that remain.

**4. 2034 (1 min).** The growth slider moves the data centre share towards 31%. Heat colouring shows the corridors under pressure. The coordinator lists the top five constrained corridors, ranked by N-1 overload energy. Celtic is shown as planned.

---

## 6. Calibration and sources (the numbers an engineer will check)

Every figure in config is a `Sourced<number>` (`value`, `unit`, `source: 'Public' | 'Synthetic' | 'Assumption' | 'Approximate'`, `ref`). The type system will not accept a bare number in config, so every figure carries its label into the UI. Values marked *to confirm* are my current understanding. I'd like your team to check them before the meeting.

| Quantity | Default | Label | Basis |
|---|---|---|---|
| Data centre use, 2025 | 7,663 GWh, 23% of metered | Public | CSO, July 2026 (as cited in brief) |
| Implied data centre average load | about 875 MW, near flat | Public (derived) | 7,663 GWh / 8,760 h |
| Data centre share, 2034 | 31% of national demand | Public | EirGrid forecast cited by CRU |
| ROI and NI winter peaks | about 6.0 GW and 1.8 GW | Approximate, to confirm | Public orders of magnitude |
| Installed wind, ROI and NI | about 5 GW and 1.4 GW | Approximate, to confirm | Public orders of magnitude |
| SNSP cap | 75% | Assumption | Configurable |
| Interconnectors | East West 500 MW, Moyle 500 MW, Greenlink 500 MW, Celtic 700 MW (planned) | Approximate | Public |
| Moneypoint | Modelled as reserve, not coal baseload | Assumption, to confirm | Status after the end of coal firing |
| Overhead reactance | about 0.32 Ω/km at 400 kV, 0.40 Ω/km at 220 and 110 kV | Assumption | Typical values |
| Cable reactance | about 0.12 to 0.20 Ω/km | Assumption | Typical values |
| Winter ratings per circuit | about 1,400 MVA at 400 kV, 500 MVA at 220 kV, 130 MVA at 110 kV (uprated 110 kV about 190 MVA) | Assumption | Typical for conductor class |
| Transformers | 400/220 kV 500 MVA, 220/110 kV 250 MVA, x about 12 to 14% | Assumption | Typical |
| Conductor design temperature | 50 °C (older) or 80 °C (uprated) | Assumption | By line age class |
| Turbine power curve | cut-in 3, rated 12.5, cut-out 25 m/s | Assumption | Typical modern turbine |
| Transmission losses | 2% of demand | Assumption | Typical |
| Network geometry | OSM | Public (ODbL) | Overture release 2026-09-23.1 |
| Terrain | Copernicus GLO-30 | Public | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA |

---

## 7. Data pipeline (`/tools`)

Python 3.11 with pinned requirements (rasterio, pyproj, shapely, pyarrow, numpy, scipy). `make data` rebuilds `/public/data` from nothing. The outputs are committed alongside a `PROVENANCE.json` listing sources, release, licence and file hashes.

1. `fetch_dem.py`: Copernicus GLO-30 tiles for N51 to N55, W011 to W006.
2. `build_terrain.py`: mosaic and reproject to EPSG:2157. Outputs:
   - a national 4096² heightmap (16-bit, about 120 m per pixel) and its normal map;
   - a coastal signed distance field, using the Overture `land` polygons for a crisp coastline;
   - a lakes mask;
   - a horizon-shadow map;
   - 30 m focus tiles for north Mayo, the north west corridor, west Dublin and the hero substation.
3. `fetch_osm.py`: Overture `base/infrastructure` (power), `land`, `water` and places for the island, by row-group bbox pushdown over HTTPS. This is already proven above. A `--pbf` path accepts a Geofabrik extract instead.
4. `build_network.py`: topology, snapping, voltage buses, transformers, reduction, parameters and topology report. `overrides.yaml` holds documented manual corrections, each one marked.
5. `build_assets.py`: tower positions and types per line, turbine positions per cluster, substation footprints, places with a population proxy for town lights and demand allocation.
6. `validate.py`: connectivity checks, plus a figure comparing the OSM network with the reduced graph. Committed, so you can audit the reduction.

Committed data is about 60 to 80 MB. Git LFS is available if you prefer.

---

## 8. File structure

```
/tools                 Python pipeline: fetch_dem, build_terrain, fetch_osm, build_network,
                       build_assets, validate, overrides.yaml, requirements.txt, Makefile
/public/data           terrain/ (heightmaps, normals, coast SDF, focus tiles)
                       network/ (graph.json, lines.bin, towers.bin, substations.json)
                       assets/  (turbines.bin, places.json), PROVENANCE.json
/public/video          pre-rendered scenario videos (safety net)
/api/narrate.ts        optional Vercel function, disabled by default
/src
  /app                 App shell, mode switch, keyboard map, fallback card
  /render              renderer bootstrap, backend detection, RenderPipeline, quality tiers,
                       floating origin, LOD manager
  /scene               terrain/, ocean/, sky/, network/ (ribbons, particles, conductors),
                       assets/ (pylons, polesets, turbines, substation, datacentre, battery),
                       effects/ (clouds, rain, streamlines, shimmer), agents/ (glyphs, arcs),
                       firmnessDial/
  /shaders             TSL modules: flow, terrain, water, atmosphere, clouds, conductor PBD
  /sim                 worker.ts, protocol.ts, clock.ts, prng.ts, network.ts, powerflow.ts
                       (B, PTDF, LODF), dispatch.ts, contingency.ts, firm.ts, thermal.ts,
                       sag.ts, profiles.ts, wind.ts, scenarios/
  /agents              types.ts, engine.ts, coordinator.ts, trace.ts, governance.ts,
                       rules/ (line.ts, transformer.ts, substation.ts, windfarm.ts,
                       battery.ts, largeload.ts, interconnector.ts, coordinator.ts)
  /director            rig.ts, scripts/ (today.ts, hero.ts, storm.ts, y2034.ts), captions.ts
  /ui                  masthead, status pill, specimen panel, stats row, notes, agent feed,
                       inspector, evidence pack, audit log, timeline, toasts, tools
  /config              network.ts, capacities.ts, assumptions.ts, themes.ts, scenarios.ts,
                       presentation.ts (EY logo slot, place-label flag, immersive)
  /lib                 Sourced<T>, geo (ITM), maths, formatting (British English)
/tests
  /unit                powerflow, contingency, firm, dispatch, thermal, sag, PBD, rules,
                       determinism, copy lint
  /scenarios           outcome assertions per scenario
  /e2e                 Playwright: every Director beat × both themes × both backends,
                       immersive frame, presenter keys
/docs                  PLAN.md, METHOD.md (engineering notes), milestone reports
```

---

## 9. Milestones

At the end of each milestone I push, update the draft PR and report what works, what is approximate and what I would improve next, with screenshots.

| # | Milestone | Deliverables | Acceptance |
|---|---|---|---|
| 1 | Plan | This document | Your approval |
| 2 | World | Terrain pipeline and committed outputs; CDLOD terrain; ocean; sky and sun; haze; both themes; national-to-regional zoom; floating origin; debug overlay; bench route; fallback card | Screenshots of both themes at national and regional zoom and three times of day; no cracks or popping in a zoom sweep; bench numbers from your machines |
| 3 | Network and flow | OSM pipeline; network graph and topology report; worker; DC power flow, PTDF, LODF; dispatch; ribbons by class; flow particles bound to MW and sign | Power balances at every bus within 1e-6 MW; textbook 3- and 5-bus cases match hand calculation; LODF matches a full re-solve for every outage; islanding detected; particles visibly match computed MW and direction |
| 4 | Assets and LOD | Lattice towers, 110 kV polesets, conductors (analytic, then PBD), insulators, turbines, procedural substations in real footprints, data centre campus, batteries; LOD cross-fades | Site-zoom screenshots hold up close; PBD within 2% of analytic sag; no pop-in during a scripted descent |
| 5 | Agents | Rule engine; all rule sets; neighbour state; trace feed with filters and fly-to; inspector; maturity toggle; governance view; comms loss; approval and audit | One generated test per rule (fires and quiet examples) plus targeted tests; determinism test; comms-loss behaviour tested |
| 6 | Scenarios and Director | Four scripts; GSAP rig; captions; Explore tools (Cut, Load, Restore); firmness dial; evidence pack | Each scenario plays end to end without intervention, identically twice; outcome assertions pass |
| 7 | Polish | Post pipeline tuning; storm clouds, rain and streamlines; shimmer; dusk lighting; immersive rig; narration (templated plus optional LLM); performance pass; video capture | Budgets met on your bench runs; videos rendered |
| 8 | Verification | Playwright capture of every beat in both themes and both backends, plus immersive frames | I review every screenshot, fix what looks unfinished, cluttered or wrong, and answer the five §13 questions in writing |

---

## 10. Verification

- **Unit tests (Vitest)**: power flow, PTDF/LODF, N-1, firm capacity, dispatch and SNSP, thermal model, sag, PBD convergence, every rule, determinism (identical trace hashes), and a copy lint (no em dashes, British spellings).
- **Scenario tests**: each scenario's claims asserted, e.g. "after the Flagford to Srananagh trip, at least two circuits exceed rating" and "hero: firm in some intervals and not in others under winter peak".
- **Playwright**: deterministic capture mode (virtual clock, fixed dt) screenshots every Director beat at 1920 × 1080 in both themes, on WebGPU and on forced WebGL2, plus a 5760 × 1080 frame. I read every image myself.
- **Performance**: `?bench=1` flies a fixed path and reports p50 and p95 frame times per LOD tier and backend. This container has no GPU, so **I need you (or someone at EY) to run the bench on an M1/M2 MacBook Pro and a mid-range Windows laptop** at milestones 2, 4 and 7. It takes two minutes and prints a summary to paste back to me.
- **Video safety net**: the same capture mode writes frames for ffmpeg. Software rendering here is slow, so I will verify the pipeline on short clips. Full-quality videos are best captured with one command on a GPU machine.

---

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| WebGPU stack maturity: three.js WebGPU APIs still change; R3F 9 needs React 19; drei is partly WebGL-only | High | Pin exact versions. Imperative core with a thin R3F shell. TSL post instead of WebGL post. Use drei only where it is renderer-agnostic. |
| No GPU here: I can't measure fps or see GPU-specific artefacts | High | Bench route and your runs at milestones 2, 4 and 7. Auto quality tiers. Conservative budgets. Screenshots on both backends. |
| OSM access blocked; Overture is a snapshot | Medium | Overture extract proven. `.pbf` path ready. `overrides.yaml` for documented fixes. |
| Network reduction errors (islands, wrong snapping) | High (credibility) | Exact reductions where possible. Committed topology report and comparison figure. Connectivity tests. |
| Assumed ratings and reactances challenged | Medium | Everything is `Sourced<T>`. Method notes state values are typical, not EirGrid's. Calibration table above. Easy to swap in better figures. |
| Scenario outcome doesn't emerge from the engine (e.g. trip causes no overload) | Medium | Calibrate inputs, not outputs. Outcome tests catch drift. If calibration would be implausible, I change the story and tell you. |
| Thin geometry shimmer (conductors, lattice) | High (visual bar) | TRAA, minimum pixel width with alpha fade, impostors at distance. |
| Precision jitter at site scale | Medium | Floating origin, tile-local Float32, reversed-Z depth. |
| Storm clouds too expensive | Medium | Half-resolution raymarch with a step budget. Fall back to layered sheets. Cut rather than ship rough. |
| Political sensitivity: hero mirrors a real refusal | High | Generic naming, balanced evidence (benefits and shortfalls), copy review. The twin never recommends whether to build, only the terms under which a connection is firm. |
| Fonts differ across machines | Low | Bundled OFL fallbacks. |
| Igloo specifics unknown | Medium | Configurable multi-camera rig. Your answer to Q3. |
| Repository size from generated data | Low | Compressed formats; 30 m tiles only for focus areas; LFS if preferred. |
| Scope against time | High | Milestone gating and the cut order below. |

---

## 12. Cut order if time runs short

These go first, in order: multi-camera immersive rig (keep a single wide-FOV camera), raymarched clouds (sheets instead), PBD (analytic sway instead), the governance view's worked example, LLM narration, heat shimmer, rain particles, town lights.

These are never cut: deterministic agents and traces, approval and audit, honest labelling, the hero scenario and firmness dial, both themes, the site-zoom quality of the hero site.

---

## 13. Questions for you

1. **Deviations (§3)**: do you approve React 19, three's TSL post-processing, the Overture source for OSM, GSAP, and NI simulated but greyed?
2. **Timing**: when is the EirGrid session, and when do you need the safety-net videos? This sets where the cut line falls.
3. **Igloo**: which configuration (360° cylinder or front wall, resolution, and does content come in as a browser window or a capture)? Default: a single 5760 × 1080 window with a 4-camera cylindrical rig.
4. **Narration**: should the optional layer use the Anthropic API through the Vercel function (off by default), or do you need another provider?
5. **Hero connection point**: should I choose the electrically nearest existing 110 kV station in north Mayo from the data and label it "connection point assumed"? Or do you have a preference?
