from __future__ import annotations
import hashlib, json, re, sys
from datetime import datetime, timezone
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parents[1]
SOURCES = json.loads((ROOT / "docs/data-sources.json").read_text(encoding="utf-8"))
DATA = json.loads((ROOT / "src/ltfm-data.json").read_text(encoding="utf-8"))
SOURCE_RECEIPT = ROOT / "docs/source-verification-receipt.json"
SOURCE_RECEIPT_SHA = hashlib.sha256(SOURCE_RECEIPT.read_bytes()).hexdigest()
BY_URL = {row["url"]: row for row in SOURCES}
SOURCE_ID = {row["id"]: BY_URL[row["url"]] for row in DATA["sources"]}

def norm(text: str) -> str:
    text = "".join(ch if ch >= " " else " " for ch in text)
    return re.sub(r"\s+", " ", text).strip()

def pdf_text(pdf_dir: Path, source_id: str) -> tuple[str, dict]:
    row = SOURCE_ID[source_id]
    path = pdf_dir / (row["name"] + ".pdf")
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if len(raw) != row["bytes"] or sha != row["sha256"]:
        raise RuntimeError(f"PDF identity mismatch: {source_id}")
    doc = fitz.open(path)
    text = norm(" ".join(page.get_text("text") for page in doc))
    return text, {"sourceId": source_id, "file": path.name, "bytes": len(raw), "sha256": sha, "pages": len(doc)}
CHECKS = [
    ("sid-gradient-304-8000", "SID_01", r"PDG 5% \(304FT/NM\) up to 8000 FT",
     {"minClimbFtPerNm": 304, "climbGradientUntil": 8000}),
    ("sid-fm047-first-leg", "SID_01_A", r"FM047\[A2100\+;K250-;R\]",
     {"fix": "FM047", "minAltitude": 2100, "maxSpeed": 250}),
    ("sid-fm051-first-leg", "SID_01_A", r"FM051\[A1800\+;K250-;R\]",
     {"fix": "FM051", "minAltitude": 1800, "maxSpeed": 250}),
    ("sid-fm072-first-leg", "SID_01_A", r"FM072\[A2030\+;K250-;[LR]\]",
     {"fix": "FM072", "minAltitude": 2030, "maxSpeed": 250}),
    ("hold-fm166", "IAC_13", r"FM166\[K230-;A3000\]",
     {"fix": "FM166", "minAltitude": 3000, "maxSpeed": 230}),
    ("hold-irded", "IAC_15", r"IRDED\[A5000;K230-\]",
     {"fix": "IRDED", "minAltitude": 5000, "maxSpeed": 230}),
    ("hold-tibnu", "IAC_17", r"TIBNU\[K230-;A4000\]",
     {"fix": "TIBNU", "minAltitude": 4000, "maxSpeed": 230}),
    ("fap-floor-nedba", "IAC_13", r"Descent on the GP below 3000 FT not permitted until passing NEDBA",
     {"fix": "NEDBA", "altitude": 3000}),
    ("fap-floor-usrof", "IAC_15", r"Descent on the GP below 5000 FT not permitted until passing USROF",
     {"fix": "USROF", "altitude": 5000}),
    ("fap-floor-avteq", "IAC_17", r"Descent on the GP below 4000 FT not permitted until passing AVTEQ",
     {"fix": "AVTEQ", "altitude": 4000}),
]
def claim_matches_data(check_id: str, claim: dict) -> bool:
    if check_id == "sid-gradient-304-8000":
        rows = [p for p in DATA["procedures"].values() if p["kind"] == "SID"]
        return bool(rows) and all(p.get("minClimbFtPerNm") == 304 and p.get("climbGradientUntil") == 8000
                                  and p.get("gradientSource") == "SID_01" for p in rows)
    if check_id.startswith("sid-fm"):
        rows = [p["legs"][0] for p in DATA["procedures"].values()
                if p["kind"] == "SID" and p["legs"][0]["fix"] == claim["fix"]]
        return bool(rows) and all(r.get("minAltitude") == claim["minAltitude"]
                                  and r.get("maxSpeed") == claim["maxSpeed"] for r in rows)
    if check_id.startswith("hold-"):
        row = next((h for h in DATA["holds"] if h["fix"] == claim["fix"]), None)
        return bool(row) and row.get("minAltitude") == claim["minAltitude"] and row.get("maxSpeed") == claim["maxSpeed"]
    if check_id.startswith("fap-floor-"):
        rows = [p for p in DATA["procedures"].values() if p["kind"] == "APP" and p.get("fap") == claim["fix"]]
        return bool(rows) and all(next(l for l in p["legs"] if l["fix"] == p["fap"]).get("altitude") == claim["altitude"]
                                  for p in rows)
    return False

MANUAL = [
    {"id": "star-constraint-to-fix-mapping", "sourceId": "STAR_01",
     "status": "manual-visual-review-required",
     "reason": "Chart text extraction contains the values but does not preserve reliable spatial association between every constraint and fix."},
    {"id": "transition-hold-speed-gazge-insta-ulqal", "sourceId": "IAC_13",
     "status": "manual-visual-review-required",
     "reason": "IAF transition speed labels and holding graphics are spatially ambiguous in text extraction; no published hold maxSpeed is asserted."},
    {"id": "holding-course-turn-geometry", "sourceId": "IAC_13/IAC_15/IAC_17",
     "status": "manual-visual-review-required",
     "reason": "Inbound courses and turn-direction symbols require human visual chart review."},
]
def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python scripts/verify-aviation-values.py PDF_DIRECTORY NEW_RECEIPT_JSON")
    pdf_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
    if out.exists():
        raise RuntimeError("Refusing to overwrite source-value verification receipt")
    cache, files, checks = {}, {}, []
    for check_id, source_id, pattern, claim in CHECKS:
        if source_id not in cache:
            cache[source_id], files[source_id] = pdf_text(pdf_dir, source_id)
        match = re.search(pattern, cache[source_id], flags=re.IGNORECASE)
        if not match:
            raise RuntimeError(f"Direct evidence pattern not found: {check_id}")
        if not claim_matches_data(check_id, claim):
            raise RuntimeError(f"Frozen data does not match evidence claim: {check_id}")
        checks.append({"id": check_id, "sourceId": source_id, "status": "verified-direct-text",
                       "page": 1, "claim": claim, "pattern": pattern, "matchedText": match.group(0)})
    receipt = {
        "schemaVersion": 1, "dataset": DATA["id"], "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "method": f"PyMuPDF {fitz.VersionBind} text extraction from byte/hash-verified DHMI PDFs; regex checks; no OCR",
        "sourceFileVerificationReceiptSha256": SOURCE_RECEIPT_SHA,
        "contentAdjudication": False, "externalDomainReview": False,
        "spatialChartReviewStillRequired": True, "providerCalls": 0,
        "files": list(files.values()), "checks": checks, "manualReview": MANUAL,
    }
    out.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"verified": True, "directChecks": len(checks), "manualReview": len(MANUAL),
                      "providerCalls": 0, "output": str(out.resolve())}))

if __name__ == "__main__":
    main()
