# VECTOR multi-run study design

Status: engineering-ready template; no evaluated Jev run has started.

The replication unit is a **run**, not an HTTP request, question, aircraft-command bundle or physics tick. Frozen runs use `explicit-operator-arm-v1`: loading a run leaves it ready; only the authenticated arm action starts evaluated wall-time and inference. A paper cohort consists of several independently initialized runs under one frozen source fingerprint, prompt/context/control/measurement/evaluation/traffic version set, requested model, rule-review artifact and stopping policy.

## Seed selection

Seeds are derived before any model outcome is observed using `sha256-plan-index-v1`:

~~~text
uint32_be(SHA256(UTF8("vector-atc-seed-v1") || 0x00 || UTF8(planId) || 0x00 || UTF8(decimal(runIndex)))[0:4])
~~~

Every derived seed is included in index order. No seed may be replaced because its initial traffic looks easy/hard or because a later outcome is favorable/unfavorable. The plan also stores a designCommitmentSha256 over the source identity, plan ID, run count, model/versions, stopping rules and storage limit before the derived seed list is considered. It separately stores seedListSha256 over the ordered derived uint32 seed list. Changing any of those design inputs changes the commitment. Software cannot prove that an operator never generated and discarded an alternative plan ID; any abandoned candidate plan or external preregistration/commitment must be disclosed separately if applicable. If a derived seed violates a software invariant, the **whole plan is blocked and the defect investigated**; another seed is not substituted.

The plan ID, run count and per-run stopping rules are inputs to `make-study-plan.mjs`. The tool intentionally has no scientific default for run count, exposure or credit cap. Those values must be approved before evaluated data collection. The frozen plan also exposes `maximumPlannedInputTokenAllowance = runCount * per-run input cap`; this is a configured ceiling, not expected or billed usage.

## Stopping and censoring

All runs in one plan use the same target simulated exposure, maximum wall time, per-run input-token cap and research-journal capacity. The journal cap is an infrastructure/retention limit: reaching it stops a run as incomplete rather than evicting research evidence. `stopForFavorableResults` is always false. Infrastructure, provider, archive or budget stops remain incomplete/censored runs and stay visible in aggregation; they are not silently dropped or rerun under the same run identity.

Run order is fixed to plan index order. A retry after an incomplete run must use a new explicitly frozen plan/run identity rather than replacing the original observation. Evaluated wall-time begins at the verified `study-armed` journal event, not at object/archive creation.

## Freeze workflow

1. Start from the clean committed/tagged source that will define the study; the plan records its Git commit/tree and source fingerprint. Approve plan ID, run count, simulated exposure, wall-time ceiling, per-run input-token cap and journal capacity before seeing evaluated outcomes.
2. Generate the plan outside the repository with `npm run make:study-plan -- OUT PLAN_ID RUN_COUNT SIM_SECONDS WALL_SECONDS PER_RUN_INPUT_CAP JOURNAL_MAX_BYTES`.
3. Generate REVIEW_PACKET + blank REVIEW with `npm run make:rule-review-packet -- REVIEW_PACKET REVIEW`, then have the external/domain reviewer complete REVIEW. Software cannot mark the review independent.
4. Freeze the batch with `npm run freeze:study-batch -- PLAN REVIEW_PACKET REVIEW NEW_DIRECTORY`. Each run gets its own manifest and untouched initial state; all are linked to the exact plan SHA-256, review-packet SHA-256 and review SHA-256.
5. Run `npm run preflight:study-batch -- BATCH_DIRECTORY`. Any missing/tampered run blocks the cohort.
6. Complete production and real-provider acceptance under separate authorization. These are external to offline engineering acceptance.
7. Execute every frozen run once in plan order using [study-operations.md](study-operations.md): verify `ready`, arm once with the operator secret, and preserve incomplete runs. Public viewer presence does not start/pause an armed study.
8. Verify/export/analyze each run separately, then aggregate all planned runs with `npm run aggregate:study -- NEW_OUTPUT ANALYSIS_DIR...`.

## Reporting

Primary command and outcome metrics remain the definitions in `evaluation-spec.json`. The cohort report may show pooled descriptive numerators/denominators plus per-run min/median/mean/max. Pooled values are **not** treated as independent-trial estimates because aircraft share traffic, commands repeat within flights and frames share state.

The aggregation tool deliberately emits no p-values, naive independent-binomial confidence intervals, confidence-as-accident calibration, causal attribution or human/model comparison. Incomplete and open runs remain in the run table. Missing planned runs cause aggregation failure rather than being interpreted as zero events.

Run count and exposure are study-design decisions, not software defaults. If inferential statistics are later desired, their estimand, assumptions and analysis plan must be specified separately before looking at evaluated outcomes.
