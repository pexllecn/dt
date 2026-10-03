# Milestone 7: Weather, the immersive rig, narration, recordings and performance

Status: complete. The performance figures are measured in this container (see below); real-hardware figures come from `?bench=1` and `tools/perf.mjs --gpu` on the presentation machine.

## What works

- **Weather** (`src/scene/weather/Weather.ts`). Everything moves in the shaders from the time and wind uniforms, so weather adds no per-frame JavaScript. Passes that would draw nothing are skipped.
  - **Cloud deck.** Built from a tileable noise texture generated once at start-up, with two samples per pixel. It drifts with the wind, thins as the camera descends, and turns from white to slate as cover rises (storm).
  - **Rain.** Storm only, close range. Drops are fixed in the world, wrapped around the camera, falling and slanting with the wind.
  - **Wind streamlines** (`W`, and on at the storm front): dashes drifting with the synthetic wind field at map scale.
  - The weather follows the scenario script: the storm front arrives at 09:00 and the wind veers from south west to north west behind it.
- **Immersive rig** (four walls and a floor). One window per face on one machine, synced over a `BroadcastChannel`:
  - `?cave=master` drives `?cave=front|left|right|back|floor`, and `?cave=preview` unfolds all five faces as a cross for rehearsal.
  - Walls keep the horizon level and turn with the master's heading. The floor looks straight down with forward at the top.
  - Each face is exactly 90 degrees across whatever the display's aspect ratio.
  - Faces follow the master's eye, clock, theme, scenario inputs, selection and wind layer. The honesty badge stays on the front wall.
- **Narration.** Every beat has a templated line, offline by default.
  - Optional rephrasing goes through `api/narrate.ts`, a Vercel function using the Anthropic SDK with `claude-opus-5-5` at low effort and a server-side refusal fallback. It is off unless `NARRATION_LLM=on` and a key are set.
  - Any rephrasing that changes or adds a number is discarded and the template is used. The panel shows calls, tokens and cost at $4 and $20 per million input and output tokens.
  - Optional en-GB speech.
- **Recordings** (`tools/capture.mjs`). The app loads on real time, then the page clock is frozen and stepped one frame at a time. Each frame is screenshotted and ffmpeg encodes H.264. Result: smooth video at any render speed, with decision beats approved as the presenter would.
  - Use `--gpu` on a machine with a graphics card. In this container, SwiftShader renders a frame in seconds, so full-length recordings are not made here.
  - The fallback card offers only recordings present in the build.
- **Performance pass:**
  - **Flow particles** are laid out only on circuits near the view (all circuits at national scale), and each remembers its segment rather than searching every frame. Close views move a few thousand particles instead of up to 60,000.
  - **Panels** (feed, glyphs, inspector, recommendation card, status pill, scenario panel) re-render when the 15-minute interval changes, not on timers.
  - **The Director's beat clock** lives outside React state, so playback causes no per-frame re-render.
  - **Clouds** cost two texture samples per pixel instead of six 3D noise evaluations.
  - **Adaptive resolution:** the pixel ratio drops in steps of 0.5 when the frame rate stays below 40 fps for 3 s, and returns after 12 s of headroom. `quality=fixed` turns it off; it is never on in `bench`.
  - **No shader rebuilds mid-show.** The sky was re-baked into a new environment texture every 2 degrees of sun movement. A new texture object invalidates every lit material, so the whole scene's shaders were rebuilt every few seconds during any time-lapse or Director play (0.6 to 0.8 s stalls here). The bake now reuses one render target. Measured over 40 s of playback of each of the storm, today and 2034 scripts: no long tasks and no material builds. A warm-up frame at load builds the weather materials before they are first needed, and `?debugbuild` logs any material build with its object and time.
  - **Frame time** is clamped, so a background tab or clock change can't jump or reverse animation.
  - **The debug overlay** shows main-thread update and submit time per frame, the pixel ratio, draw calls and triangles.

## Measured (container, SwiftShader; main thread only)

See the table in the M8 report (`docs/milestones/M8-verification.md`). Frame rates in this container reflect CPU rasterisation and are not meaningful. The main-thread JavaScript figures are representative.

## What is approximate

- Clouds are a single deck with no shadows on the ground. Rain is a screen effect near the camera, not a volume.
- The rig uses one window per face. Edge blending and warping are left to the projection system.
- Heat shimmer over the data centre coolers (in the brief's polish list) was cut: it needs a refraction pass, and the cost was not worth it at presentation distances.

## Next

- If the Igloo system takes a single equirectangular or cube-map feed rather than five windows, add a cube-camera output mode.
- Make the full recordings on the presentation machine (`node tools/capture.mjs <script> --gpu`).
