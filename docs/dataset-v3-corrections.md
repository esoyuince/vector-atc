# LTFM-SOUTH-v3: four STAR source corrections

This is a simulator-data correction, not an aviation certification or an independent review.
The source is the frozen DHMI STAR_01 chart and formal-description table, page 1:
https://www.dhmi.gov.tr/AIPDocuments/LT_AD_2_LTFM_STAR_01_en.pdf
SHA-256: 5358189d2246bd2bfb65f586430c101a69d1d14d4b13ba67b2d8fa6e42dfe2d1.

| Procedure / fix | v2 representation | v3 representation |
| --- | --- | --- |
| ERSEN1R / FM450 | No ceiling; FL260 was placed at FM642 | FM450 maxAltitude 26000; no ceiling at FM642 |
| RIXEN1P / RIXEN | maxSpeed 250 | speed 250 |
| ERSEN1R / EPEKI | maxSpeed 280 | speed 280 |
| ERSEN1R / FM644 | maxSpeed 250 | speed 250 |

The simulator distinguishes an unqualified K value (exact speed) from K...- (maximum speed).
The chart labels and formal description were visually checked for these four items.
The selected-value verifier now includes four named, neighbour-bounded text matches from that same hash-frozen PDF.
It still does not adjudicate all STAR constraints, holding-speed interpretations or holding geometry.

## Root cause and regeneration

The ignored original generator repeated the same handwritten mappings. It also predated v2's three holding maxima and SID gradient source attribution, so rerunning it could undo those corrections.
The authoritative generator is now tracked at scripts/build-ltfm-data.py, includes the v2 corrections, and participates in source provenance. The local legacy entry point delegates to it.
Run `npm run verify:data` with the frozen PDF/text inputs available under design/ltfm-sources. Python 3 is required; no third-party Python package is needed for this generator.
The generator verifies paired PDF hashes against docs/data-sources.json and canonical text hashes against docs/generator-text-inputs.json. These checks establish artifact identity, not independent source interpretation.
No arguments (or --check) compares generated data with src/ltfm-data.json without writing it. --output accepts only a NEW file outside the repository. Source replacement requires explicit review of that candidate's diff.

## Evidence and history separation

The new Node regressions first failed on v2, then passed after the four corrections. They check both data mappings and receipt-time findings; below/above exact speeds and a ceiling violation remain applied unchanged, never repaired by the pilot.
The dataset migration tests cover both v1 and v2 histories: cumulative counters, budgets and replay remain preserved while new data/evaluation epochs start at migration. Old frozen runs and review packets cannot be silently reused with the new source identity.
The evaluation algorithm identifier stays vector-observational-v3; the data identity is now LTFM-SOUTH-v3. Independent review is still unreviewed, and the previous v0.6.5 packet is retained unchanged outside the repository.
Regenerate provenance and a new unapproved review packet from the final candidate source. A published clean commit/tag and independent review are separate steps, not implied by passing these tests.
