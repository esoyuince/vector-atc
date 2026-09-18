# VECTOR: methodology and evaluation protocol

Protocol: **vector-observational-v3**. Status: **development draft, not preregistered**.

Dataset: **LTFM-SOUTH-v2**. It supersedes v1 for new observations after correcting source attribution for the SID gradient and adding three directly evidenced published missed-approach holding-speed maxima. Historical v1 observations remain preserved but are not backfilled or pooled into v3 denominators.
Machine-readable definitions: [evaluation-spec.json](evaluation-spec.json).
Run template: [run-manifest.example.json](run-manifest.example.json).

This defines observation units, denominators and claim boundaries. It is not a report of a completed Jev study. Tests using fabricated provider replies validate software behavior; their outcomes are never model-performance observations. A budget-limited single-arm system paper does not require a paid A/B experiment, but cannot claim comparative superiority.

## 1. Research question and scope

Research question: under frozen traffic generation, bounded decisions, pilot model and budget, what command/constraint conflicts and physical outcomes occur when Jev supplies traffic decisions without local numeric target repair?

The object of evaluation is the complete integration: model + prompts + supplied state + candidate options + composition + pilot/physics + measurement rules. A system failure is not automatically a model-only failure.

The agreed target is airborne control. Ground taxi, apron, parking, rollout and ground sequencing are outside the target. Touchdown may end an arrival; a departure may respawn after a documented exit/handoff condition. Measure the terminal step before removal; crash respawns do not count as successful cycles.

Default Worker scope is now airborne-handoff-v1. There are 100 identities, initially 50 arrivals and one airborne departure; remaining departures join on a predetermined 60-second cadence. Releases are scenario inputs at the first SID fix, not Jev takeoff decisions. No pending aircraft gets a control question. Arrival touchdown/crash retains a two-second terminal display; exit removal follows measurement and the documented outward-handoff condition. Legacy fixtures and migrated historical counters stay labeled separately.

## 2. Execution contract

Execution policy: **jev-command-observe-v1**.

Schema-valid, current-revision commands retain their requested altitude, IAS and rate. A procedure conflict is logged but does not cause rejection, replacement with a safer target, automatic holding, implicit glide-path capture or local traffic avoidance. Aircraft can violate a procedure, collide or hit the simplified ground model. A command with no procedure finding can still cause a traffic conflict.

Physical response remains bounded: acceleration, bank/turn response, vertical acceleration and modeled rate limits remain. An unrealizable rate is reported separately from procedure findings. Numeric repair is not confused with ordinary response time. Lateral route execution, holding entries/timing, SID/missed-approach minimum-turn guidance and prescribed missed-approach-to-hold sequencing remain deterministic pilot behavior. This is not an entirely unfiltered actuator experiment.

Malformed, unsupported-option and stale generation/revision responses remain interface failures. They are not counted as executed procedure-conflicting commands. Low confidence alone does not gate an otherwise valid command.

## 3. Observation units

| Unit | Definition | Counting consequence |
| --- | --- | --- |
| Run | Independently initialized scenario with frozen versions, seed, limits and stopping rules | Replication/reporting unit; one continuous run is not many independent trials |
| Frame | One frozen plan revision split into HTTP batches | Commands share state and affect one another |
| Aircraft-command bundle | Accepted route + altitude + IAS + rate for an aircraft generation in a frame | Denominator for command-conflict fractions |
| Finding | One triggered detector rule within a bundle | Several findings do not become several erroneous commands |
| Flight | Aircraft ID + generation within a run | Callsign alone is not unique after respawn |
| Physical event/episode | Pair episode, collision group, impact or procedure episode | Not interchangeable with a command finding |

Command IDs encode plan revision, aircraft and generation. They are unique within a run, not across independent runs. Pair them with the experiment/run identity. A new decision repeating a target counts again. Physics ticks, forecast clones and report reads do not re-log the same accepted command.

## 4. Command conflicts versus physical outcomes

Audit occurs after assigning the command and establishing its route/phase/clearance state, but before its first physical step. It records raw targets, command identity, receipt-time state, next leg/fix and triggered limits. The action is applied-unmodified.

Evidence bases are separate:

- **published**: a numeric limit comes from the frozen sourced procedure subset. Its executable target-comparison rule is still a simulator interpretation, not independently established regulatory ground truth.
  In v3, FM166 / IRDED / TIBNU holding maxima are sourced 230 kt values; GAZGE / INSTA / ULQAL still use the demo holding-speed fallback. SID route coding remains sourced to SID_01_A, while the 304 FT/NM to 8000 FT gradient value is separately sourced to SID_01.
- **demo-rule**: a simulator assumption, including the low-altitude 250 kt rule and fallback holding-speed table. The pre-FAP floor interpretation is also in this category although its altitude comes from a chart.
- **integration-rule**: a composition constraint, such as the current ILS/landing-permission coupling. This must not be called an aviation regulation.

Physical capability limits are separate, not procedure errors. Multiple runway assignments have an existing separate counter, not a hidden contribution to the command-audit numerator. A permitted VECTOR is not inherently out of procedure.

The legacy commandAudit.procedureCommands field means bundles with any finding, including demo/integration rules. For the published-basis numerator use evaluation.commands.publishedConstraint. Do not call the legacy combined count chart violations.

Example: HOLD_ULQAL / 4000 ft against a frozen 5000 ft minimum produces a command finding at receipt. The aircraft may still be at 6000 ft, with zero measured altitude violations. A later physical violation and a later collision are different observations. If Jev corrects the command before these occur, retain the original finding.

## 5. Detector definitions and limitations

The nine rules and predicates are in evaluation-spec.json. Code: procedureCommandIssues() in src/pilot.mjs; recording/retention: src/command-audit.mjs.

Next-leg comparisons are receipt-time target-compatibility diagnostics, not full trajectory feasibility tests. A target outside a future crossing restriction does not alone prove that crossing will be missed; another clearance can intervene. Report detector-defined conflicts, not an independently adjudicated percentage of objectively wrong ATC decisions.

Command exact-speed comparison is exact. Actual crossing measurement separately uses +/-5 kt and 150 ft tolerances. These are different metrics, not relaxed commands. SID rate assessment uses current no-wind ground speed and a 150 ft target difference condition; it is not a complete climb-feasibility forecast. Unknown/unmodeled conditions cannot be described as verified safe.

Independently review detector definitions against source documents before freezing a paper dataset. Tests establish implementation consistency, not independent domain validity. Record disputed labels and adjudication rules; the simulator's own labels are not an external oracle.

## 6. Clocks and event counting

Report simulated and wall time separately. Physics substeps are <=1 simulated second. Pair contacts use simultaneous horizontal/vertical swept-segment intervals; measurement and terminal semantics are swept-terminal-v2. Normal horizon: 60 simulated seconds. Prediction: up to 120 seconds. Critical predictions within 45 seconds can trigger a request, subject to a 10-simulated-second cooldown and budget.

Provider waits/failures, absent viewers and exhausted budgets pause simulated time. The system does not currently test airborne evolution during real network latency. Latency is a software metric, not demonstrated real-world reaction time.

Separation is horizontal <3 NM AND vertical <1000 ft; critical is <1 NM AND <500 ft. Pair episodes count on entry, not each tick, and can recur after recovery. Collision is <0.12 NM AND <150 ft, grouped into connected participants in a step. A three-aircraft group is one event, not three pair collisions. Collision groups take precedence over terminal landing/impact in the same step. Connected pairs within a substep form one group; a group is a discretized observation, not proof every member touched simultaneously. The 0.25/0.5/1-second constant-velocity regression checks this approximation.

Procedure measurement counts once per category + route/rule/fix key in each aircraft generation, not duration and not every new command. The surface is explicitly 0 ft MSL background plus 60 m wide flat runway strips at sourced threshold elevations; not a terrain database. Touchdown needs actual strip contact, correct runway/alignment, IAS <=190 and sink <=900 fpm (declared simulator limits). Level flight above the strip does not count. Preserve these definitions, parallel-approach limitations and waypoint-crossing approximations in the paper.

## 7. Metrics and denominators

Every fraction exports numerator, denominator, value, unit and status. Zero/unknown denominator gives **null**, never 0% error or 100% success.

Primary descriptive command metric:

~~~text
commands with >=1 detector finding / checked accepted aircraft-command bundles
~~~

Also report published, demo and integration fractions, physical-limit requests, finding counts, per-rule counts and phase/ground-air strata. A command may have multiple basis categories; do not sum their fractions to produce an overall error fraction. Runtime per-rule values remain counts. The verified offline analyzer additionally reconstructs per-rule applicability denominators from matching-source receipt states; those fractions are detector-defined opportunity rates, not independent regulatory compliance rates.

Outcomes and airborne aircraft-hours use deltas from the same evaluation-start baseline. Composite event rate: 100 * (collision groups + ground impacts) / airborne aircraft-hours. Show count and exposure. Keep command findings, procedure episodes, runway conflicts, traffic encounters, throughput and service failures separate.

No finding is not comprehensive procedural compliance, certification or a safety probability. Mock tests are excluded from model-performance denominators. HTTP failures and stale rejections must remain in reporting even though they are not accepted commands.

## 8. Run freezing and provenance

For a paper cohort, freeze the prespecified multi-run plan in [study-design.md](study-design.md) before evaluated data collection. Each frozen run starts in `ready`; only the authenticated `explicit-operator-arm-v1` action begins evaluated wall-time/inference. Viewer traffic cannot arm, pause or resume an evaluated run. The plan deterministically derives every seed from plan ID + run index and forbids outcome-based seed filtering. After the external rule review, `freeze-study-batch.mjs` creates one immutable manifest/initial state per planned run, all linked to the same plan SHA-256, review-packet SHA-256 and review SHA-256. The older `freeze-run.mjs` remains useful for single-run engineering fixtures. Runtime checks compiled source fingerprint, model, version identities, seed and initial snapshot; exposure, wall-time and cumulative input-reservation caps are enforced. Explicitly choose run count, exposure target, wall duration and credit allowance before outcomes are observed. Stop for declared exposure, budget/infrastructure limits or archival failure, not favorable results. Record incomplete/censored runs and reasons.

Preserve the clean Git commit/tree identity, source/lockfile/data/spec hashes, requested/returned model identities, prompt/context/control/evaluation versions, runtime, seed, initial snapshot, budgets, thresholds and stop rules. The supported paper-plan generator refuses a dirty working tree. Do not pool different policy/prompt versions. Historical repair-policy runs remain separate.

Latest evidence includes prompt/context/protocol versions and per-batch SHA-256 of the exact request JSON, requested/returned models, question counts, normalized usage and latency. Local hashing adds no inference calls or input fields. **A hash checks identity; it does not store or reconstruct the input.**

Seeds control synthetic scenario generation, not external model determinism. Exact decision replay requires archived responses and reconstruction context. The visual position replay is not a full decision archive.

## 9. Persistence and missingness

Command audit retains only newest flagged records, bounded by 64 records AND 32000 serialized bytes, with a dropped-record count. Aggregate evaluation counters persist independently of that window. Unflagged details are absent, making the window a biased sample unsuitable for population-rate estimation by itself.

The UI/report incident window retains 200 events and its inline answer distributions cover only the latest successful frame. These are not the research journal: the separate journal retains each new frame and full group command linkage since archive initialization. Request fingerprints alone do not constitute storage. Temporal association is not causation; later commands and aircraft interactions may contribute.

Introducing evaluation into old records starts a new categorization/exposure baseline. Do not reconstruct historical category totals from a biased retained window or relabel old command evidence. Billing, visits, replay and original simulation totals stay preserved.

The Worker now writes an append-only chunked journal with initial snapshot, exact request JSON/candidates, normalized responses, partial failure status, applications and complete new physical events before rolling-window truncation. For a frozen cohort, the journal byte cap is part of the run manifest and must match runtime configuration; exhaustion stops the run incomplete and never evicts research evidence. State and journal commit atomically; a failed or interrupted acknowledgement stops the run as incomplete, preserving uncertain token reserves. Export checks SHA-256 and predecessor chain. Malformed raw provider bodies and private response extras are deliberately not retained. Completeness begins at archive initialization, with no historical backfill. Journaling uses no extra Jev inference, but storage/export have costs.

The report exposes missing capabilities in evaluation.dataAvailability and evaluation.analysisReadiness. Descriptive aggregate results can still be reported with their window and limitations. Full calibration and causal attribution are not implemented analyses. A deterministic archived-command/physics replay regression verifies state digests without re-querying Jev; it is a software replay check, not independent physical validation.

## 10. Confidence and statistics

TypeSafe confidence summarizes concentration of the answer distribution [1]. It is not P(no accident). Do not apply ECE/Brier analysis to confidence as though it were an accident probability. A later calibration study must define the predicted event, select the corresponding probability, obtain justified labels and establish complete sampling.

Questions are independently evaluated over shared state [2], but outcomes are dependent: aircraft share sectors, commands share frames, and flights receive repeated commands. Do not treat 403 question outputs as 403 independent trials or apply a naive independent-binomial interval.

Start with descriptive counts/denominators/exposure and per-run/per-flight summaries. A single budget-limited run has limited scope. Multiple prespecified runs use the deterministic no-outcome-filtering seed plan in [study-design.md](study-design.md); cohort aggregation reports run-level variation and descriptive pooled denominators only, with no invented replication, p-values or intervals. Uncertainty/outcome correlation is exploratory association, not a causal or calibrated early-warning guarantee.

A/B is not required for this single-arm study. Therefore do not claim superiority to a human, another model or another prompt. Offline byte-size comparisons establish input-size reduction, not billed-token savings or unchanged decision quality.

## 11. Validation and publication readiness

Deterministic tests cover command fidelity, detectors, unique-command counting, tick/forecast non-duplication, stale rejection, visible impact/collision, respawn, persistence, historical baselines, null denominators, retention, request hashes and no evaluation input added to inference. Forecast/live agreement is not independent physics validation: both share pilot code.

Before the evaluated run, independently review detectors and the declared surface/exit assumptions, approve the defaults, freeze the tested source/spec and manifest, and perform real-provider and deployment acceptance. Oversized-input stop handling, context geometry, air-only scope, terminal ordering, chunk export and injected archival failure tests are implemented; unit tests are not independent domain validation. Label implemented, proposed and independently validated features separately. A prompt/threshold/option change ends the frozen configuration; do not silently continue as the same experiment.

The paper should contain system/task definition; execution contract; data provenance/scope; prompts/options; software/detector validation; observation/stop protocol; separate command/outcome/resource results; missing/censored data; failure cases; and validity threats. The evaluated-run operating procedure is frozen separately in [study-operations.md](study-operations.md). Publish shareable frozen artifacts, never credentials, visitor IDs or private deployment configuration.

Independent rule adjudication is an external evidence artifact, not a software-test result. The unreviewed template is `docs/rule-review-template.json`. `make-rule-review-packet` freezes the detector/source packet before review. After review, both the exact packet SHA-256 and review-file SHA-256 are attached to the frozen manifest; runtime reporting exposes adjudicated-label status only when both links exist. Hash linkage proves which packet/review files were declared, not the reviewer's identity, expertise or correctness.

## References

[1] TypeSafe, Confidence. Accessed 2026-09-17. https://docs.typesafe.ai/confidence

[2] TypeSafe, State. Accessed 2026-09-17. https://docs.typesafe.ai/concepts/state

Frozen aviation data provenance is in [data-sources.json](data-sources.json). [source-verification-receipt.json](source-verification-receipt.json) records a 2026-09-17T23:54Z re-download in which all 10 listed DHMI URLs matched the frozen byte lengths and SHA-256 values exactly. This proves source-file identity/availability at that check, not semantic correctness, current AIRAC completeness or operational certification. [source-value-verification-receipt.json](source-value-verification-receipt.json) records machine-assisted PyMuPDF direct-text checks for 10 selected sourced values. It explicitly leaves spatially ambiguous STAR constraints, transition-hold speed interpretation, and holding geometry for manual/domain review; it is not independent adjudication.

## Implementation addendum

See [simulation-policy-v2.md](simulation-policy-v2.md) for exact new assumptions and export/freeze commands. Runtime journal availability and local manifest status are reported separately from external preregistration and independent labels. A legacy measurement epoch is saved before a new evaluation baseline is started. A new study identity never resets the existing demo. Daily object-local budget and study cumulative cap are separate; neither is an account-wide charge cap.

## Offline analysis and engineering acceptance

See [offline-validation.md](offline-validation.md) for network-guarded tests, disk-backed soak, CI and verified CSV/JSON analysis. The analyzer requires matching source fingerprints, refuses missing/tampered/mixed data, verifies every state digest, and reports synthetic/unknown evidence separately. No hosted CI, independent rule review, production acceptance or real Jev performance is implied by a local pass.
