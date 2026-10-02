# Milestone 5: Agents, decisions and governance

Status: complete for review. Screenshots in `docs/screens/m5/`. Unit tests 147/147; Playwright M5 flows 4/4.

## What works

- **One agent per asset, 997 agents.** Lines, transformers, substations, wind clusters, batteries, large loads, interconnectors and one coordinator. Each agent applies a frozen, versioned rule set (v1.0.0, 113 rules, content hash shown and logged) to its own measurements and the state its neighbours publish. Nothing is learned at run time.
- **Every rule is tested.** Each rule carries examples that must fire and must not fire (`tests/unit/rules.test.ts`). The trace records only transitions (fired or cleared), each with the rule ID, version, text, inputs read, threshold (with its source label) and outcome.
- **Base and extended maturity.** The Rule maturity slider switches what the feed, glyphs, inspector and status pill count. The planted Srananagh transformer fault (acetylene and hydrogen trend, Duval D1/D2) is caught only by the extended set (TX-E-008, -010, -011). Compare `specimen-srananagh-extended` with `specimen-srananagh-base`.
- **Storm script.** Communications to Region W (Mayo, Galway, Sligo, Roscommon, Leitrim) are lost at 11:45. Flagford to Srananagh 220 kV trips at 12:00, in the strongest wind of the front. Carrick-on-Shannon to Arigna 110 kV goes to 116% and the coordinator proposes relief (METHOD-REDISPATCH-01, PTDF sensitivities):
  - *Prefer consistency*: the four most effective assets (Arigna, Garvagh Glebe, Corderry and Sligo wind) have stale data and are withheld and named. The best fresh actions reach 108%, at 80% confidence.
  - *Prefer availability*: the last known state is used for the stale assets, which are flagged stale. The proposal reaches 98%, at 68% confidence.

  This trade-off is the decision the operator owns, and it is covered by a unit test.
- **Human in the loop.** Approve, Reject or Modify (scale 50 to 150%) on every recommendation. An approved action goes back into the simulation as an adjustment from that interval, so flows and loading change. Every decision goes to the audit trail with wall-clock time, simulated time, operator, rule set version and hash, an inputs hash and the actions. The trail exports as JSON.
- **Agent feed drawer.** Chronological up to the current time, filterable by asset type and severity. Each entry expands to rule, measured value, threshold and source, inputs and outcome, with "Show on the map" (camera fly-to and selection).
- **Asset inspector.** Click any line, cable or transformer on the map (screen-space pick on the projected network). The inspector shows:
  - kind, length and circuits;
  - route (Public) and rating (Assumption);
  - flow, loading and worst N-1 with its case;
  - a 24-hour sparkline of intact and N-1 loading against 100%;
  - the watching agent's state and its latest rule firings;
  - Cut and Restore.
- **Glyphs.** A diamond at each asset whose agent is at warning (amber) or critical (crimson, with a breathing ring) at the current time. In Region W during comms loss the diamonds are dashed, because the data is stale. Overloaded circuits are drawn wider with the crimson hatch, so the incident reads at national scale; tripped circuits are dotted grey.
- **Status pill** driven by the simulation, in this order of precedence: COMMS LOST · REGION W, then critical alarms, then circuits out, then running or paused.
- **Governance view.** Authority (agents never act), rule set version and hash, the stale-data policy, and the full catalogue with threshold sources, filterable by type and maturity.
- **Method notes (N).** Every modelling step with its provenance label.
- **Presenter keys** added: 1 to 4 scenarios, R reset, Left and Right step a quarter hour, N method notes, Esc closes panels.
- **Deep links** for rehearsal: `scenario`, `policy`, `branch`, `feed`, `maturity`, `governance`, `notes`, `audit`.

## Model changes made during this milestone

Building the storm exposed three credibility problems in the M3 network model. All three are fixed and documented in code and the Method notes.

1. **Day-ahead constraint management (METHOD-SCHED-01).** "The grid today" showed intact overloads, up to 188% on Letterkenny to Strabane. Real scheduling would never produce that. The engine now schedules on the planned network so that:
   - no circuit is above 95% with everything in service;
   - the worst single outage stays within a 120% short-term emergency limit (Assumption).

   Generation moves by PTDF and LODF sensitivity, wind first. The MW moved is shown in the stats row ("moved for constraints"). Events after the schedule (trips, the Cut tool, comms loss) are left to the agents and the operator, as in practice.
2. **Missing Dublin 220 kV cables.** OpenStreetMap has no route for the Poolbeg cables to Inchicore, Carrickmines and Finglas, which left Dublin Bay exporting through the Ringsend 110 kV cables. They are added as documented assumptions (`addedCables` in `src/config/network.ts`). They are not drawn.
3. **Coordinator triggering.** Proposals are now made per overload episode, starting above 100% and ending below 97%, rather than only on the first COORD-001 firing. The up side of a re-dispatch pair is chosen on effectiveness relative to the down side, not on negative sensitivity alone.

Result on the base days:

| Scenario | Intact overloads | Note |
|---|---|---|
| Today | One marginal case: Kellystown data centre feed, 104% for two hours | |
| Storm | None before the trip | |
| 2034 | Persist in the west Dublin data centre corridor | This is the point of that scenario, and the top-five list in M6 builds on it. |

## What is approximate

- Ratings are by voltage class (Assumption), so the N-1 flags that remain are indicative. Most sit at 120 to 145%, where scheduling has run out of headroom (Huntstown export at peak, Wexford, north Kerry).
- Re-dispatch is DC and single-step. It does not re-run N-1 on the proposed state; the "expected after" figure is the linear estimate.
- Battery headroom in proposals is a flat 15 MW per site.
- The Dublin cable additions have approximate lengths and standard 220 kV cable ratings.

## Next (M6)

- Director scripts and GSAP camera for all four scenarios. The storm beats are already scripted in the data: comms loss at 11:45 and the trip at 12:00.
- Hero: 50 MW connection at Bellacorick 110 kV (connection point assumed), with:
  - studies (typical day, winter peak, low-wind week, N-1 on the main feed);
  - firm capacity per interval;
  - conditional offer and firmness dial;
  - evidence pack.
- 2034 top-five constrained corridors.
- Cut, Load and Restore as explicit tools on the map; Cut is in the inspector today.
