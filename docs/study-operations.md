# VECTOR evaluated-run operations

Status: operational procedure template. No evaluated Jev run has started.

## Preconditions

Use the exact clean commit/tag and frozen batch that passed batch preflight. Complete production and real-provider acceptance separately before evaluated collection. The batch must contain the completed external rule review, protocol snapshots, RUN_ORDER.csv, run manifests and initial states.

Study runs use the frozen start policy **explicit-operator-arm-v1**. Creating/loading a study Durable Object leaves it in `ready`; public viewers, state/report reads and presence heartbeats cannot start inference or wall-time accounting.

## Operator secret

Configure a high-entropy `STUDY_ARM_TOKEN` as a deployment secret, not a normal source-controlled variable. It is authorization material only and is deliberately excluded from the plan, manifest, journal, export and paper artifacts. Rotate/revoke it independently of study evidence.

The operator CLI is:

~~~sh
STUDY_ARM_TOKEN=... npm run arm:study -- https://STUDY_HOST
~~~

The client accepts HTTPS (or loopback for local QA), sends one authenticated POST to /api/study/arm and prints only the arm receipt. Do not paste the token into run manifests, shell transcripts intended for publication, screenshots or issue trackers.

## Sequential run procedure

1. Read the next row of frozen RUN_ORDER.csv. Do not skip or substitute a seed.
2. Configure RESEARCH_RUN_ID and RUN_MANIFEST_JSON for exactly that row and set RESEARCH_JOURNAL_MAX_BYTES to the manifest value.
3. Confirm /api/state reports studyStatus=ready and zero evaluated progress. Viewer traffic may exist but cannot arm the run.
4. Confirm the expected source/model/runtime configuration and the batch preflight receipt.
5. Arm exactly once with the operator CLI. The first successful arm creates the journal event `study-armed`; this timestamp starts study wall-time.
6. After arm, the frozen run is intentionally independent of public viewer presence. Closing browsers must not pause, cancel or change application of Jev decisions.
7. Do not change prompt/context/control/measurement/evaluation/traffic versions, model, budget cap, journal cap or stop rules during the run.
8. Let the run end through its frozen target exposure or an explicit infrastructure/provider/budget stop. Never stop because results look favorable or unfavorable.
9. Preserve incomplete/censored runs under their original run identity. Do not rerun them as replacements.
10. Export and verify the journal, generate the per-run analysis, and preserve the stop reason before moving to the next RUN_ORDER row.
11. Do not arm run N+1 before run N has stopped. Cohort aggregation rejects overlapping/out-of-order run wall-time windows.

## Timing semantics

Archive creation can precede arm. For evaluated studies, paper wall-time is the verified `study-armed` journal timestamp through the verified `study-stop` timestamp (or final verified checkpoint for an open prefix). Pre-arm reads/viewers are outside this evaluated wall-time window and cannot advance simulated time.

The run remains deterministic only with respect to the seeded simulator and archived inputs/responses. Explicit arm does not imply provider/model determinism.

## Failure handling

A missing/wrong arm token does not mutate the run. Arm is idempotent while already running. A run that is completed/incomplete cannot be armed again. Provider/contract failure, returned-model mismatch, archive failure, input-envelope failure, token cap, wall-time cap and journal-cap exhaustion remain visible stop conditions.

Never manually edit a frozen manifest, initial state, journal, review packet, review file, batch descriptor or RUN_ORDER.csv to recover a failed run. Create a new disclosed plan/run identity if a separate follow-up run is scientifically justified.

## Scope of this mechanism

The arm secret authenticates the operator action; it is not scientific evidence and its secrecy does not validate the experiment. Hash chains and Git identities prove internal artifact identity, not reviewer identity, external preregistration, model quality or aviation validity.
