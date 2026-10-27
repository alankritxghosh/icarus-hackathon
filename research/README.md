# research/

Throwaway technical spikes behind `docs/RESEARCH_ROUND_2.md`. Not product code: nothing in `packages/` or `apps/` imports from here, and Biome excludes it.

- `spikes/kernel`: polygon library benchmark (`node bench.mjs`)
- `spikes/export`: exports the 12 briefs and baseline plans (`pnpm exec vitest run research/spikes/export/export.test.ts` from the repo root)
- `spikes/layout`: CP-SAT and subdivision generators, independent metrics, circulation clearance
- `spikes/schema`: draft v2 spatial model, validator, adapter, examples (`node --test schema.test.ts`)
- `spikes/benchmark`: blinded review packet, analysis, synthetic self-test
- `results/`: raw outputs, SVG plans, the review packet

Setup: `cd spikes && npm install`; for Python, `uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python ortools shapely numpy`.
