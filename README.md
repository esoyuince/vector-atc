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

## Experiment behavior

- 50 arrival and 50 departure identities. Arrivals spawn 2–9 NM around a randomly selected eligible waypoint on RIXEN1P or ERSEN1R, not fixed sector-boundary gates. They respawn after landing; departing aircraft return to the ground queue after leaving. Crash respawns are not successful flights.
- A visible browser sends a presence heartbeat. Hidden/closed pages release their lease; lost disconnects expire after 20 seconds. Without viewers, physics and AI stop. Public state/report reads do not register viewers.
- Simulation runs at 1×. Whole-fleet decisions cover 60 simulated seconds. Critical conflicts predicted within 45 seconds can trigger an earlier request for affected aircraft, with a 10-simulated-second cooldown. Physics pauses during provider calls, errors and exhausted budgets.
- TypeSafe selects bounded route, altitude, IAS and vertical-rate choices. Runway questions select a waiting aircraft or no clearance. Batches share frozen telemetry but cannot see one another's answers. Batches shrink to fit request limits. Active ILS procedures remain available on the next frame so the model can continue the same approach without losing waypoint progress.
- Route, numeric and runway judgments remain independent. Conflicting runway/approach decisions are recorded and can still be executed. If several runway questions choose the same aircraft, the conflict is counted and recorded while the existing last-in-plan-order execution rule remains unchanged. Typed output is not a guarantee of safe or mutually consistent decisions.
- Runway batches retain predicted conflicts involving their runway candidates and current runway occupants even when those aircraft belong to another flight-control batch. Emergency flight-only batches do not inherit unrelated runway questions or runway context.
- A generic transport-jet pilot model follows routes, holding entries and timed holding legs, with bounded acceleration, bank and vertical-rate changes. Published procedure constraints can modify execution targets; `pilot.unable` exposes conflicts with the AI clearance. No local controller selects traffic-avoidance maneuvers.

## Reports, budget and replay

`/api/report` exposes simulation exposure, takeoffs/landings, collisions, ground impacts, separation episodes, runway/procedure violations, the latest 200 incidents and the latest AI decision context. The latest TypeSafe frame also retains normalized typed answers, including confidence and probability distributions, plus runway-question order; this evidence is replaced by each new frame rather than forming an unbounded decision archive. Counters cover the experiment; there is no complete per-decision input/output archive.

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
