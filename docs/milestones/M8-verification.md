# Milestone 8: Verification

Status: see the results table below. Screenshots of every beat in both themes are in `docs/screens/m8/`.

## What is verified

`tests/e2e/m8-beats.spec.ts` walks every Director beat of all four scripts (31 beats) in Specimen and Control Room, against the production build. For every beat it checks that:

- the Director is on that beat;
- the caption is shown;
- the honesty badge ("Demonstration environment…") is visible;
- the page raises no error.

Content checks on the beats that carry the story:

| Script | Beat | Check |
|---|---|---|
| today | Agent feed | the feed drawer is open |
| hero | Studies | the four studies arrive (Low-wind week shown) |
| hero | Firm | the offer lists the vegetation survey condition |
| hero | Evidence pack | the pack opens and names METHOD-FIRM-01 |
| hero | Decision | Approve is pressed as the presenter would; the audit trail count rises |
| storm | Comms lost | the status pill reads COMMS LOST · REGION W |
| storm | Overload | the recommendation for Carrick-on-Shannon to Arigna is shown |
| storm | Policy | Approve is pressed; the audit trail count rises |
| 2034 | Five corridors | the panel lists five corridors |

Unit tests (159) cover:

- every rule's fire and quiet examples;
- the power flow;
- thermal models;
- agents;
- the storm policy trade-off;
- the studies and offer;
- the corridors;
- the narration guard.

The earlier milestone specs (M2 to M5) still run, pinned to Explore mode.

## Results

RESULTS

## Problems the verification found, and fixed

- **Beat clock while stepping.** A beat's clock only ran during auto-play, so stepping with the arrow keys left the storm at 11:36 under a caption saying comms were lost at 11:45. The clock now runs whenever a beat is on screen.
- **Remote conditions on the offer.** A 400 kV tower finding near the reference bus became a condition on a north Mayo connection, because the demand share used reference-bus balancing. It now uses the same pool balancing as the studies; the conditions are all on the north west network.
- **Shader rebuild stalls.** Found by profiling, not by the walk: the sky re-bake swapped the environment texture every 2 degrees of sun, rebuilding every shader. Fixed (see M7).
- **Test strictness.** The evidence pack repeats the honesty badge, so the badge check was made tolerant of a second match.

## Performance

Main-thread measurements in this container (SwiftShader; frame rates are not meaningful, main-thread JavaScript is representative):

PERF

- **Long tasks.** None over 50 ms during 40 s of playback of the today, storm and 2034 scripts, after the environment fix.
- **Simulation updates.** An input change (for example the 2034 year steps) costs about 3 ms in the message handler and about 14 ms of React work in total, with no long task.
- **Garbage collection.** Under 1% of time.

On the presentation machine, run `?bench=1` and `node tools/perf.mjs --gpu` for real frame rates. The debug overlay (`` ` ``) shows update and submit time and the adaptive pixel ratio live.

## What is not verified here

- Real-GPU frame rates on the target M1/M2 MacBook and Windows laptop. Use the bench route.
- Full-length recordings: `tools/capture.mjs --gpu` on a machine with a graphics card. The capture pipeline was verified here on short clips.
- LLM narration against the live API. It needs a deployed key. The fact guard and cost counter are unit tested, and the offline path is the default.
- The immersive rig in the Igloo room. Master-to-face sync was verified with three windows in one browser.
