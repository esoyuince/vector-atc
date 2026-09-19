# Distributed traffic — local candidate, not deployed

`distributed-flow-v1` is an engineered synthetic scenario, not a recorded or statistically calibrated LTFM traffic sample. The source-route subset remains LTFM-SOUTH-v3. No new aviation standard is asserted by the population, timing, spacing or kinematic estimates below.

## Population and scheduling

The pool remains 50 arrival and 50 departure identities. A new run starts with 18 arrivals across early/middle/late STAR segments, 6 approaches and 12 SID departures. The other 26 arrivals and 38 departures are pending and receive no model questions.
Approaches use GAZGE/INSTA/ULQAL transitions and separated observation distances; arrivals are not all placed at the same two route entrances. Initial points lie on the route corridor, and headings, progress, speeds and altitudes match that segment.
Initial approach permissions and initial route progress are labeled scenario inputs, not Jev decisions. Initial Jev command count is zero.
Arrival demand gaps are 75–150 simulated seconds, departure gaps 90–165 seconds. A separate seeded RNG records the schedule. Occupied entry points defer admission and preserve the nominal demand timestamp; later entries cannot form a catch-up burst. This is synthetic admission conditioning and must be disclosed in analysis.
Recycled identities join the pending queue; they are not immediately respawned into active traffic. Queueing clears stale navigation/approach state. Neither admission nor initialization relocates an incumbent aircraft or alters an applied AI command.

## Initial profiles

Arrival altitude and speed profiles interpolate between the route's explicit anchors; unconstrained intermediate fixes are not independently invented altitude targets. Monotone feasibility is checked before sampling. An incompatible profile fails closed instead of relaxing a source constraint.
Approach profiles stay at or above the FAP altitude before the FAP, then descend toward the source threshold elevation. This restriction applies only to synthetic initial-state generation, not subsequent command execution.
SID altitude samples use a disclosed 330 ft/NM nominal climb, capped at 18,000 ft; speed, bank and vertical-rate approximations remain generic. These are not aircraft-manufacturer performance data or observed local procedures.
Initial admission requires 3.1 NM horizontal separation or 1,000 ft vertical separation, with an additional 1 NM horizontal spacing check. These are experiment-generation conditions, not a complete operational separation standard. They do not guarantee separation after the model starts issuing commands.

## Reproducibility and history

A seed creates the same candidate without substituting another seed on failure. Placement attempts, initial profiles, demand clocks, admission attempts and deferrals are recorded in state/journal evidence. New tests cover profiles, route continuity, deferred admission, no-repair behavior and queueing.
Existing stored scenarios retain their previous placement/recycling path. Old frozen runs, manifests and review packets are not relabeled or resumed under the changed source/traffic fingerprint. The production main checkout and stopped live run are separate from this worktree.
Local test receipts, seed sweeps and synthetic soak results are written outside the repository. Their result is separate from production acceptance, independent domain review and real-provider evaluation.
The operator emergency-stop endpoint remains a separate prerequisite before another live run. This scenario work does not authorize deployment or rearming production.
