# Cognitive Grid Twin: Clonmore station

A real-time digital twin of Clonmore, a fictional 400/275/220/110 kV station near the border, with rule-based agents that recommend and a person who decides.

This folder is self-contained and separate from the national twin work elsewhere in the repository.

## Status

All eight milestones are complete: the simulation, the station in 3D, the surroundings and Flow lens, the Circuit lens with the fold, the agents, presenter mode with the guided tour, and polish and verification. See [docs/PLAN.md](docs/PLAN.md) for the plan and [docs/milestones/M8.md](docs/milestones/M8.md) for the final report.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm test` | Unit, parity and scenario tests (Vitest) |
| `npm run typecheck` | TypeScript, strict |
| `npm run dev` | The app in the browser with hot reload (development) |
| `npm run build` | One self-contained HTML file in `dist/` |
| `npm run e2e` | Headless Chromium on the build: offline from `file://`, the fold keeps selection and values, and the guided tour twice with identical audit logs |
| `npm run fixtures` | Regenerates parity fixtures by running the original prototype |
| `node tools/divergence.ts` | Regenerates the prototype-versus-engineering table |
| `node tools/method.ts` | Regenerates `docs/METHOD.md` from the assumptions table |

## Layout

- `src/config`: every rating, constant and assumption, each with its source type.
- `src/sim`: registry, balance solver, thermal models, plant, frequency, protection, switching, scenarios, engine, worker.
- `src/agents`: the asset agents and their frozen rule sets, the coordinator (contingency screen, look-ahead, ranking, tracking), narration, and the twin that steps the engine and agents together.
- `src/tour`: the guided demo's eight deterministic beats.
- `src/scene`: the 3D world (station, surroundings, Flow lens, fold and single-line diagram, markers, weather) and the stage.
- `src/ui`, `src/app`: the interface (Preact and signals) and its wiring to the worker.
- `src/debug`: the simulation console (not the demo).
- `tests`: parity with the prototype, unit, scenario and agent tests, copy lint, and the end-to-end checks.
- `tools`: screenshot capture, the screenshot matrix, contact sheets.
- `reference`: the original prototype, used only for parity fixtures.

## Presenting

Live at https://dtey.vercel.app (the national twin is at https://dtey.vercel.app/national/). Locally, open `dist/index.html` (no server needed). Press Right, or click Tour, to start the guided demo; Right advances and approves at decision points, Left goes back. 1, 2 and 3 switch lens, Ctrl or Cmd+K opens the palette, A the agent feed, T the theme, M the method and assumptions. F, or the button at the right of the top strip, toggles full screen. Building plant from the scenario panel (solar farm, battery, gas peaker, new demand connection) flies the camera to it. In the Flow lens the legend folds to a Legend button after a few seconds. `?bench=1` runs a two-minute performance route and prints a summary.

Milestone 3 (station in 3D) report: [docs/milestones/M3.md](docs/milestones/M3.md). Milestone 4 (surroundings and the Flow lens) report: [docs/milestones/M4.md](docs/milestones/M4.md). Milestone 5 (Circuit lens and the fold): [docs/milestones/M5.md](docs/milestones/M5.md). Milestone 6 (agents): [docs/milestones/M6.md](docs/milestones/M6.md). Milestone 7 (presenter mode and the guided tour): [docs/milestones/M7.md](docs/milestones/M7.md). Milestone 8 (polish and verification): [docs/milestones/M8.md](docs/milestones/M8.md).

Useful query parameters for review: `?console` (simulation console), `?theme=control`, `?lens=flow|circuit`, `?tier=high|medium|low`, `?backend=webgl|webgpu`, `?aa=traa`, `?bench=1`. Capture mode (`?capture=1`) is documented at the top of `src/app/main.tsx`.
