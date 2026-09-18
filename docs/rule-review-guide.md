# Independent rule-review guide

This guide is for the external/domain review that must occur before evaluated paper runs. It is not a substitute for reviewer expertise and it does not authorize deployment or Jev spending.

Generate the exact machine-readable packet and blank review outside the repository:

~~~sh
npm run make:rule-review-packet -- REVIEW_PACKET.json REVIEW.json
~~~

The packet contains the frozen source fingerprint, dataset retrieval date, source URLs/hashes, detector predicates/interpretations and simulator assumptions. Record source ID plus page/section (or an explicit assumption rationale) in every review-row evidence array. Use only accepted, accepted-with-limitation or rejected; limitations require notes. A rejected row blocks study freeze.

## Detector review map

| Detector | Classification | Review target |
| --- | --- | --- |
| holding-minimum-altitude | published | Verify frozen hold minimum values against IAC_13 / IAC_15 / IAC_17 as applicable. |
| holding-speed-limit | published-or-demo | Current frozen holds have no maxSpeed; fallback 200/230/265 kt is a simulator rule and must not be described as sourced LTFM speed data. |
| published-altitude-floor | published | Verify exact/min altitude values on the active next leg against its frozen STAR/SID/IAC source. |
| published-altitude-ceiling | published | Verify exact/max altitude values on the active next leg against its frozen source. |
| published-speed-constraint | published | Verify exact/max speed values on the active next leg against its frozen source. |
| fap-altitude-floor | demo-rule using published data | Verify the FAP altitude data; separately judge the simulator-wide interpretation that it acts as a pre-FAP floor. |
| approach-clearance-mismatch | integration-rule | Judge software composition semantics only; do not label it an aviation regulation. |
| low-altitude-speed-limit | demo-rule | Judge the declared simplified simulator rule; no LTFM source is claimed. |
| sid-climb-gradient | published + kinematic interpretation | Verify SID_01_A gradient values; separately review the instantaneous no-wind ground-speed conversion. |
## Simulator-assumption review map

| Assumption | What is being reviewed |
| --- | --- |
| surface-model | Zero-MSL background plus flat 60 m runway strips; no terrain/obstacle mesh. |
| touchdown-criteria | Contact/alignment/IAS/sink thresholds used to classify landing versus impact. |
| departure-handoff | >=30 NM, outward heading and 120 s conflict-free forecast before removal. |
| arrival-injection | Seeded upstream scatter around the assigned STAR first fix. |
| departure-injection | First-SID-fix injection at 180 kt and the declared initial altitude rule. |
| holding-entry-and-timing | Deterministic entry sectors and 60/90 s timing; not a complete local holding implementation. |
| separation-thresholds | Experimental 3 NM/1000 ft, 1 NM/500 ft and 0.12 NM/150 ft point-aircraft thresholds. |
| generic-aircraft-performance | Generic acceleration/bank/vertical-rate envelopes; not AFM-certified performance. |

## Provenance chain

The completed REVIEW.json must retain the SHA-256 of REVIEW_PACKET.json. Finalization then records both the packet SHA-256 and completed review SHA-256 in every evaluated run manifest. Multi-run manifests also carry the clean source Git commit/tree, study-plan SHA-256, seed-independent design commitment SHA-256, ordered seed-list SHA-256 and run index. The runtime/report may expose independent adjudication only when both review hashes are present.

Hash linkage identifies the declared artifacts; it does not prove reviewer identity, expertise or correctness. The reviewer should preserve any page screenshots/notes separately if publication or audit policy requires them, without adding private credentials to this repository.

Software tests validate schema and linkage only. They must never turn the unreviewed template into an approved domain decision.