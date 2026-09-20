# Operator emergency stop

This mechanism stops a synthetic simulator run; it is not operational aviation equipment.
The public UI offers ACIL DURDUR / EMERGENCY STOP. A visitor cannot execute it without the deployment's STUDY_ARM_TOKEN. The browser uses a password input, never URL parameters or browser storage, and clears it on submit/cancel. The server verifies the secret, optional same-origin header, a bounded JSON body, and the exact run plus experiment identity.

## Contract

POST /api/operator/stop with Authorization: Bearer <operator token> and JSON {runId, experimentId}.
GET and unrelated mutations cannot trigger a stop. A wrong or stale target returns 409 without changing anything; invalid credentials or cross-origin requests return 403. Stop authorization shares the existing operator secret; it is not the TypeSafe provider key.

The CLI is `npm run stop:study -- HTTPS_BASE_URL RUN_ID EXPERIMENT_ID`, with STUDY_ARM_TOKEN set in the process environment. Use `-` for a demo with no runId. Obtain the exact operatorTarget from /api/state. The client performs one POST, refuses redirects, requires TLS except for loopback QA, and never prints remote error bodies or credentials. A timeout is an UNKNOWN outcome, not successful shutdown; read status and repeat only for the same target.

## Durable boundary

An in-memory fence is set and the provider AbortController is signalled immediately on authorized receipt. The stop does not wait for a provider response. Record writes are serialized; any already-started write completes before the durable stop checkpoint, and later ordinary writes are rejected. A separate operator-stop-v1 latch is persisted BEFORE the stopped record and journal event. Successful acknowledgment requires durable storage, not just aborting a request.

The stopped record has zero frameRemaining, paused=true and AI mode study-stopped. Ready/running studies become incomplete with reason operator-stop; an already completed/incomplete study retains its prior outcome and receives a separate latch event. A ready run records operator-stop-before-arm, not a fictitious evaluated study-stop. Such an unstarted export is not an evaluated dataset.

The latch is restored after an object restart. Arm, viewer traffic, stale queued writes and duplicate alarm delivery cannot clear it. There is no resume/reset endpoint for a latched run. A subsequent experiment needs a new declared identity and manifest, not an edit to the old run.

## Provider and evidence semantics

A request with a durable dispatch intent but provably not yet sent is cancelled and its reservation released. Sent requests may remain billable despite abort. Late successful usage is settled once, and failed/unknown usage stays reserved. Normalized late outcomes are journaled without applying commands or advancing physics. Stop is not a refund guarantee.

The journal is not cleared or rewritten. If it is full/corrupt/unavailable, shutdown still persists in the separate latch and state record; the receipt explicitly says journalStatus=unavailable and full-journal readiness is false. Old replay pages and flight counters remain intact. A failure to persist the latch must not be shown as confirmed shutdown.
