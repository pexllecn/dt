# Presenter's guide

## Before the meeting

1. On the presentation machine, open `/?bench=1` and let the camera path run. Check that the reported frame times hold up. Adaptive resolution lowers the pixel ratio if the frame rate falls, so a sustained pixel ratio of 1 means the machine is at its limit.
2. Open each script once (`1` to `4`) in both themes (`T`) so tiles are cached.
3. Narration: the templated lines work offline. LLM rephrasing only works if the deployment has `NARRATION_LLM=on` and an API key. It is optional and costed on screen.
4. Immersive room: open `/?cave=preview` to check all five faces, then put each face (`?cave=front`, `left`, `right`, `back`, `floor`) full screen on its display and drive them from `?cave=master`.
5. If the browser cannot run WebGPU or WebGL2, the app shows a fallback card with the recordings that are in the build. Make them with `node tools/capture.mjs <script> --gpu`.

## Running a script

`Space` plays. `→` and `←` step beats. A beat that needs a decision holds until someone presses Approve, Reject or Modify. The twin never decides on its own. Every decision goes to the audit trail (top left).

### 1. The grid today (about 90 seconds)

Morning, Dublin, the west, agents (a station close up), the agent feed, evening peak, night. Points to make:

- every line is a real route from open map data;
- every number is simulated and labelled;
- the agents apply fixed, versioned rules and show their working.

### 2. A 50 MW connection request in the north west

Request, then the connection point (assumed: Bellacorick 110 kV), then four studies, then firm, conditions, the firmness dial, the evidence pack and the **decision**.

- 50 MW is firm in every studied interval.
- The conditions come from the agents' findings on the circuits that carry the demand: a vegetation survey 41 months old on Bellacorick to Castlebar, and a 26 °C hot joint on Glenree to Cunghill.
- The dial shows that above about 116 MW the limit is Cunghill to Sligo, after loss of Bellacorick to Castlebar. The circuits there are in series, so the corridor as a whole would need reinforcing.
- Approve the offer at the Decision beat.

### 3. Storm

The front arrives; comms to Region W are lost at 11:45; Flagford to Srananagh trips at 12:00; Carrick-on-Shannon to Arigna overloads.

- **Prefer consistency** withholds the stale assets, so relief is partial (about 108%).
- **Prefer availability** uses the last known values, reaching about 98% at lower confidence.
- The choice is the operator's. Approve at the Policy beat.

### 4. 2034

The year runs from 2026 to 2034, and data centres grow towards 31% of demand. Then the five corridors that take most of the added strain, each in turn, all in the Dublin area.

## If something goes wrong

- `R` resets the current scenario and restarts its script.
- `D` drops to Explore, where you can fly freely, cut lines (Cut), add load (Load) and restore (Restore).
- `Esc` closes every panel.
