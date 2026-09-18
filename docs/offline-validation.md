# Offline closure and research analysis

This package validates the software without querying Jev. It does not establish aviation safety, independent domain validity, model quality or a completed research study.

## Commands

Run from the repository root with Node 24.19.0 or a compatible Node 24 release:

~~~sh
npm run build
npm run verify:provenance
npm run test:offline
npm run check:worker:offline
npm run soak:offline -- /absolute/new/soak-directory 3600
node scripts/analyze-research.mjs /absolute/export /absolute/new/analysis
# Paper cohort (all outputs outside the repo):
# npm run make:study-plan -- PLAN.json PLAN_ID RUN_COUNT SIM_SECONDS WALL_SECONDS PER_RUN_INPUT_CAP JOURNAL_MAX_BYTES
# npm run make:rule-review-packet -- REVIEW_PACKET.json REVIEW.json
# [external reviewer completes REVIEW.json]
# npm run freeze:study-batch -- PLAN.json REVIEW_PACKET.json REVIEW.json BATCH_DIR
# npm run preflight:study-batch -- BATCH_DIR
# npm run aggregate:study -- COHORT_DIR RUN1_ANALYSIS RUN2_ANALYSIS ...
~~~

Use Windows absolute paths on Windows. Output directories must be new. The soak and analyzer use a network guard: external fetch/TCP/UDP is rejected; loopback HTTP is permitted for local QA. Production API credentials are removed from the test process environment. Synthetic response implementations do not use a network connection. The exporter is a separate explicitly requested HTTP reader and never registers a viewer.

The soak uses the actual controller with a stubbed Cloudflare host base class and a transactional local SQLite storage adapter. It uses the full 100-identity airborne scenario, deliberately scripted valid and unsafe decisions, fake wall-clock advancement, periodic object reloads, archive writes and complete command/physics replay. No fabricated reply or token field is model-performance evidence. Physical outcomes in these fixtures test accounting and durability only.

The script records post-GC heap samples when launched via the npm script, maximum individual stored-value size, latency distribution of local alarm processing, reload count and journal size. SQLite state and immutable journal data intentionally grow. Heap samples are diagnostics, not a proof that no leak is possible. Hourly-budget pauses are exercised using the declared cap and fake wall-clock jumps; limits are not relaxed to make tests pass. Viewer absence is checked to prevent progression or new requests.

## Continuous integration

.github/workflows/ci.yml defines Windows and Linux validation, immutable action commit pins, read-only repository permission and no persisted checkout credentials. It runs the guarded tests, verifies source provenance before and after building, dry-bundles the deployment-neutral AI-disabled example, and runs a five-minute synthetic soak. It never deploys and needs no TypeSafe or Cloudflare secret. npm dependency and Node/action downloads are ordinary package/setup traffic, not model calls.

A workflow file existing locally is not evidence of a hosted CI pass. Hosted results require publishing the commit and observing the corresponding jobs. Local Windows acceptance is recorded separately from unexecuted Linux/hosted jobs.

## Verified export analysis

The analyzer requires the exact source inventory recorded by the exported journal. Added files, changed bytes, protocol drift or mixed source configurations are not silently relabeled or pooled. Use the matching checkout/build-provenance for old exports; split independently defined runs rather than combining configurations.

Verification covers every descriptor, sequence, predecessor hash, entry byte count, full content hash, head hash and total bytes. It then reconstructs commands and physics durations and verifies every full core-state digest. A self-consistent but altered state hash still fails replay. Hashes establish internal integrity relative to the supplied manifest, not external authenticity.

Tables are written into an exclusive temporary output directory. Only a successful verification creates the final directory with COMPLETE.json. A rejected analysis leaves a .partial directory with FAILED.json and no completed output; do not treat its partial CSV rows as a paper dataset.

Outputs:

- commands.csv: all applied command bundles, including unflagged ones, with aircraft generation and recorded findings.
- rules.csv: flagged bundles and eligible receipt-time opportunities for each implemented detector.
- flights.csv: first/last observed command and bundle counts by aircraft/generation. These times are not necessarily full flight durations; terminal outcomes are not inferred from mere command association.
- outcomes.csv and resources.csv: matching-prefix counter deltas and explicit resource accounting.
- summary.json: exact numerators/denominators, phase/scope groups, physical-limit requests, model identities, failure categories, unresolved intents, successful-response latency and limitations.

Zero opportunities give null. Rule applicability is reconstructed from the same frozen receipt state and code; it is not an independent regulatory truth. No-finding does not mean certified safe. Failed or unresolved calls have unknown usage; reservations and input bytes are not silently converted into billed tokens. Synthetic evidence is explicitly labeled. A prefix without a completed stop is open/censored, not a completed study. The tool creates no p-values, naive independent-binomial confidence intervals, confidence-as-accident calibration or causal claims.

The runtime retains the original per-rule count metrics. Applicability-normalized fractions are an offline analysis addition, not a reinterpretation of historical counters. The code refuses recorded labels that disagree with replay instead of changing them to improve results.

## Engineering review completed in this package

The closure tests cover viewer departure before dispatch, concurrent/duplicate handler entry, known-unsent reservation release, unknown dispatched work on restart, model-version drift, archive tail corruption, mutation of queued writes, stop visibility, source inventory additions, empty denominators, record loss and mixed configuration exports. Unexpected model versions are archived and stop a frozen study without application. These checks do not act as aviation safety filters or repair Jev numeric targets.

## Aviation source availability check

The optional networked command `npm run verify:aviation-sources -- NEW_RECEIPT.json` re-downloads only the public DHMI URLs listed in `docs/data-sources.json` and compares exact byte lengths/SHA-256 values. It does not call Jev/TypeSafe and is intentionally not part of offline CI. The committed receipt records 10/10 exact matches. The PDFs themselves are not committed, and hash identity is not domain adjudication.

## Explicit study start

Frozen evaluated runs load as `ready`. The operator client `npm run arm:study -- https://STUDY_HOST` requires `STUDY_ARM_TOKEN` and is intentionally not executed by offline CI. Unit tests inject a fake fetch to validate HTTPS/token/contract behavior without a network call. The real arm action is part of production/evaluated-run operations, not offline acceptance. Wall-time analysis begins at the verified `study-armed` journal event.

## Still external to offline software acceptance

Independent aviation/source-rule adjudication, operator approval of surface/exit/scenario assumptions, production deployment acceptance, real-provider acceptance, study approval/preregistration and actual paper data collection are not accomplished by these scripts. A live acceptance would require its own explicit credit authorization; no paid A/B experiment is necessary.

Official engineering references consulted for this implementation: Cloudflare Durable Object alarms (at-least-once delivery and retry), SQLite-backed storage (atomic multi-key operations), and the official GitHub actions/checkout, actions/setup-node and actions/upload-artifact repositories. Tests of the local adapter do not replace acceptance on Cloudflare infrastructure.

## Additional deterministic checks

`npm run test:coverage:offline` enforces minimum aggregate coverage of 95% lines, 85% branches and 90% functions under the external-network guard. Coverage is an engineering regression signal, not domain validation.

`npm run sweep:offline -- N` constructs N seeded airborne scenarios without inference. It checks finite numeric state, sector admission, unresolved initial separation, pending-aircraft exclusion, deterministic replay samples and request-envelope size. A 10,000-seed development sweep completed with zero detected initialization failures; this is software evidence, not model-performance evidence.

Frozen data provenance is cross-checked between `src/ltfm-data.json` and `docs/data-sources.json`. This proves internal source/hash references are consistent; it does not independently re-download or adjudicate the referenced AIP documents.

`docs/rule-review-template.json` is intentionally unapproved. A domain reviewer must supply evidence and decisions; software tests cannot set independent-review status. `npm run preflight:study -- MANIFEST REVIEW_PACKET REVIEW` fails closed when the frozen manifest or completed review is absent and still lists real-provider and production acceptance as external pending work.

A completed external review should be saved outside the repository and passed to `npm run attach:rule-review -- FROZEN_MANIFEST REVIEW_PACKET REVIEW_JSON NEW_MANIFEST`. The tool validates every detector/assumption decision and verifies the exact review-packet SHA-256 and stores both packet and review SHA-256 in a new manifest without overwriting the original. Runtime reporting can only mark labels independently adjudicated when that manifest flag and hash are present. This links provenance; it does not verify the reviewer's real-world identity or expertise.
