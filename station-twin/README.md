# Cognitive Grid Twin: Clonmore station

A real-time digital twin of Clonmore, a fictional 400/275/220/110 kV station near the border, with rule-based agents that recommend and a person who decides.

This folder is self-contained and separate from the national twin work elsewhere in the repository.

## Status

Milestones 2 (simulation) and 3 (station in 3D) are complete. See [docs/PLAN.md](docs/PLAN.md) for the plan and [docs/milestones/M2.md](docs/milestones/M2.md) for the latest report.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm test` | Unit, parity and scenario tests (Vitest) |
| `npm run typecheck` | TypeScript, strict |
| `npm run dev` | Simulation console in the browser (development) |
| `npm run build` | One self-contained HTML file in `dist/` |
| `npm run e2e` | Opens the build from `file://` in headless Chromium and checks it runs offline |
| `npm run fixtures` | Regenerates parity fixtures by running the original prototype |
| `node tools/divergence.ts` | Regenerates the prototype-versus-engineering table |
| `node tools/method.ts` | Regenerates `docs/METHOD.md` from the assumptions table |

## Layout

- `src/config`: every rating, constant and assumption, each with its source type.
- `src/sim`: registry, balance solver, thermal models, plant, frequency, protection, switching, scenarios, engine, worker.
- `src/debug`: the simulation console (not the demo).
- `tests`: parity with the prototype, unit tests, scenario claims, the `file://` check.
- `reference`: the original prototype, used only for parity fixtures.

Milestone 3 (station in 3D) report: [docs/milestones/M3.md](docs/milestones/M3.md).

Useful query parameters for review: `?console` (simulation console), `?theme=control`, `?tier=high|medium|low`, `?backend=webgl|webgpu`, `?aa=traa`.
