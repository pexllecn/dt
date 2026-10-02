# Cognitive Grid Twin: Clonmore station build plan

Milestone 1 of 8. For approval. No application code has been written.
2 October 2026

---

## 0. Where this lives

- Everything for this build goes in `station-twin/`: a self-contained Vite project with its own `package.json`, tests and docs. Nothing outside that folder is touched, so the national all-island twin planned in `docs/PLAN.md` carries on undisturbed.
- The two projects are designed to meet later. The brief asks for the station to drop in as the site-level view of a national twin, so where the two plans overlap I adopt the national plan's conventions:
  - every figure in config carries a source label (`Sourced<T>`);
  - rules use the same object shape, including the examples that drive their tests;
  - the world frame is Irish Transverse Mercator (EPSG:2157);
  - the scene core is framework-free TypeScript, so it can be mounted by a plain renderer (this build) or by React Three Fiber (the national build).
- The original prototype is kept in `station-twin/reference/` as the source for parity tests. It is never shipped.

---

## 1. Summary

A single offline HTML file containing a real-time 3D twin of Clonmore, a fictional 400/220/110 kV station near the border, set in its landscape with its network around it. One world, three lenses: Physical, Flow and Circuit. A deterministic simulation and a layer of rule-based agents run in a Web Worker. The agents explain every decision and recommend; a person approves. The engineering model is the prototype's, ported to TypeScript, with the fixes in the brief and a few more that a transmission engineer would otherwise raise (section 4).

Three moments carry the pitch:

1. **The fold.** The physical yard becomes its single-line diagram in about two seconds. Structures dissolve, the three phase conductors of every bay converge into one line (which is literally what "single-line" means), busbars straighten into rails and transformers resolve into IEC symbols. Same objects, same selection, same live values.
2. **The fan of futures.** After T1 trips, the coordinator simulates each candidate action two hours ahead. The options appear as a ranked list with a small chart of T2's predicted hot-spot temperature under each one, drawn against its limit. Hovering an option shows its predicted flows and heat as a ghost in the 3D scene. Approve it, and the station follows the predicted path.
3. **The early catch.** T1's oil pump fails and its flow alarm does not operate. The base rule set stays silent until the temperature alarm. The extended set notices T1 running hotter than its own physics model expects for that load, and says so much earlier. The difference in minutes is computed by the engine and shown on screen, not scripted.

---

## 2. What I checked before planning

| Item | Finding | Consequence |
|---|---|---|
| Prototype | Read in full (1,302 lines): registry `C`, `solve(dt)`, isometric yard, network map and SVG single-line, inspector, supply and demand panel, auto-balance, 19 scenarios plus reset, toast with deltas | Section 3 maps every concept to its new home |
| Repository | The branch already holds the national twin plan (`docs/PLAN.md`) | This build stays in `station-twin/` |
| Toolchain | Node 22. From npm: three.js 0.186.1, Vite 8.3, vite-plugin-singlefile 2.3 (supports Vite 8), Vitest 5, Playwright 1.63 | The stack in section 10 installs here |
| three.js r186 | `WebGPURenderer` (with `forceWebGL` for the WebGL2 backend), `RenderPipeline`, `GTAONode`, `BloomNode`, `TRAANode`, `SMAANode`, `OutlineNode`, `SkyMesh`, `CSMShadowNode` are all present | Every effect in the brief has a native building block that runs on both backends |
| Headless Chromium | WebGPU works on a secure origin through SwiftShader (CPU). WebGL2 works through SwiftShader. | I can take screenshots on both backends. I cannot measure real frame rates: there is no GPU here |
| Size | `three.webgpu.js` is 2.3 MB unminified | Comfortably inside 8 MB once minified and tree-shaken. Estimate for the whole file: 2 to 3 MB |

---

## 3. What is kept from the prototype, and where it goes

| Prototype | Rebuild |
|---|---|
| Registry `C` with `closed`, `tripped`, `live`, `mwNow`, `dir`, `installed` | `sim/registry.ts`: typed component records with the same fields, plus cooling, protection and switching state. IDs are kept (`T1`, `BUS220`, `TIE_NI` and so on), so scenarios port line by line |
| `solve(dt)`: energisation by topology, nodal balance at 220 and 110 kV | `sim/solver.ts`: same algorithm, generalised to the sectionalised 220 kV busbar and the 275 kV tie (4.6, 4.7) |
| Flow direction from the solve | Kept. Every particle, arrow and label reads its sign from the solver and nowhere else |
| Equal T1/T2 sharing | Kept, as sharing by impedance. Identical units with equal taps share equally (stated as an assumption) |
| First-order thermal model, forced cooling, overload trip | Kept exactly in the parity preset. The demo runs an IEC 60076-7 model with the same behaviour in spirit (4.2) |
| Battery state of charge | Kept, now energy-based with round-trip efficiency |
| System state | Kept as **station condition**: Normal, Alert, Emergency, Supply lost, plus Restoring |
| Cross-view selection | One selection signal shared by the scene, all three lenses, inspector, agent feed and command palette |
| Inspector and supply and demand sliders | Inspector card (section 9). Sliders survive as Explore controls. Switching moves behind explicit confirmation |
| Auto-balance (renewables, battery, gas, grid last) | Becomes a coordinator action, "Rebalance local dispatch", with the same merit order, shown with a look-ahead like any other recommendation |
| 19 scenarios plus reset | All ported, IDs and grouping kept. Each becomes a typed script of timed events (no `setTimeout`) |
| "What just happened" toast | Kept and redesigned. Deltas computed from snapshots before and after, exactly as `snap()` and `deltas()` do now |

---

## 4. Where I disagree with the brief, or would go further

Items marked **(approval)** change something the brief specifies. The others are refinements within it.

**4.1 Parity versus fixes (approval).** The brief asks the new solver to reproduce the prototype for every scenario, and also to fix its engineering. The two conflict for thermal behaviour, protection and frequency. Proposal: one solver with two presets.

- `parity` reproduces the prototype exactly, including its thermal formula and trip thresholds. The golden fixtures come from running the prototype's own `solve()` and scenario code in Node, so tests compare against the original, not against my reading of it.
- `engineering` is what the demo runs. It matches `parity` exactly on every power-balance quantity (energisation, MW, direction, supply, demand, renewable share) wherever the topology is the same. It departs on purpose for thermal behaviour, protection, frequency and plant dynamics. The M2 report lists every departure per scenario, each with a test.

**4.2 Transformer thermal model and protection.** The prototype trips a transformer when its "hot-spot" passes 93 °C, and its cooling factor scales the ambient temperature as well as the temperature rise. An engineer will challenge both: IEC 60076-7 allows a 120 °C hot-spot under normal cyclic loading. Proposal:

- The IEC 60076-7 difference-equation model: top-oil and hot-spot temperatures with the standard exponents and time constants for large power transformers.
- Cooling stages (ONAN, ONAF, OFAF) switching automatically on top-oil temperature, as real cooling control does.
- Ambient temperature from the clock and the weather.
- Relative ageing rate, so the screen can say "ageing at 4 times the normal rate", which executives grasp at once.
- Protection: winding temperature alarm and trip, oil temperature alarm and trip, differential and Buchholz for internal faults, and backup overcurrent set above the maximum overload so that it does not act on overload.
- "Extra cooling" becomes "Force all cooling on" (pre-cooling). That is what an operator can actually do, because cooling normally starts by itself.

**4.3 Tell the N-1 story honestly.** At the prototype's baseline the station imports 560 MW (680 MW demand, 120 MW wind), so each 400/220 kV unit carries 280 MW against 450 MVA, or 62%. Losing either unit puts 124% on the other. That is inside the 130% IEC current limit for normal cyclic loading but outside the continuous rating. At the evening peak the same loss gives 164%, beyond the 150% short-time limit. I propose to show this rather than hide it:

- an N-1 headroom figure in the top strip;
- the coordinator's contingency screen flagging the evening peak as N-1 insecure *before* anything fails.

That moves the agents from raising alarms to assessing security, which is what a control room values most.

**4.4 Frequency cannot move on the compressed clock.** Frequency events play out in seconds. At "1 s = 2 min" they would be invisible. Proposal: a two-area model (Ireland and Northern Ireland, coupled while the tie is closed) with inertia, load damping and droop, all labelled Assumption, at two time scales:

- the quasi-steady frequency on the compressed clock, after reserves have acted;
- for each event, the real-time transient (rate of change of frequency, nadir, recovery) computed at its own time scale and shown as a small chart labelled "Real time, not compressed".

Station events reach frequency only when they change the island's balance: wind cut-out, load shedding, a gas start, the system split. A transformer trip at Clonmore does not move frequency, and the model says so. Illustration with the assumed parameters: if a 150 MW northbound transfer is lost in a split, Northern Ireland sees a rate of change of about 0.6 Hz/s and a quasi-steady fall of about 0.3 Hz before reserves restore it, while Ireland rises by about 0.1 Hz.

**4.5 Neighbour transfers are not set-points.** In a meshed AC network nobody dials 150 MW onto the Ardnagreany line: the flow results from dispatch everywhere. The prototype's sliders are a fair abstraction of asking the National Control Centre to redispatch so that the transfer changes. Proposal: keep the model, change the copy to "Request 150 MW transfer from Ardnagreany", add a realistic delay before it takes effect, and label it a Simplification.

**4.6 Cross-border tie at 275 kV (approval).** The prototype's "estate fed across the border" is really an interchange between two systems, not a load. Proposal:

- Model the tie as a 275 kV circuit to the border, through a dedicated 275/220 kV interbus transformer, T4, in a transformer-feeder arrangement (no 275 kV busbar). Clonmore becomes 400/275/220/110 kV. That is unusual but defensible for a fictional border station, and it avoids a 220 kV north-south tie that the first engineer in the room will query.
- Model the tie flow as a scheduled interchange. "New estate in Northern Ireland" becomes "Demand growth in Northern Ireland raises the northbound transfer by 90 MW". The split scenario has the same effect as before.
- Label the station "Fictional representative station" as well, as the brief requires.

**4.7 A single 220 kV busbar is not credible at this size (approval).** In the prototype, one earth fault on the 220 kV bus blacks out everything below 400 kV. Proposal: a 220 kV busbar in two sections with a bus-section breaker.

- Each section carries one 400/220 kV unit and a mix of circuits. Regional demand is supplied through two circuit groups, one per section.
- Bus-zone protection trips only the faulted section. The earth-fault scenario faults section B, which carries T2, half of regional demand, T3 (and so the 110 kV yard) and the border tie. Supply is lost on that side until the fault is confirmed clear. Section A stays in service, and the agents report exactly which circuits were lost.
- The exact allocation of circuits to sections is settled in M2. The parity preset keeps the single busbar.

**4.8 Plant dynamics are what make the options differ.** The prototype's gas unit delivers 180 MW instantly. Proposal:

- start-up time for the peaker (15 minutes to full output, Assumption) and ramp rates;
- battery response in seconds, limited by its energy;
- a delay before transfer requests take effect;
- a soft high-wind cut-out on the wind farm.

With these, the ranked options really do differ: the battery is fast but finite, gas is slow but sustained, shedding is instant but affects customers.

**4.9 No visible arc when a breaker trips.** Live-tank SF6 breakers interrupt inside the interrupter, so an external arc would be wrong, and an engineer will notice it. Proposal: on a trip, a restrained light pulse at the breaker's position indicator and a ring on its protection marker. Visible arcs are kept for the lightning flashover, where they are physically right. In the same spirit, energised conductors do not glow in the Physical lens. Glow is the Flow lens's language. Physical shows energisation with indicator lamps, agent markers and labels.

**4.10 Fans run in stages.** Cooling fans start and stop by stage rather than speeding up with temperature. In the Physical lens, fan banks start with the cooling stage. With forced cooling, all banks run and the oil pumps' indicators show.

**4.11 Lightning needs a plausible path to T2.** Transformers are shielded by earth wires and protected by surge arresters, so a direct hit on T2 would be questioned. Proposal: the strike lands on the 400 kV bay beside T2 and causes a flashover at T2's high-voltage terminals. Differential protection trips T2 in under 100 ms. Same visual moment, defensible cause.

**4.12 Look-ahead horizon.** Thirty minutes is short for transformer thermal problems: the top-oil time constant is two to three hours. Proposal: a 2-hour horizon for thermal recommendations, with the 30-minute point marked, and 30 minutes for balance and frequency.

**4.13 Themes do not change the time of day.** The brief sets the Control Room theme at dusk or night, and also drives time of day from the clock. Proposal: themes never change simulated time. Control Room sets the dark UI and a low-key grade for the scene at any hour (lower exposure, cooler balance, emissive network). The guided tour passes through dusk and night anyway, which is where Control Room looks its best.

**4.14 "Photoreal" landscape, procedurally, in 8 MB.** The station equipment can reach architectural-visualisation quality at 2 m, because it is hard-surfaced, procedural and instanced. Grass, hedgerows and trees at 2 m cannot, not without textures that break the budget. Proposal: an art direction of *precise realism*: physically lit and materially accurate everywhere, with the landscape designed to be seen from 50 m upwards, where it reads as real. Close-ups are always of equipment, never of vegetation.

**4.15 Demand names and households.**

- "Clonmore Town" becomes **Regional demand**: 480 MW of towns, villages and commercial load, supplied through several 220 kV circuits (aggregated).
- The homes figure leaves the main UI. When demand is shed, the inspector shows "about N household equivalents", based on an after-diversity peak of 1.5 kW per household (Assumption).
- The "New Ireland Estate" at 120 MW is the size of a data centre campus, not a housing estate. It becomes **New demand connection** (120 MW, mixed commercial and data centre).

**4.16 Loading basis.** Ratings are in MVA but the model works in MW. Proposal: state this as a Simplification. Reactive power and voltage are not modelled. Loading is MW against MVA rating, which understates MVA loading by about 5% at a power factor of 0.95.

---

## 5. The experience

### 5.1 One stage, three lenses

- **Physical (key 1).** The station as it looks: a lit, explorable yard in drumlin country near the border, with its network leaving on pylons. Click any asset to fly to a framed close-up.
- **Flow (key 2).** The same scene X-rayed. Structures fade to translucent ghosts. Conductors carry particles whose direction comes from the solve and whose speed scales with MW. Every bay gets a MW label. Transformers switch to a thermography view (an ironbow palette with a °C scale), hotter at the top of the tank and cooler at the bottom of the radiators, as a real thermal camera shows them, driven by the model's top-oil and hot-spot temperatures.
- **Circuit (key 3).** The camera rises to top-down and the station folds into its single-line diagram. Live values stay in place, and selection carries across.

### 5.2 The fold (Physical to Circuit and back)

| Stage | Time | What happens |
|---|---|---|
| 1. Dissolve | 0 to 0.6 s | The landscape desaturates into a plain ground. Gantries, supports, fence and buildings dissolve (dithered alpha, no sorting artefacts). The camera starts to rise and its field of view narrows towards near-orthographic |
| 2. Travel | 0.4 to 1.6 s | Conductors interpolate from their 3D paths to their schematic paths, staggered bay by bay. **The three phases of each bay converge into one line.** Busbars straighten and move onto their rails, and bays drop into vertical feeders |
| 3. Resolve | 1.2 to 2.0 s | Equipment cross-fades into IEC 60617 symbols. Breakers become squares (filled when closed). Disconnectors become switch symbols, transformers double circles (marked as autotransformers with a delta tertiary), generators circles |
| 4. Label | 1.8 to 2.4 s | Labels and live values settle into their diagram positions |

- **Interruptible.** The fold is a single spring-driven parameter, so pressing 1 halfway reverses from wherever it is.
- **Under the hood.** Each item has a physical pose and a schematic pose:
  - conductors carry both paths as vertex attributes and blend in the vertex shader;
  - instanced equipment blends its instance transforms;
  - symbols are separate meshes that fade in.
- **Layout.** The schematic is hand-authored in config, as the prototype's single-line coordinates were, because typographic quality matters more than automatic layout here.

### 5.3 The network in place

Four zoom bands, with labels and detail tuned to each:

| Band | Distance | Detail |
|---|---|---|
| Close | 2 to 20 m | Bolts, earthing tails, nameplates and indicator flags |
| Yard | 50 to 400 m | Bays, equipment, flows |
| Site | 0.4 to 3 km | Station, solar farm, battery, peaker, industrial park |
| Network | 3 to 25 km | Wind farm on the ridge, town on the horizon, lines on pylons to Ardnagreany (north), Ballyduff (south) and the border, labelled "Ireland" and "Northern Ireland" |

Geography is compressed for composition (Simplification). The electrical model has no line impedances, so the compression changes no numbers.

### 5.4 Guided demo (about 7 minutes)

The simulated day is a weekday in early March, so midday solar is meaningful and sunset (about 18:20) coincides with the evening peak. Every number on screen comes from the engine, so the beat sheet describes what happens rather than fixing values.

| # | Beat | Sim time | Wall | What the audience sees |
|---|---|---|---|---|
| 1 | Arrival | 07:40 | 0:00 to 0:40 | Dawn over the drumlins. The camera descends from the wind farm ridge along the 400 kV line into the yard. Caption and badge |
| 2 | A working day | 07:40 to 13:00, time-lapse (labelled) | 0:40 to 1:40 | Sun rises and shadows swing. The solar farm is built row by row and the battery commissioned. The wind freshens, and in the Flow lens the 400 kV conductors reverse as the station exports |
| 3 | The circuit | 13:00, clock paused | 1:40 to 2:20 | The fold to single-line and back, with T2 selected throughout |
| 4 | Meet the agents | 13:00 | 2:20 to 2:50 | Markers wake. T2's card shows its rules, neighbours and trend. The feed opens |
| 5 | Evening peak | 16:30 to 17:30 | 2:50 to 3:50 | Sunset. Town lights come on. Demand ramps by 180 MW. The coordinator's contingency screen: "Loss of T1 would load T2 beyond its short-time limit." It recommends starting the gas peaker now. Approved |
| 6 | Loss of T1 | 17:30 to 19:30 | 3:50 to 5:20 | T1 trips with the gas unit still ramping. T2's agent projects its time to limit. Ranked options, the fan of futures, a ghost preview on hover. Approve, and the station follows the prediction |
| 7 | Storm | 19:30 to 21:30 | 5:20 to 6:30 | T1 returns to service through an interlocked switching programme. A front arrives and the wind agent flags cut-out risk. A lightning flashover at T2, and differential protection trips it. The coordinator rebalances and pre-positions against cut-out |
| 8 | Recovery | 21:30 to 23:00 | 6:30 to 7:15 | The storm clears and T2 is restored. Audit summary ("agents raised N alerts, made M recommendations, K approved"). A night wide shot of the station and the lit town. Closing line: "Agents recommend. People decide. Every decision is traceable." |

- **Presenter controls.** Right advances. At a decision point, Right approves the top-ranked option, and the screen says so before it happens; the approval is logged as the presenter's. Left goes back, which works because any beat can be reached deterministically (6.8).
- **Optional beats.** The rule-maturity catch (pump failure), the bus fault and the system split are available from the library during the tour.

---

## 6. Engineering model (worker)

### 6.1 Topology and balance (engineering preset)

```
 400 kV infeed, 2 circuits (slack; import and export limits)
   │
 ══╪══════════ 400 kV busbar ══════════════════
   │                                │
  T1 400/220 kV 450 MVA            T2 400/220 kV 450 MVA
   │                                │
 ══╪═══ 220 kV section A ═══[BS]═══ 220 kV section B ═══╪════════════
   │ wind, solar, gas,             battery, new connection, regional group 2,
   │ regional group 1,             T3 220/110 kV 250 MVA ── 110 kV busbar ── industrial park, Ballyduff tie
   │ Ardnagreany tie               T4 275/220 kV ── 275 kV circuit to the border
```

- **Energisation** by topology, as in the prototype, extended to the sections, T4 and the 275 kV circuit.
- **Balance.** A radial nodal balance. With the bus-section breaker closed, sections A and B are one node and the result equals the prototype's. With it open, each section balances through its own transformer.
- **Sharing.** Parallel units share by impedance (equal for identical units).
- **Direction** from the sign of each solved flow.
- **Not modelled** (stated in the Method panel): losses, reactive power and voltage.

### 6.2 Transformers

| Unit | Ratio | Rating | Cooling | Source |
|---|---|---|---|---|
| T1, T2 | 400/220 kV, auto with delta tertiary | 450 MVA | ONAN / ONAF / OFAF | Prototype value; cooling Assumption |
| T3 | 220/110 kV, auto | 250 MVA | ONAN / ONAF | Prototype value |
| T4 | 275/220 kV, auto | 300 MVA | ONAN / ONAF | New, Assumption |

- **Thermal.** IEC 60076-7 exponential model, using the typical exponents and time constants for large power transformers by cooling mode. Values to be confirmed against the standard's tables in M2 and labelled Typical value.
- **Limits.** IEC 60076-7 current and temperature limits for large power transformers:
  - normal cyclic: 1.3 per unit, hot-spot 120 °C;
  - long-time emergency: 140 °C;
  - short-time emergency: 1.5 per unit.

  Also confirmed in M2.
- **Ageing.** Relative ageing rate V = 2^((θh − 98)/6) for non-upgraded paper, with loss of life accumulated per event.
- **Cooling failure.** A failed pump moves the plant's parameters from OFAF towards ONAF, while the agent's own expectation model still assumes healthy cooling. That gap is what the extended rules detect.

### 6.3 Protection and switching

- **Bays.** Each bay has a breaker, a bus disconnector and a line (or transformer) disconnector. Line bays also have an earth switch.
- **Interlocks.**
  - A disconnector operates only with its breaker open.
  - An earth switch closes only with the disconnectors open and the circuit dead.
  - An interlock refusal explains itself: "Open the breaker first".
- **Switching programmes.** "Take out of service" and "Return to service" are generated from each bay's definition. They are confirmed by the user, then animated step by step (breaker, then disconnectors rotating over about 3 s).
- **Protection functions.**
  - Transformers: differential, Buchholz, winding temperature, oil temperature, backup overcurrent.
  - 220 kV sections: bus-zone.
  - Wind farm: high-wind cut-out.
- **After a trip.** Breakers open; disconnectors stay closed. Isolation is part of the restoration programme, as in practice.

### 6.4 Plant

| Plant | Model |
|---|---|
| Wind, 200 MW | Wind speed is a scenario input with a forecast. Power curve: cut-in 3 m/s, rated 12.5 m/s, soft cut-out ramping 22 to 28 m/s, restart below 20 m/s (Typical value). Dispatch-down is shown as such |
| Solar, 150 MW AC | Available power from sun elevation (date, time, latitude) and cloud cover, capped at the inverter rating |
| Battery, 100 MW / 400 MWh | Energy state. Round-trip efficiency 88%, split equally between charge and discharge (Assumption). Usable range 5 to 95%. Responds in seconds |
| Gas peaker, 180 MW OCGT | Start to full output in 15 minutes, minimum stable generation 40% (Assumption) |
| Demand | Set-points that scenarios change, optionally as ramps (the evening peak ramps over 30 minutes) |
| Neighbour transfers | Requested set-points that take effect after about 10 minutes (Simplification, 4.5) |
| Border tie | Scheduled interchange, opened by a system split |
| 400 kV infeed | Slack, with import and export limits. N-1 headroom is shown against a single 400/220 kV unit |

### 6.5 Frequency (two-area, Assumption values, all in config)

- **Areas.** Ireland and Northern Ireland, each with kinetic energy (MWs) and a frequency response characteristic (MW/Hz), coupled while the tie is closed.
- **Transient.** The swing equation with damping and a first-order reserve response, run at real time scale for 60 s after each event. It reports the rate of change over 500 ms, the nadir and recovery.
- **On the clock.** The quasi-steady value follows, with reserves restoring it over the following minutes.
- **Display.** Shown as "System frequency (all-island model)". After a split it becomes two values, one per area.

### 6.6 Simulation clock

- **Fixed step.** 5 simulated seconds.
- **Compression.** Selectable and always visible: 1 s = 10 s, 30 s, 1 min, 2 min (default), 5 min, 10 min, plus time-lapse rates that are labelled as such.
- **What the clock drives.** Sun position, solar output, ambient temperature, battery energy, transformer temperatures, ramps and scheduled scenario events.
- **Pausing** stops everything that moves in the scene.

### 6.7 Station condition

| Condition | Definition |
|---|---|
| Normal | All limits held and N-1 secure within emergency ratings |
| Alert | Any warning-level limit, or N-1 insecure |
| Emergency | A unit beyond its emergency limit, or a protection trip with load at risk |
| Supply lost | Any demand group off supply |
| Restoring | A restoration programme is in progress |

### 6.8 Determinism and replay

- The simulation is driven by a seeded generator and a fixed step, with no wall clock inside the worker.
- Every state is reproducible from (scenario, seed, input log).
- A simulated day takes milliseconds, so the timeline scrubber and Left-arrow navigation replay from the start of the script.
- A test asserts identical trace hashes on two runs.

---

## 7. Agents

### 7.1 Roster

| Group | Agents |
|---|---|
| Transformers | T1, T2, T3, T4 |
| Busbars | 400 kV, 220 kV section A, 220 kV section B, 110 kV |
| Feeders | Wind, Solar, Battery, Gas, Regional demand, New demand connection, Industrial park, Ardnagreany tie, Ballyduff tie, Border tie, 400 kV infeed |
| Station | Coordinator |

Each agent holds its state (loading, temperatures, health, alarms), its rule set and the last published state of its electrical neighbours, with timestamps.

### 7.2 Rules

```ts
interface Rule<I> {
  id: string;                     // 'TX-E-15'
  version: string;                // part of the rule-set hash
  assetType: AssetType;
  maturity: 'base' | 'extended';
  description: string;            // plain English, shown verbatim in the trace
  reference?: string;             // e.g. 'IEC 60076-7, normal cyclic loading'
  inputs: (keyof I)[];
  threshold: Sourced<number>;     // value, unit, source label
  condition: (input: I, threshold: number) => boolean;
  action: AgentAction;            // alarm | publish | recommend
  severity: 'info' | 'advisory' | 'warning' | 'critical';
  examples: { fires: I[]; quiet: I[] };   // drives one generated test per rule
}
```

One file per rule set in `src/agents/rules/`. Rules are frozen at runtime. The rule-set version and hash are shown on screen and logged with every decision.

### 7.3 Transformer rule sets

**Base (5):**

| ID | Rule |
|---|---|
| TX-B-01 | Loading above 100% |
| TX-B-02 | Hot-spot above 110 °C (temperature alarm) |
| TX-B-03 | Top-oil above 95 °C (oil alarm) |
| TX-B-04 | Hot-spot above 130 °C (approaching trip) |
| TX-B-05 | Protection operated |

**Extended (30)**, every input simulated, none synthetic:

| Group | Rules |
|---|---|
| Loading (6) | Above 90%. Above 100% for over 30 minutes. Above 130% (IEC normal cyclic current limit). Above 150% (short-time limit). Projected above 100% within 30 minutes. Rising faster than 10% per 10 minutes |
| Hot-spot (6) | Above 98 °C (ageing faster than normal). Ageing rate above 4 times normal. Above 120 °C. Projected to reach 120 °C within 60 minutes. Projected to reach the 140 °C trip within 60 minutes. Loss of life in this event above one day's equivalent |
| Rate of rise and model residual (6) | Hot-spot rising faster than 0.5 K per minute. Top-oil rising faster than 2 K per 10 minutes at steady load. Top-oil above the agent's own expectation by 3 K. The same, by 6 K. Residual growing for 15 minutes. Hot-spot rising while load falls |
| Cooling state (5) | Cooling stage lower than top-oil temperature calls for. All cooling running and temperature still rising. Cooling less effective than expected (residual with cooling at maximum). Pre-cooling opportunity: load forecast to rise by over 20% within 60 minutes and cooling not forced. Forced cooling running for over 6 hours |
| Ambient (3) | Ambient above 25 °C, rating reduced. Ambient-adjusted rating below present loading. Ambient below 5 °C, cyclic overload capability available |
| N-1 headroom (4) | Loss of the partner unit would load this one above 100%. Above 130%. Above 150%. After loss of the partner, time to 120 °C is under 30 minutes |

In the pump-failure scenario the residual and cooling-effectiveness rules fire long before TX-B-02. The engine measures the gap and the toggle shows it.

### 7.4 Other agents, briefly

| Agent | Rules |
|---|---|
| Busbars | Energised. Fault detected (bus-zone operated). Re-energisation blocked until the fault is confirmed clear, which needs a human step. Through-load against busbar rating |
| Wind | Forecast wind above the cut-out ramp within the horizon. Output below forecast. Dispatch-down active |
| Battery | Energy to empty or full at the present rate. Reserve below what an active recommendation needs |
| Gas | Start in progress, time to full output. Unavailable |
| Demand | Off supply. Shed in progress, with household equivalents. Ramping |
| Ties | Loss of coupling. Transfer near its limit. Request pending |
| 400 kV infeed | Import or export near its limit. N-1 headroom below zero |

### 7.5 Coordinator

1. **Collects** agent reports every step.
2. **Screens contingencies** every 5 simulated minutes: the loss of each 400/220 kV unit, of T3, of each tie, and wind cut-out.
3. **Triggers a look-ahead** on any warning or critical report, or when the screen finds an insecure contingency.
4. **Builds candidates** from an action catalogue, each with preconditions, delay and magnitude:
   - force cooling;
   - discharge or charge the battery;
   - start gas;
   - request a transfer;
   - reduce or raise wind dispatch;
   - shed regional demand;
   - rebalance local dispatch (the prototype's auto-balance);
   - switching programmes (always human-executed).

   Single actions first. If none holds limits, pairs of the best singles (METHOD-COMBO-01).
5. **Looks ahead.** Each candidate runs on a copy of the engine with the same inputs and known scheduled events, 2 hours ahead for thermal problems and 30 minutes for balance. It costs milliseconds.
6. **Ranks** (METHOD-RANK-01), in this order:
   1. security over the horizon: holds limits, tolerable within emergency limits, or fails;
   2. customer impact (MW shed × hours);
   3. peak hot-spot margin;
   4. local renewable share;
   5. fossil energy used.

   The order is printed on the card.
7. **Tracks** each approved action, comparing predicted with actual. With no new event, the two must match exactly (tested). If a new event intervenes, the card says the prediction no longer holds and re-plans.

### 7.6 Trace, approval and audit

- **Trace entries** are emitted on transitions, not every step. Each carries:
  - the agent, rule ID and version, and the rule text;
  - the inputs with their values, and the threshold with its source label;
  - the outcome and the simulated time.

  Coordinator entries cite their method IDs.
- **Decisions.** Every recommendation has Approve, Reject and Modify. Modify edits the terms (for example battery MW) and re-runs the look-ahead before the decision.
- **Audit log** records:
  - simulated and wall time;
  - the operator label and the decision;
  - the recommendation, the rule-set hash, the input hash and the seed.

  Viewable in the app and exportable as JSON.

### 7.7 Narration

- **Templated by default.** Sentences are built from the trace, fully offline and labelled "Narration".
- **Optional endpoint.** A single configurable endpoint, disabled by default, that receives the trace and nothing else. Its output is labelled "Narration" and never feeds a decision.

### 7.8 Agents in the scenarios (minimum)

| Scenario | Agent behaviour |
|---|---|
| Evening peak | Contingency screen flags N-1 insecurity before any fault. Recommends pre-emptive action |
| N-1 loss of T1 | T2 agent flags the loading and temperature trend before limits. Coordinator offers ranked options with previews |
| T1 cooling pump failure | Extended set catches the residual early. Base set alarms later. The gap is shown in minutes |
| Storm | Wind agent anticipates cut-out from the forecast. After the lightning trip, the coordinator rebalances and pre-positions |
| System split | Border tie agent reports loss of coupling. Coordinator handles the resulting surplus (battery charging, wind dispatch-down) and shows both areas' frequency |
| 220 kV bus earth fault | Busbar agent reports affected circuits by section. Coordinator blocks re-energisation until a person confirms the fault is clear |
| Growth and generation-mix scenarios | Advisory only: headroom, N-1 and renewable share before and after |

### 7.9 In the scene

- **Markers.** A small ring and a line icon above each asset, calm by default. They brighten while evaluating and show a thin animated arc to a neighbour only when a published state changes that neighbour's evaluation. No robots, no brains.
- **Feed.** Each feed entry expands to its full trace and flies the camera to the asset.

---

## 8. The 3D world

### 8.1 Station

- **Layout.** Generated from a declarative bay list: bay type, voltage, equipment sequence and position. The same generator could build other stations for the national twin.
- **Three phases.** Every bay has three phases: three breaker poles, three CTs, three disconnector poles, three-phase tubular busbars.
- **Indicative dimensions.** Refined in M3; labelled Typical value.

| Voltage | Phase spacing | Bay width | Busbar height | Line gantry |
|---|---|---|---|---|
| 400 kV | about 6.5 m | about 26 m | about 11 m | about 22 m |
| 275 kV | about 5 m | about 20 m | none | about 18 m |
| 220 kV | about 4 m | about 16 m | about 8.5 m | about 15 m |
| 110 kV | about 2.5 m | about 10 m | about 6 m | about 11 m |

- **Equipment.**

| Bay or item | Contents |
|---|---|
| Line bays | Terminal tower and gantry, line traps, capacitive voltage transformers, surge arresters, earth switch, centre-break line disconnector, current transformers, live-tank SF6 breaker on steel supports with mechanism cabinet, pantograph bus disconnector at 400 kV, tubular aluminium busbars on post insulators |
| Transformers | Tank with stiffeners, radiator banks with fans, oil pumps (OFAF units), conservator with Buchholz pipework, HV, LV and tertiary bushings, tap changer compartment, marshalling kiosk, bunded plinth, fire walls between units |
| Site | Gravel yard, concrete roads, cable trenches with covers, palisade fence and gates, lighting and shielding masts, control building with lit windows, earthing tails at close zoom |

- **Materials.** All procedural, with no external files: galvanised steel (spangle and roughness variation), glazed porcelain and grey silicone composite insulators, aluminium, painted tank steel, concrete, gravel and glass.
- **Moving parts, all driven by state:**
  - disconnectors rotate (about 3 s);
  - breaker indicators change, with a pulse on trip (4.9);
  - fan banks run by cooling stage.

### 8.2 Surroundings

- **Terrain.** Drumlin country: low, oval hills aligned in one direction, with small loughs between them. A field patchwork with hedgerows and hedgerow trees, scattered farmhouses, distant hills.
- **Wind farm.** Ballyhill on the ridge: 40 turbines of 5 MW. Rotor speed follows the power curve, and blades feather beyond cut-out.
- **Plant near the station:**
  - the solar farm, which is built with a construction animation;
  - the battery, as container rows with status lights showing state of charge;
  - the gas peaker, whose stack shows heat shimmer and a plume only while running;
  - the industrial park.
- **Town.** Regional demand appears as a town at the horizon, whose lights follow time of day, supply and shedding.
- **Lines.**
  - 400 kV and 275 kV on lattice towers.
  - 220 kV on lattice towers.
  - 110 kV on wood H-polesets, as is common in Ireland.

  All with catenary sag.
- **Border.** A faint line on the ground, labelled only at network zoom. In the split, the 275 kV line to the border visibly de-energises.

### 8.3 Light, weather and time

- **Sky and sun.** A physical sky, with the sun placed by solar geometry for the date, time and latitude. The environment lighting is re-baked as the sun moves.
- **Pipeline.** AgX tone mapping, soft cascaded shadows, ambient occlusion, restrained bloom (lights, indicators, lightning, and the Flow lens).
- **Daylight theme.** A bright overcast sky with breaks: soft, flattering light.
- **At dusk.** The control building and the town light up.
- **Storm:**
  - darkening sky;
  - rain streaks;
  - turbine speed following wind and then cut-out;
  - conductor sway from wind speed (analytic pendulum per span);
  - the lightning flashover at T2.
- **Driven by the simulation.** Everything that moves comes from the simulation. Nothing loops for decoration.

### 8.4 Rendering, performance and quality

- **Renderer.** three.js `WebGPURenderer` with TSL materials, which run unchanged on its WebGL2 backend.
- **Post-processing.** `RenderPipeline` with GTAO, bloom and TRAA (SMAA on the low tier). TRAA matters for thin lattice members and conductors.
- **Budgets.** Under 300 draw calls and 3 M triangles at yard zoom, through instancing everywhere.
- **Quality tiers** (high, medium, low), chosen automatically from frame time with hysteresis. They scale shadow resolution, AO resolution, particle counts, vegetation density and pixel ratio.
- **Debug overlay (D).** Frame rate, frame time, draw calls, triangles, backend and tier.
- **Primary backend.** Decided at M3 from your bench runs. If WebGL2 cannot reach the bar I will say so; if WebGPU is not stable enough, WebGL2 ships as primary.

### 8.5 Camera

- **Explore mode.** Damped orbit with ground clearance.
- **Fly-to.** Clicking an asset flies to a framed close-up, computed from its bounds and a preferred viewing angle per equipment type.
- **Director.** Eased spline paths with motivated moves, no idle orbiting.

---

## 9. UI and UX

### 9.1 Layout

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ Cognitive Grid Twin  Clonmore (fictional)  │ Tue 10 Mar 17:42  ▶ 1 s = 2 min │ Alert │    │
│ Import 560 MW · N-1 limit 450 · Renewable 18% · Local 120/680 │ Physical Flow Circuit │ EY│
├────────────┬──────────────────────────────────────────────────────────────────────────────┤
│ Scenarios  │                                                                              │
│ (dock,     │                       full-bleed 3D stage                ┌──────────────┐    │
│ collapses) │                                                          │ inspector    │    │
│            │                                                          │ card near    │    │
│            │                                                          │ selection    │    │
│            │                                                          └──────────────┘    │
├────────────┴──────────────────────────────────────────────────────────────────────────────┤
│ timeline with event markers ─────────●──────────────────────   │ Agent feed (drawer)       │
└───────────────────────────────────────────────────────────────────────────────────────────┘
  Demonstration environment. Fictional station. Values simulated with documented assumptions.
```

- **Top strip** (about 44 px), from left to right:
  - product and station names;
  - the clock with play and pause, and the compression;
  - station condition;
  - import or export against its limit, and N-1 headroom;
  - local renewable share (defined as local renewables over station supply, excluding the renewable content of grid import);
  - local generation against local demand;
  - system frequency (opens its event chart);
  - the lens switcher;
  - the EY logo slot (empty by default).
- **Supply and demand mix.** Opens from the top strip as a Sankey of sources, through the busbars, to sinks, with a stacked-bar fallback.
- **Left dock.** The scenario library in the prototype's groups. Each entry has a line icon, a one-line description and a severity marker.
- **Inspector card.** Appears only on selection, placed on the side away from the asset with a hairline leader. It shows state, a sparkline, controls and the asset's agent rules (with the maturity toggle on transformers). Switching sits behind explicit operate buttons and a confirmation that names the step and its interlocks.
- **Bottom.** The timeline scrubber with event markers, and the agent feed drawer.
- **Command palette** (Ctrl or Cmd+K): jump to any asset or run any scenario.
- **Toast.** A concise headline, one sentence of explanation, and before-and-after deltas as compact chips.
- **Method and assumptions panel.** Generated from config. Every figure appears with its value, unit, source type (Typical value, Assumption or Simplification) and reference.
- **Footprint.** In normal use the UI covers under 25% of the screen. The dock and drawer collapse and the inspector closes on Escape.

### 9.2 Presenter keys

| Key | Action |
|---|---|
| Space | Play or pause |
| Right, Left | Next or previous beat |
| 1, 2, 3 | Physical, Flow, Circuit lens |
| S | Scenario library |
| A | Agent feed |
| R | Reset |
| F | Fullscreen |
| D | Debug overlay |
| T | Theme |
| Ctrl or Cmd+K | Command palette |
| Escape | Clear selection or close |

### 9.3 Visual language

- **Themes.** Daylight (light UI) and Control Room (dark UI with a low-key scene grade, 4.13). Both finished.
- **Type.** IBM Plex Sans for the UI and IBM Plex Mono for every figure, with tabular numerals. One engineered family, open licence, embedded as a Latin subset.
- **Surfaces.** Neutral and solid at about 92% opacity, with 1 px hairlines and an 8 px radius. No glows, no gradients, no glass.
- **Colour is reserved for meaning** and always paired with a second cue:

| Meaning | Second cue |
|---|---|
| Energised | Solid line and moving particles |
| De-energised | Dashed line |
| Renewable, storage, thermal plant | Icon and label |
| Thermal (thermography) | Number and °C scale |
| Warning | Triangle icon and text |
| Fault | Octagon icon, text and hatching |

  Final values come in M3 with contrast and colour-vision checks.
- **Icons.** A consistent line set: a Lucide subset plus custom power icons (breaker, transformer, turbine, pylon) drawn to the same grid and stroke.
- **Motion.** 150 to 300 ms with standard easing. No bounce.

### 9.4 Copy

- British English throughout, no em dashes, no emojis, enforced by a test that scans every UI string.
- Plain English for executives first, with engineering detail one click deeper ("Why?" on every recommendation and alarm).
- The permanent badge reads exactly: "Demonstration environment. Fictional station. Values simulated with documented assumptions."
- No EirGrid branding anywhere. Product name "Cognitive Grid Twin"; station "Clonmore (fictional)".

---

## 10. Architecture and technology

### 10.1 Runtime

```
 Main thread                                        Worker (deterministic)
┌───────────────────────────────────┐  commands   ┌─────────────────────────────────────┐
│ UI: Preact + signals, CSS vars    │ ──────────▶ │ Clock: fixed 5 s simulated step     │
│ Scene core: three.js r186,        │             │ Solver, thermal, plant, frequency   │
│   WebGPURenderer, TSL             │ ◀────────── │ Protection, switching, scenarios    │
│ Director, presenter keys          │  snapshots, │ Agents, coordinator, look-ahead,    │
│ Labels (DOM, projected from 3D)   │  traces,    │ audit                               │
└───────────────────────────────────┘  recs       └─────────────────────────────────────┘
          │ optional, off by default
          ▼
   one configurable narration endpoint (receives the trace only)
```

- **The worker owns the truth.** The main thread never computes a flow or a decision. It renders snapshots (sent at 10 to 20 Hz and interpolated) and sends typed commands, for example `runScenario`, `operate`, `setInput`, `decide(recId, 'approve' | 'reject' | 'modify', terms)`, `seek`, `setClock`.
- **Labels are DOM elements** projected from 3D, so the typography is exact.

### 10.2 Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, strict |
| Build | Vite 8 with vite-plugin-singlefile. The worker is inlined (`?worker&inline`). One HTML file, under 8 MB |
| 3D | three.js 0.186.1, pinned exactly because the WebGPU API still moves between releases |
| Camera | camera-controls (renderer-agnostic) plus a small spline rig for the director |
| UI | Preact with @preact/signals. Plain CSS with variables for theming |
| Fonts and icons | IBM Plex Sans and Mono (woff2, embedded). Lucide subset plus custom icons as inline SVG |
| Tests | Vitest for simulation and agents. Playwright, using the system Chromium, for end-to-end tests and screenshots |
| Network | None by default. A test blocks every request and asserts that none was attempted |

### 10.3 Integration contract with the national twin

```ts
interface SiteView {
  mount(parent: THREE.Object3D, frame: SiteFrame): void;   // ITM origin, rotation, ground level
  update(snapshot: StationSnapshot, dtWall: number): void;
  setLens(lens: 'physical' | 'flow' | 'circuit', progress?: number): void;
  pick(ray: THREE.Ray): AssetId | null;
  dispose(): void;
}
```

The simulation and agents are pure TypeScript with no DOM, so the national twin's worker can host them unchanged.

---

## 11. File structure

```
station-twin/
  index.html, package.json, tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts
  docs/          PLAN.md, METHOD.md (engineering notes), milestones/ (one report per milestone)
  reference/     the original prototype (parity source, not shipped)
  src/
    main.ts
    config/      ratings, plant, thermal (IEC parameters), frequency, clock, station layout,
                 schematic layout, assumptions (Sourced table), themes, branding (EY slot)
    lib/         sourced, prng, maths, format (British English, units), hashing
    sim/         registry, topology, solver, thermal/ (iec60076, parity), protection, switching,
                 battery, gas, wind, solar, sun, frequency, clock, presets (parity, engineering),
                 scenarios/ (growth, generation, neighbours, faults, reset), engine, protocol, worker
    agents/      types, engine, rules/ (transformer.base, transformer.extended, busbar, wind,
                 solar, battery, gas, demand, tie, infeed), coordinator/ (contingency, actions,
                 lookahead, ranking), trace, audit, narration/ (templates, endpoint)
    scene/       stage (renderer, backend, tiers), frame, camera/ (controls, fly-to),
                 station/ (bay generator, equipment/, transformer, yard, building),
                 surroundings/ (terrain, fields, hedgerows, loughs, pylons, lines, wind farm,
                 solar farm, battery, peaker, industrial, town, border), sky/ (sky, sun, env),
                 weather/ (rain, sway), lenses/ (physical, flow, circuit, morph, schematic),
                 materials/ (procedural), agents/ (markers, arcs), labels, picking, ghost
    fx/          flow particles, thermography, protection pulse, lightning, shimmer, plume, post
    ui/          app, theme tokens, top strip, dock, inspector, agent feed, recommendation card
                 (fan of futures), timeline, palette, toasts, mix (Sankey), method panel,
                 confirm dialogs, badge, icons/
    director/    script (beats), captions, camera paths, presenter keys
  tests/
    unit/        solver, thermal, battery, gas, frequency, switching and interlocks, protection,
                 rules (generated from examples), coordinator, look-ahead, determinism, copy lint
    parity/      fixture generator (runs the prototype in Node), parity tests
    scenarios/   engineering-preset outcome assertions per scenario
    e2e/         smoke, keyboard, offline, guided tour, screenshot matrix
```

---

## 12. Milestones

After each milestone I push, update the draft pull request, and write a short report covering what works, what is approximate and what I would improve next, with screenshots from M3 onwards.

| # | Milestone | Deliverables | Acceptance |
|---|---|---|---|
| 1 | Plan | This document | Your approval |
| 2 | Simulation port | Registry, solver, both presets, IEC thermal, protection, switching and interlocks, plant models, two-area frequency, clock, all 19 scenarios plus reset as event scripts, worker protocol, Method and assumptions table, a plain debug page (not part of the demo). Also proves a single-file build with an inline worker runs from `file://` | Parity tests pass for every scenario against fixtures from the original prototype. In the engineering preset, the balance closes at every bus at every step (residual under 1e-6 MW). Scenario outcome tests pass. Determinism: identical hashes on two runs. Divergence table written |
| 3 | Station in 3D | Renderer on both backends, quality tiers, bay generator, all equipment, yard, materials, sky and sun from the clock, both themes, picking and selection, labels, fly-to, debug overlay, bench route (`?bench=1`). Plus an **early spike of the fold on one bay**, to de-risk the signature moment | Close-ups at 2 m of breaker, disconnector, CVT and transformer. Yard views in both themes at three times of day. I review every image. Bench numbers from your machine if available |
| 4 | Surroundings and Flow lens | Terrain, fields, hedgerows, loughs, pylons and lines, wind farm, solar with construction, battery, peaker, industrial park, town, border. Flow lens with particles, MW labels and thermography. Zoom bands | An automated check that particle direction and speed match solver sign and MW for every conductor. Export reverses the 400 kV conductors. Network-zoom screenshots |
| 5 | Circuit lens and the fold | Schematic layout, IEC symbol set, the fold both ways, interruptible, selection preserved | Frame captures at ten points in each direction. Under 2.5 s. Selection and values identical before, during and after |
| 6 | Agents | Everything in section 7: rules, coordinator, contingency screen, look-ahead, fan of futures, ghost preview, approval, modify, audit, feed, markers and arcs, narration templates | One generated test per rule (fires and quiet). With no new event, actual matches predicted exactly. The early catch is measured and asserted. Audit export validated |
| 7 | UI, presenter mode and guided demo | Full layout, both themes, command palette, keys, toasts, Sankey, Method panel, timeline, guided tour | The tour runs end to end without intervention under Playwright with a virtual clock, twice, with identical audit logs. Copy lint passes |
| 8 | Polish and verification | Storm effects, protection pulse, lightning, plume and shimmer, performance pass, final single-file build | Under 8 MB. Offline test passes. Screenshot matrix: 20 scenario states × 2 themes × 3 lenses = 120 images, plus WebGL2 versions of a subset. I review every image and fix anything unfinished, cluttered or inaccurate before reporting done |

---

## 13. Verification

- **Unit tests (Vitest).** Solver balance, thermal model against hand-calculated IEC examples, battery efficiency, gas start, frequency transient against the analytic first-swing result, interlocks, protection, every rule, coordinator ranking, look-ahead determinism, and the copy lint (no em dashes, no emojis, British spellings).
- **Parity tests.** Fixtures generated by executing the prototype's own code in Node, for every scenario, including the double `closed` assignment in N-1 (harmless in the original, removed in the port).
- **Scenario tests.** Each claim the demo makes is asserted. For example: "the evening peak makes the T1 contingency insecure"; "after the bus fault, section A stays energised"; "the extended set detects the pump failure at least 20 simulated minutes before TX-B-02".
- **Playwright.** A deterministic capture mode (virtual clock, fixed step) at 1920 × 1080, covering both themes, all three lenses and both backends for a subset. Plus the guided tour end to end, the keyboard map, and the offline check.
- **Performance.** This container has no GPU. **I need someone to run `?bench=1` on an M1 or M2 MacBook at 1440p at M3, M4 and M8.** It takes two minutes and prints a summary to paste back to me.

---

## 14. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| No GPU here, so frame rate cannot be measured | High | Bench route, your runs at M3, M4 and M8, automatic tiers, conservative budgets |
| The fold is novel and hard to make beautiful | High (signature moment) | Spike on one bay in M3. Hand-authored schematic. Staged timings in config so they can be tuned without code changes |
| Close-up quality from procedural geometry and materials | High | Close-ups only of hard-surface equipment. Screenshot review at every milestone. Cut anything that falls short rather than ship it rough |
| three.js WebGPU APIs still moving | Medium | Pin 0.186.1 exactly. Use only core nodes. Test both backends at each milestone |
| `file://`: WebGPU needs a secure context and the worker must be inline | Medium | Proven in M2 with a minimal build. Fallbacks: the WebGL2 backend, and running the simulation on the main thread (it is small enough) |
| Engineers challenge an assumption | Medium | Every figure is sourced and visible in the Method panel. I suggest your engineers review the M2 assumption table before visuals are built on it |
| IEC parameter values from memory | Medium | Marked "to confirm" here. Checked against the standard in M2. All in config |
| Border and data centre sensitivities | Medium | Neutral labels, a faint border line, no flags. The new connection is described as mixed commercial and data centre, without commentary |
| Software rendering makes captures slow | Low | Capture runs in the background. Acceptable for 120 images |
| Scope against time | High | Milestone gating and the cut order below |

---

## 15. Cut order if time runs short

**Cut first, in this order:**

1. rain particles (keep the dark sky and the wind);
2. heat shimmer (keep the plume);
3. conductor sway;
4. earthing details at close zoom;
5. solar construction animation (fade in instead);
6. the Sankey (keep the stacked bar);
7. the language-model narration endpoint;
8. lough reflections.

**Never cut:**

- the fold;
- the look-ahead with ghost preview;
- the early catch;
- approval and audit;
- deterministic replay;
- both themes;
- close-up quality of the breaker and transformer;
- honest labelling;
- the guided tour.

---

## 16. Decisions I need from you

1. **Section 4.** Do you approve the positions, in particular the three marked (approval)?
   - parity and engineering presets (4.1);
   - the 275 kV border tie through T4 (4.6);
   - the sectionalised 220 kV busbar (4.7).
2. **Timing.** When is the EirGrid session? That sets where the cut line falls.
3. **Bench.** Can someone at EY run the two-minute bench on an M1 or M2 MacBook at M3, M4 and M8?
4. **EY logo.** Send an SVG when convenient. The slot stays empty until then.
5. **Narration.** Should the optional endpoint target a particular provider, or stay templated only?
