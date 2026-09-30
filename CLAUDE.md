# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VECTOR: a synthetic Istanbul (LTFM south-flow) air-traffic-control experiment. A Cloudflare Worker + Durable Object runs an aircraft physics/pilot simulation. TypeSafe's **Jev** model makes the control decisions, and the project measures what happens. The React UI is Turkish/English. This is research-model software, not operational aviation software. Docs and README wording deliberately avoid safety or performance claims, so keep that tone.

## Commands

Node 24+ is required, because tests use the Node module-hook API. CI pins 24.19.0 and runs on both Ubuntu and Windows.

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc   # local, gitignored
cp .dev.vars.example .dev.vars             # TYPESAFE_API_KEY goes here only
npm run dev                                # build + wrangler dev on http://127.0.0.1:5173
```

- `npm test`: all tests (`node --test test/*.test.mjs`). Tests mock the provider and never spend credits.
- Single test file: `node --test test/simulation.test.mjs`
- Single test by name: `node --test --test-name-pattern="pattern" test/simulation.test.mjs`
- `npm run test:offline`: the same tests under `scripts/offline-guard.mjs`, which blocks all non-loopback network and strips API-key env vars. CI uses this variant. Prefix any ad-hoc script with `node --import ./scripts/offline-guard.mjs` to get the same guarantee.
- `npm run test:coverage:offline`: enforces 95% lines / 85% branches / 90% functions.
- `npm run test:data-generator`: Python unittest for `scripts/build-ltfm-data.py`.
- `npm run sweep:offline -- 500`, `npm run soak:offline -- NEW_DIR 300`: deterministic seed sweep and simulated soak.
- `npm run build`: Vite build. The `prebuild` step regenerates `server/build-provenance.mjs`.
- `npm run check:worker` needs `wrangler.jsonc`. `npm run check:worker:offline` uses `wrangler.example.jsonc` instead.
- `npm run accept:workerd -- MANIFEST.json` (after `npm run build`) loads a frozen manifest into the real worker under local workerd, with AI off and no provider key, and checks it is `ready`, untouched and at the frozen speed. Run it before deploying any frozen run.
- `make:study-plan`, `freeze-collection` and the other study-artifact scripts refuse to run on a dirty git tree.
- `npm run verify:provenance`: fails if any source file differs from the committed provenance.

## Source provenance (easy to break)

`server/build-provenance.mjs` is **generated and committed**. It holds SHA-256 hashes of every `.mjs/.jsx/.json/.jsonc/.css/.md/.yml/.py` file under `src/ server/ docs/ scripts/ test/ .github/`, plus root `package*.json`, `README.md`, `index.html`, `wrangler.example.jsonc`, `.gitattributes` and `.gitignore`. The scan logic is in `scripts/lib/source-inventory.mjs`. CI runs `npm run build` and then `git diff --exit-code -- server/build-provenance.mjs`. After **any** change to those files, run `npm run build` and commit the regenerated provenance with the change. CRLF is normalized before hashing.

The source fingerprint also forms part of study-run identity. Frozen run manifests stop matching once the source changes, and this is intentional.

## Architecture

**Worker entry (`server/worker.mjs`)**: a hand-written router for `/api/state`, `/api/replay`, `/api/research`, `/api/report`, `/api/presence`, `/api/health`, `/api/study/arm` and `/api/operator/stop`. It also serves static assets from `dist/`, with `run_worker_first`. Read endpoints are rate-limited and edge-cached briefly, and they never register a viewer or trigger AI calls. All state lives in one Durable Object, `AirportSimulation`. Its name is `istanbul-demo-v2`, or `study-<RESEARCH_RUN_ID>` for frozen studies, so study runs never touch demo history.

**Durable Object loop**: when a visible browser holds a presence lease (20 s), the DO advances physics on alarms. Every `CONTROL_SECONDS` (60 simulated s), or earlier when a critical conflict is predicted, it builds a plan, splits it into batches and calls TypeSafe. Physics keeps running while a provider call is pending or backing off. Budget (`server/budget.mjs`) reserves tokens and requests before dispatch and settles them afterwards. `SIM_SPEED` (1–20×) scales physics, control cadence and wake cadence together. Provider latency is real wall-clock time and advances physics, so its simulated cost grows with speed. Provider-failure backoff **freezes** physics (`providerWait: live-latency-failure-paused-v1` in `runtimeVersions()`). Requests carry `state.timing` (expected decision delay in simulated seconds). Frozen collections declare `runtime.simSpeed` in the manifest, and the DO refuses to load if the deployed `SIM_SPEED` differs.

**Simulation core (`src/`, shared by worker and UI)**:
- `simulation.mjs`: create, advance, plan, `applyFleetDecision`, conflict prediction, report. It uses a seeded LCG (`random(sim)`), so keep everything deterministic from the seed.
- `pilot.mjs`: point-mass transport pilot model. Policy `jev-command-live-latency-v2` executes schema-valid commands **without numeric repair or veto**, even when they violate procedures. Violations are measured and logged (`command-audit.mjs`, `procedureCommandIssues`) and are never corrected. Don't add "safety" clamps that change commands; only physical performance limits apply.
- `traffic-scenario.mjs`, `traffic-lifecycle.mjs`, `traffic-profile.mjs`: the distributed-flow-v1 scenario (100 identities, seeded arrival and departure gaps). Scenario inputs are never Jev commands.
- `airport.mjs` + `ltfm-data.json`: the frozen `LTFM-SOUTH-v3` dataset, generated by `scripts/build-ltfm-data.py`. Check it with `npm run verify:data`.
- `flight-events.mjs`, `observation-events.mjs`, `evaluation.mjs`: the measurement policy, detector rules and evaluation numerators/denominators. See `docs/evaluation-spec.json`.

**TypeSafe adapter (`server/typesafe.mjs`)**: `buildRequest`, `batchPlans` (adaptive packing under `REQUEST_LIMIT`) and `validateResponse`. Its prompt and context version constants are recorded in evidence and in manifest `versions`, so bump them when you change the request shape, and update `docs/run-manifest.example.json` to match. An oversized context stops the frozen state rather than retrying or dropping conflicts.

**Evidence storage**: `research-journal.mjs` is a chunked, SHA-256-linked append-only journal with a 64 MiB default cap. It stops when full and never deletes. `replay-archive.mjs` holds paged position frames. State and journal acknowledgement are written in one multi-key storage put. `emergency-stop.mjs` is an authenticated, permanent per-run stop latch, and fenced writes throw `StopFenceError`. `study-run.mjs` parses `RUN_MANIFEST_JSON` and handles operator arming.

**Offline research tooling (`scripts/`)**: study plan, rule-review packet, freeze, preflight, aggregate, export and analyze. Most scripts run under the offline guard. `scripts/lib/offline-harness.mjs` runs the real DO against transactional disk storage without a network connection.

**UI**: small React 19 components (`App.jsx`, `Radar.jsx`, etc.) with strings in `i18n.mjs`. `test/i18n.test.mjs` checks that TR and EN stay in parity.

## Conventions

- Code style is extremely dense: one-space indent, long single-line functions, minimal whitespace. Match it rather than reformatting, because reformatting also churns provenance.
- Old stored data, counters and epochs are never relabeled or backfilled. New policies get new version and epoch identifiers (`controlEpoch`, data epochs, protocol versions).
- `wrangler.jsonc`, `.dev.vars`, `.env`, `.agents/`, `design/` and `worker-configuration.d.ts` are local-only (gitignored). Only `wrangler.example.jsonc`, which disables AI, is committed. `CLEAN_START_PILOT` is a historical migration flag. Never enable it.
- Detailed policy documents are in `docs/`: `simulation-policy-v2.md`, `methodology.md`, `study-operations.md`, `offline-validation.md` and `operator-emergency-stop.md`. Read the relevant one before changing measurement or run-control behavior.
