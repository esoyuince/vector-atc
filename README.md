# VECTOR — TypeSafe ATC experiment

A Turkish/English air-traffic-control tech demo with 100 synthetic aircraft, TypeSafe decisions, a pilot/physics model, incident reports and cumulative recorded replay.

**Live demo:** [atc.alaz.tr](https://atc.alaz.tr)

This is an experiment, not operational aviation software. Accident counts describe this simulator and its integration, not real-world aviation risk or model performance in isolation.

## Run locally

Requires Node.js 24+ and npm. Tests use the Node module-hook API.

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
npm run dev
```

On PowerShell, `Copy-Item` also works. Open `http://127.0.0.1:5173`.

The example configuration disables AI calls. To run live simulation, enter your own `TYPESAFE_API_KEY` in `.dev.vars` and set `AI_ENABLED` to `"true"` in your local `wrangler.jsonc`. Without enabled AI, the UI remains available and the simulation pauses; there is no local ATC fallback.

Never commit `.env`, `.dev.vars`, credentials, exported state or deployment-specific configuration. Only blank credential examples are included. Never put secrets in `VITE_*` variables or client-side JavaScript.

## Validate

```sh
npm test
npm run build
npm run check:worker
```

Tests mock provider responses and do not spend TypeSafe credits. `check:worker` bundles a deployment dry run and requires the copied `wrangler.jsonc`.

Optional HTTP checks: `node test/http-smoke.mjs http://127.0.0.1:5173`. This checks HTTP boundaries and asset hashes against a running server. It expects a local `.dev.vars` key for exact leak comparison and never prints it. These HTTP reads do not register a viewer or initiate AI calls.

## Deploy to your own Cloudflare account

1. Copy the example config and choose your own unique Worker name. Configure your own domain if needed; the template does not bind the live demo domain.
2. Authenticate with `npx wrangler login`.
3. Run `npx wrangler secret put TYPESAFE_API_KEY`, entering your key at the prompt instead of in command arguments.
4. Review `AI_DAILY_TOKEN_LIMIT`, `AI_HOURLY_REQUEST_LIMIT` and `AI_ENABLED` before `npm run deploy`.

Cloudflare Workers serves static assets. A Durable Object coordinates the experiment, viewer presence, token reservations and replay. Rate-limiter bindings need distinct namespace IDs within your account. Hosting and TypeSafe charges belong to the deployer's accounts; token limits are not an account-wide monetary cap. There is no automatic deployment workflow in this repository.

## Current implementation (0.6.0)

The default Worker is airborne-only. The pool still has 50 arrival and 50 departure identities, not 100 simultaneously airborne aircraft. Departures join at their first SID fix every 60 simulated seconds; the initial frame contains 50 arrivals plus one departure (204 flight-control questions). Pending identities are not sent to Jev. Initial conditions and scheduled releases are scenario inputs, not credited to Jev. Legacy mixed-scope constructors remain for explicitly labeled regression fixtures.

Terminal outcomes use swept substep geometry. All participants are measured before completion/respawn; a level overflight above a runway is not touchdown. See [the simulation policy](docs/simulation-policy-v2.md) for surface, sink-rate and exit assumptions. These are research-model rules, not operational aviation standards.

Requests retain runway/HOLD coordinates, true hold bearing, 60/90-second timing, aircraft performance and computed next-fix/gradient estimates. Unsafe choices remain selectable and are executed without numeric repair. An oversized context is logged and stops that frozen state without a paid retry loop or dropped conflicts.

A chunked SHA-256-linked research journal starts with a full simulation snapshot and source fingerprint. Exact request JSON, normalized responses/failure status, applied commands (including unflagged commands), and new physical events are kept separately from UI rolling windows. State and journal acknowledgement share one multi-key storage write. The default archive cap is 64 MiB of serialized entry content; reaching it stops rather than deleting old evidence. Reads through /api/research do not register a viewer. Storage/export costs still apply.

Build generates server/build-provenance.mjs from source, test, data and protocol bytes. scripts/freeze-run.mjs creates a local frozen manifest with declared seed/exposure/wall-time/token stops; it is not external preregistration. A study uses RUN_MANIFEST_JSON and a matching RESEARCH_RUN_ID in its own Durable Object identity, leaving demo history untouched. scripts/export-research.mjs exports and verifies chunks without starting AI. Independent source-rule review and a real-provider acceptance run remain pending.

## Historical mixed-scope behavior (0.5.x)


- 50 arrival and 50 departure identities. Arrivals spawn 2–9 NM around a randomly selected eligible waypoint on RIXEN1P or ERSEN1R, not fixed sector-boundary gates. They respawn after landing; departing aircraft return to the ground queue after leaving. Crash respawns are not successful flights.
- A visible browser sends a presence heartbeat. Hidden/closed pages release their lease; lost disconnects expire after 20 seconds. Without viewers, physics and AI stop. Public state/report reads do not register viewers.
- Simulation runs at 1×. Whole-fleet decisions cover 60 simulated seconds. Critical conflicts predicted within 45 seconds can trigger an earlier request for affected aircraft, with a 10-simulated-second cooldown. Physics pauses during provider calls, errors and exhausted budgets.
- TypeSafe selects bounded route, altitude, IAS and vertical-rate choices. Runway questions select a waiting aircraft or no clearance. Batches share frozen telemetry but cannot see one another's answers. Batches shrink to fit request limits. Active ILS procedures remain available on the next frame so the model can continue the same approach without losing waypoint progress.
- Route, numeric and runway judgments remain independent. Conflicting runway/approach decisions are recorded and can still be executed. If several runway questions choose the same aircraft, the conflict is counted and recorded while the existing last-in-plan-order execution rule remains unchanged. Typed output is not a guarantee of safe or mutually consistent decisions.
- Runway batches retain predicted conflicts involving their runway candidates and current runway occupants even when those aircraft belong to another flight-control batch. Emergency flight-only batches do not inherit unrelated runway questions or runway context.
- Requests are packed adaptively up to the existing request envelope. Repeated numeric option descriptions, duplicate batch telemetry and verbose runway-candidate structures are compacted without changing the 403 decision keys or allowed choices. In the v0.5.2 fixed-seed scheduled-frame regression, request count falls from 10 to 5 and serialized request bytes from 615,731 to 365,262 versus v0.5.1; an all-airborne stress fixture falls from 20 to 10 requests and 992,107 to 650,337 bytes. These byte counts are deterministic input-size proxies, not billed TypeSafe token measurements or a model-quality comparison.
- A generic transport-jet pilot model follows routes, holding entries and timed holding legs, with bounded acceleration, bank and vertical-rate changes. Under `jev-command-observe-v1`, schema-valid numeric commands execute even when they violate procedures. Procedure/holding altitude and speed limits, the FAP floor, glide path and SID gradient no longer substitute numeric targets or veto execution. `pilot.constraintWarnings` reports non-blocking command conflicts; actual violations, collisions and ground impacts remain measured. `pilot.unable` now reports physical performance limits only. Bank, acceleration, vertical-rate capability and lateral route/holding guidance are retained. No local controller selects traffic-avoidance maneuvers.

The no-repair policy is an intentional synthetic experiment, not real pilot operating guidance. Malformed, out-of-catalog and stale responses are still rejected. A physically unattainable rate is limited by the existing aircraft approximation, with the original requested rate retained and the limitation exposed; no stronger performance is invented to satisfy a procedure. Touchdown/exit/crash lifecycle and respawn behavior are unchanged by this policy update.

## Methodology and evaluation

[Methodology](docs/methodology.md), the [evaluation specification](docs/evaluation-spec.json) and a [run-manifest template](docs/run-manifest.example.json) define units, detector rules, denominators, provenance and limits. This is a single-arm development protocol, not a preregistered or completed Jev study. No paid A/B runs are required.

Schema-valid out-of-procedure commands are applied unchanged and logged separately from measured violations. Published-data conflicts, simulator assumptions and integration conflicts have separate counters; physical limits are another category. The report evaluation section provides numerator/denominator pairs, phase and air/ground strata, an observation-start baseline and missing-data flags. Zero denominators produce null, not a safety claim. Latest evidence includes request hashes, prompt/context/protocol versions and per-batch usage/model identities; evaluation logs are not sent back to Jev.

Default ground-control questions are removed. UI logs remain bounded; complete new observations are available in the separate research journal. Local manifest freezing and runtime stops are implemented. Independent rule adjudication and real-provider acceptance remain pending. Historical evidence is not backfilled or relabeled.

## Reports, budget and replay

Accepted commands that conflict with the active procedure are logged as **out-of-procedure commands**, independently of measured flight violations and accidents. The check is observational: it never vetoes or changes the command. Each entry retains the aircraft generation, plan revision, command ID, original numeric targets, active fix/leg context, conflicting rule, requested value and required limit. Published constraints, demo rules and integration-clearance rules are explicitly labeled; physical performance limits remain separate. The assessment concerns the command against active constraints at receipt, not a guarantee about all future route conditions.

The report's `commandAudit` contains cumulative checked-command / noncompliant-command / finding counts and a separate recent-command window (up to 64 records and 32,000 UTF-8 JSON bytes). Evicted-record counts remain visible. Repeated new Jev decisions count again; physics ticks, predictions, polling and reload do not. Existing data is not retroactively classified. This command history cannot evict the latest 200 measured incidents and is not added to TypeSafe inference inputs. Command IDs are also retained in subsequent incident command snapshots for correlation.

`/api/report` exposes simulation exposure, takeoffs/landings, collisions, ground impacts, separation episodes, runway/procedure violations, the latest 200 incidents and the latest AI decision context. The latest TypeSafe frame also retains normalized typed answers, including confidence and probability distributions, plus runway-question order; this evidence is replaced by each new frame rather than forming an unbounded decision archive. Counters cover their declared epochs; full new request/normalized-response history is stored separately in /api/research, not inline in this report. `pilotControlPolicy`, `controlEpoch` and `controlEpochStats` distinguish the command-observation policy from older target-repair results without clearing historical totals or replay; latest-frame evidence also carries its control policy.

Experimental thresholds are 3 NM/1,000 ft for separation, 1 NM/500 ft for critical encounters and 0.12 NM/150 ft for collision. These simplified point-aircraft measurements are not a complete separation standard.

Daily input-token reservations and hourly request caps are shared by viewers. Every batch is reserved before dispatch; known usage is settled and uncertain charges stay reserved. Daily counters reset at 00:00 UTC. The template uses 3,800,000 input tokens/day and 720 requests/hour; choose limits for your own allowance and current provider pricing. Cost and active duration vary with traffic and request size.

Recorded positions append approximately every five simulated seconds to paged Durable Object storage. On budget exhaustion, the browser streams the archive and loops it without AI calls or new incident measurements. Replay is labeled. With fewer than two frames, the last live state stays visible. Storage is finite; there is no automatic retention policy or unlimited archival capacity.

## Data and limitations

The frozen `LTFM-SOUTH-v1` subset contains five physical runways, three active south-flow runways, two STARs, six SIDs, nine ILS transitions, three missed approaches and six holding fixes. [Source URLs and document hashes](docs/data-sources.json) record provenance. Full third-party charts and private experiment artifacts are not included.

The model uses local NM projection and standard-atmosphere IAS/TAS approximation without wind, terrain, wake turbulence or full ARINC turn anticipation. Narrow/wide-body performance constants are demonstration estimates, not manufacturer AFM data. FAA-inspired holding entry sectors, 60/90-second timing and bank limits are modeling assumptions, not complete Turkish operational compliance or a current AIRAC database. See [third-party notices](THIRD_PARTY_NOTICES.md).

The disabled-by-default `CLEAN_START_PILOT` migration code exists for the original deployment's historical reset. It is absent from the configuration template. Do not enable it in a new deployment; normal setup needs no reset migration.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | React UI, simulation, pilot model, airport data and replay player |
| `server/` | Cloudflare Worker, TypeSafe adapter, budget and archive |
| `test/` | Deterministic tests and optional HTTP checks |
| `wrangler.example.jsonc` | Deployment-neutral, AI-disabled configuration |

## Türkçe

VECTOR, TypeSafe'in sentetik hava trafiğini yönetmesini gözlemlemek için geliştirilmiş bir teknoloji demosudur. Arayüz Türkçe ve İngilizcedir. Gerçek uçuş operasyonları için kullanılamaz; sonuçlar simülatörün ve AI entegrasyonunun sınırlamalarını da içerir.

Örnek ayarları yerel dosyalara kopyalayın, kendi API anahtarınızı yalnızca `.dev.vars` içine yazın ve canlı AI için `AI_ENABLED` değerini açın. API anahtarları, üretim ayarları, özel raporlar ve replay verileri Git deposuna dahil edilmez. Günlük limit dolduğunda mevcut kayıtlar tekrar oynatılır; izleyici yoksa deney durur.

## License and security

Original project code is [MIT licensed](LICENSE), © 2026 Ender Soyuince. Dependencies and third-party source materials retain their respective rights. See [SECURITY.md](SECURITY.md) for credential handling and private vulnerability reporting.

## Offline validation and analysis

See [offline validation](docs/offline-validation.md). Run `npm run test:offline`, `npm run verify:provenance`, and `npm run check:worker:offline` without a provider key. `npm run soak:offline -- NEW_DIRECTORY 3600` exercises a one-hour simulated fixture with transactional disk storage and complete replay. `node scripts/analyze-research.mjs EXPORT_DIRECTORY NEW_DIRECTORY` verifies a matching-source export and creates command, rule, flight, outcome and resource tables. Synthetic usage is never reported as measured model performance. The CI workflow is validation-only, not automatic deployment.
