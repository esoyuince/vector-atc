# Provider-balance live collection (v0.6.7)

This is an explicitly authorized, unreviewed observational collection, not an independently adjudicated paper cohort.
The user requested removal of numeric token ceilings and at least two hours of data, or until provider credits are exhausted.
The operational target is 7200 simulated seconds. AI latency is excluded from simulated exposure, so wall time can be longer.
The existing demo object/history is preserved. A new RESEARCH_RUN_ID selects a separate Durable Object.

## Budget and stopping semantics

A frozen manifest must declare tokenBudgetPolicy=provider-balance-v1, maxTotalInputTokens=null, maxWallSeconds=null,
evidenceClass=live-unreviewed-collection, independentRuleReview=false and preregistered=false. It cannot claim cohort membership.
AI_DAILY_TOKEN_LIMIT=provider-balance is allowed only for that exact manifest. Missing or invalid ordinary settings do not enable it.
Daily/total local input-token ceilings are absent, rather than replaced by a large number. Accounting and request-size/hourly controls remain.
The run stops at its target exposure, HTTP 402 payment refusal, non-retriable provider/contract failure, exhausted transient retries or archive failure.
HTTP 429/529 responses allow at most six exponential-backoff retries (60 to 600 seconds); failed frames do not advance physics or apply commands.
If a frame mixes successful and retryable failed batches, its successful responses are archived but unapplied; retry repeats the complete frozen frame.
Uncertain failed-call reservations stay visible. A restart with an unresolved dispatch stops; no blind retry of uncertain work is introduced.
No credit purchase or automatic-top-up change is performed. Actual balance and provider auto-recharge settings are not verified by this feature.
The provider enforces available credit; this is not an independent account-wide financial guarantee.

## Operation

Commit and verify the exact source; run `node --import ./scripts/offline-guard.mjs scripts/freeze-collection.mjs OUT RUN_ID 7200`.
The CLI derives one seed from the run ID without filtering observed outcomes. Preserve all failed runs under their original identity.
Set the matching manifest/run ID, 1000000000-byte journal capacity, pinned model, provider-balance daily policy and AI enabled.
Store a high-entropy STUDY_ARM_TOKEN as a deployment secret. Before arm, state must remain ready with zero progress even with viewers.
Only the existing authenticated operator arm starts collection. It continues without browser/viewer presence.
Export and verify the complete journal with the exact matching source; never label a prefix or early infrastructure stop as two hours completed.
The new source invalidates old review packets for this run. Independent rule adjudication remains pending and is shown as such.

References: TypeSafe API error/rate handling https://docs.typesafe.ai/api ; pinned-model behavior https://docs.typesafe.ai/models .
