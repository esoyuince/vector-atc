# Simulation policy v2 / implementation acceptance

Status: implemented locally; synthetic tests, not a completed Jev study or deployment acceptance.

## Invariants
- Jev's valid numeric targets are not repaired or vetoed. Bounds on physical response remain.
- Command findings, actual measured episodes, collision groups, impacts and successful cycles remain separate.
- Every participant moves before measurements; removal/respawn comes after measurement. A collision preempts completion in its substep.
- Geometry uses linear swept segments inside substeps <=1 s, with simultaneous horizontal and vertical bounds. Tangency alone is not strict penetration.
- Terminal grace is two simulated seconds; arrivals respawn after touchdown, crashes never increment successful cycles.

## Explicit assumptions (not claimed regulations)
- Surface: zero-MSL background, plus flat 60 m wide runway strips at each sourced threshold elevation. No terrain or obstacle mesh.
- Touchdown: contact with assigned strip, heading error <15 degrees, IAS <=190 kt, contact sink no more than 900 fpm. A wrong-strip or excessive-sink contact is an impact. No automatic flare/glideslope rescue.
- Departure handoff: completed SID or sector boundary, radius >=30 NM, outward heading, and no predicted pair conflict in the next 120 s. Delay only the removal when an exit conflict is pending; do not invent a maneuver.
- Successful exits are not credited when a terminal collision occurs in the same substep.
- Initial arrivals use seeded upstream scatter around the first STAR fix, conditioned on staying at least 0.5 NM inside the 110 NM scenario boundary (seeded-gates-v2). Up to 200 proposals are tried. Boundary rejections, unresolved separation and any fallback to the sourced entry fix are explicitly recorded. This is scenario admission, not a correction to Jev commands.
- Departures are scenario-injected at the first SID fix, 180 kt, altitude max(first-leg minimum, threshold elevation +1500 ft), every 60 simulated seconds globally. This is not simulated ground control or a claim of real runway capacity.
- Initial pool: 50 arrivals, 50 departure identities; one departure is initially released, 49 are pending. Additional departure decisions appear only after release.
- New handoffs pause global simulated time until a fresh Jev frame. Provider latency still does not advance aircraft: this is not a hard real-time ATC test.
- Aircraft performance estimates remain generic, no wind/wake/terrain. Extra guidance values are estimates, never synthesized clearances.

## Retention and failures
The research journal is independent of bounded UI incident/command windows. /api/research gives metadata; ?entry=N gives its descriptor; ?entry=N&chunk=M gives a JSON-string fragment. Join all fragments, SHA-256 check, and verify predecessor chain. The request body is preserved without authorization headers; normalized provider replies omit non-contract fields. Malformed raw bodies are not retained.

Each acknowledged entry and new simulator state are written with one bulk storage call. Failure before dispatch spends no inference; failure after dispatch leaves the reservation uncertain and stops without acknowledging command application. An interrupted pending dispatch is marked unknown after restart. Default content cap: 64 MiB; archival capacity failure stops instead of evicting old research data. No retention policy silently deletes the journal.

Each new checkpoint labels its digest version sim-core-state-v2. It covers the simulation state including the handoff schedule, pending-decision flag, runway state, forecast, active episodes and audit counters. Only lastWall and bounded display event/incident windows are excluded; full observations are separately journaled. The deterministic replay regression reconstructs initial state + archived commands + physics durations and matches these digests without another model call. That validates replay mechanics, not the physical model independently.

## Local freeze/export workflow
1. Run npm test and npm run build. Build refreshes source/test/data fingerprints.
2. Run node scripts/freeze-run.mjs OUTSIDE_REPO.json RUN_ID SEED SIM_SECONDS WALL_SECONDS INPUT_TOKEN_CAP.
3. Review the manifest and independent rule adjudication. Local freezing is NOT external preregistration.
4. Only after approval, configure RUN_MANIFEST_JSON and matching RESEARCH_RUN_ID for a new study Durable Object. No deployment is performed by the script.
5. Export with node scripts/export-research.mjs BASE_URL NEW_OUTPUT_DIRECTORY. It does not register viewers or request inference.

A changed source fingerprint/seed/model/manifest cannot silently resume a frozen study. Exposure, wall-time, input-cap and infrastructure stops are explicit. Idle frames cannot overshoot the exposure target. A wall deadline is finalized on the next wake even if no viewer remains; oversized study input is an explicit archived infrastructure stop. HTTP state, replay, report and research export address the same study object as presence, with run-partitioned caches. No stop rule depends on good-looking accident counts. Legacy demo history and budgets are not deleted by a new study identity. Budgets are object-local, not account-wide.

## Remaining external acceptance
Independent review of detector interpretations and the declared model assumptions; operator approval of scenario/stop defaults; production smoke and natural real-provider acceptance. No comparative superiority, real-world safety certification, confidence calibration or causal error attribution is established by these tests.
