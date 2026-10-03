# Milestone 6: Director, the hero offer, 2034 and the map tools

Status: complete. Every beat is verified in both themes by the M8 spec. Screenshots are in `docs/screens/m8/`.

## What works

- **Director mode** (the default; `D` switches to Explore). There are four scripts of beats (7, 9, 6 and 9 beats).
  - Each beat frames the camera with a GSAP flight. Long moves rise and fall so the viewer keeps their bearings, and distance changes evenly at every scale.
  - Each beat sets or runs the clock, sets up the state it needs (so a presenter can jump to any beat), and carries a caption and a narration line.
  - `Space` plays, `←` and `→` step, and `1` to `4` load scripts.
  - Beats that need a decision hold until a person decides. The Director never approves anything.
- **Hero: 50 MW in the north west.**
  - **Studies.** Four studies run in the worker: a typical day, winter peak, a low-wind week (7 days) and the main feed out. They use METHOD-FIRM-01: firm capacity in each 15-minute interval, intact and after any single outage, from PTDF and outage distribution factors.
    - New demand is met pro-rata by the large synchronous units.
    - A circuit counts when the demand changes its flow by 5% or more (the usual cut-off).
    - Violations that exist before the connection are listed separately and not attributed to it.
    - The studies take about 4 to 6 s.
  - **Offer (METHOD-OFFER-01).** It is built from the firm level, the main-feed-out study and the agents' findings. Asset-condition findings on circuits carrying 15% or more of the demand become conditions precedent: the 41-month vegetation survey on Bellacorick to Castlebar, the 26 °C joint on Glenree to Cunghill, and insulator defects on Cunghill to Sligo.
  - **Firmness dial.** For any level from 10 to 150 MW it shows the firm MW, the share of the year that level is firm (cases weighted 250, 60 and 55 days) and the curtailed MWh a year.
  - **Result.** 50 MW is firm in every interval. Firmness ends at about 116 MW, where Cunghill to Sligo binds after loss of Bellacorick to Castlebar. The circuits there are in series, so the evidence pack says the corridor as a whole would need reinforcing.
  - **Evidence pack.** It covers request, method, studies, result, conditions, the circuits that carry the demand, pre-existing constraints and provenance. It can be printed or exported as JSON.
  - **Approval.** The decision goes to the audit trail, and an approved offer adds the demand to the simulation at Bellacorick.
- **2034.** The year runs from 2026 to 2034, and the data-centre share reaches 31%.
  - Corridors are ranked by the strain growth adds (METHOD-CORRIDOR-01): energy above rating after a single fault, with intact overloads counted double, against the same day at 2026 demand. The worker computes both days.
  - Circuits in series through the same station form one corridor.
  - The top five are all in the Dublin area:
    1. Kellystown to Finglas 110 kV
    2. Grange Castle to Kilmahud 110 kV
    3. Woodland 400/220 kV transformers
    4. Huntstown to Shellybanks 220 kV
    5. Woodland to Kellystown 220 kV
  - They appear in a panel and as numbered labels on the map, and the script flies to each.
- **Map tools.** Hand (select), Cut (trip a circuit), Load (+50 MW at the nearest station), Restore, and Restore all. Every change recomputes the day.
- **Land palette.** Changed after review: pasture greens, conifer, russet bog and heath in Specimen; dark moss in Control Room; matte lakes; Northern Ireland a greyed green.

## What is approximate

- Firm capacity is a DC, single-snapshot-per-interval method. It has no voltage or stability studies, and the ratings are by class (Assumption).
- The study weights (250, 60 and 55 days) are an assumption, stated in the evidence pack.
- Ranking corridors by MWh above rating is a screening measure, not a planning study.

## Next

- Station-level campus composition for the hero site, and lighting the campus on approval.
- Corridor reinforcement options (uprate, new circuit) as a further beat.
