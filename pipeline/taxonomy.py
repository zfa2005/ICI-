"""
ICI SubFederal Laws taxonomy — the authoritative (type, subtype) reference.

Encoded from "Categories of SubFederal Laws" (current as of 2025-03-13; the human
document is kept at pipeline/reference/Categories_of_SubFederal_Laws.md and in the
workspace). This module is the machine-readable source of truth the pipeline
validates against, so validation is reproducible from the repo alone — it does
NOT depend on the gitignored workspace copy. Obtaining this doc closes the gap
noted in ISSUES.md and lets Stage 1 validate subtypes authoritatively (ISSUE-030).

Key facts encoded here:
  * Subtype codes are GLOBALLY unique — each number belongs to exactly one type.
    So `B/2` is invalid (subtype 2 = "Secure Communities" is a P code), and
    `E/13` is invalid (subtype 13 = "Drivers Licenses" is a D code).
  * Base points are per type (P=4, D/E/H/T=3, B=2, L/W/V=1), but a few subtypes
    OVERRIDE that: B/12 and B/14 are 1 point; E/18,19,20,21,62 are 2 points.
"""

from __future__ import annotations

# Base tier points per law-type letter.
TYPE_POINTS = {"P": 4, "B": 2, "D": 3, "E": 3, "L": 1, "H": 3, "W": 1, "V": 1, "T": 3}

# subtype code (string) -> (type, points, short label)
# points reflect subtype-level overrides where the document specifies them.
SUBTYPES: dict[str, tuple[str, int, str]] = {
    # ── P  Law Enforcement — 4 points ────────────────────────────────────────
    "1":  ("P", 4, "287(g) agreement"),
    "2":  ("P", 4, "Secure Communities"),
    "3":  ("P", 4, "Immigration Crimes"),
    "4":  ("P", 4, "Conditions/punishments for immigration crimes or immigrants"),
    "5":  ("P", 4, "Checking immigration status, arrest based on immigration status"),
    "6":  ("P", 4, "Other compensation"),
    "7":  ("P", 4, "Funding"),
    "8":  ("P", 4, "Other"),
    "36": ("P", 4, "School district/university policies"),
    "37": ("P", 4, "Detainers used to enforce immigration laws"),
    "38": ("P", 4, "Release immigration information on individual detainees"),
    "39": ("P", 4, "Use of government resources to enforce immigration laws/cooperation"),
    "40": ("P", 4, "Not allow ICE/CBP to interview in local jail"),
    "41": ("P", 4, "Transit authorities"),
    "42": ("P", 4, "Joint operations"),
    "43": ("P", 4, "Private employer ability to cooperate"),
    "44": ("P", 4, "Jail space"),
    "45": ("P", 4, "Courts and other sensitive locations"),
    "46": ("P", 4, "Hotels"),
    "47": ("P", 4, "T/U/SIJS Visas"),
    "48": ("P", 4, "Basic Ordering Agreements"),
    "49": ("P", 4, "Immigration Counsel"),
    "50": ("P", 4, "Warning"),
    "51": ("P", 4, "License Plates & Facial Recognition Technology & Databases"),
    "53": ("P", 4, "Subpoenas"),
    "59": ("P", 4, "Prosecutorial discretion / immigration-neutral convictions"),
    "60": ("P", 4, "Sanctuary policies"),
    "61": ("P", 4, "Probation officer cooperation with ICE"),
    "65": ("P", 4, "DNA"),
    "67": ("P", 4, "State Orders of Removal"),
    "68": ("P", 4, "Private enforcement / private right of action"),
    "69": ("P", 4, "Government funding depends on compliance"),
    "70": ("P", 4, "Criminal penalties against government for violations (incl. immunity)"),
    "71": ("P", 4, "State/local authorities required to report to state"),
    "72": ("P", 4, "Law enforcement transportation of immigrants to federal detention"),
    "73": ("P", 4, "Required to report undocumented persons to the federal government"),
    "74": ("P", 4, "State parole laws/programs to deport immigrants more quickly"),
    "76": ("P", 4, "Participate in immigration sweeps"),
    "77": ("P", 4, "Judicial review of detainer requests"),

    # ── B  Benefits — 2 points (12 & 14 override to 1) ───────────────────────
    "9":  ("B", 2, "General Eligibility"),
    "10": ("B", 2, "Education"),
    "11": ("B", 2, "Welfare (Medical, Cash assistance, Housing)"),
    "12": ("B", 1, "Non-work-related licenses (e.g., Guns)"),
    "34": ("B", 2, "ID cards"),
    "14": ("B", 1, "Other"),
    "15": ("B", 2, "Funding"),
    "52": ("B", 2, "Refugee (resettlement)"),
    "54": ("B", 2, "Release or collect immigration information"),
    "58": ("B", 2, "Immigration detention facilities/conditions"),
    "64": ("B", 2, "Keeping immigration information secure"),

    # ── D  Driver's licenses — 3 points ──────────────────────────────────────
    "13": ("D", 3, "Drivers Licenses"),

    # ── E  Employment — 3 points (18,19,20,21,62 override to 2) ──────────────
    "16": ("E", 3, "General Eligibility"),
    "17": ("E", 3, "Government Contracts"),
    "22": ("E", 3, "Funding"),
    "56": ("E", 3, "Employment Discrimination"),
    "57": ("E", 3, "ICE Interactions"),
    "75": ("E", 3, "Private right of action / complaint mechanism"),
    "18": ("E", 2, "Conditions (compensation, tax)"),
    "19": ("E", 2, "Professional Licenses"),
    "62": ("E", 2, "DACA Professional Licenses"),
    "20": ("E", 2, "Day Labor Camps"),
    "21": ("E", 2, "Other"),

    # ── L  Language — 1 point ────────────────────────────────────────────────
    "23": ("L", 1, "English only"),
    "24": ("L", 1, "Other/cultural"),
    "25": ("L", 1, "Funding"),

    # ── H  Housing — 3 points ────────────────────────────────────────────────
    "26": ("H", 3, "Landlord Ordinances"),
    "27": ("H", 3, "Maximum Occupancy"),
    "28": ("H", 3, "Other"),
    "29": ("H", 3, "Funding"),

    # ── W  Law related — 1 point ─────────────────────────────────────────────
    "30": ("W", 1, "Restrictions on notary publics and other non-lawyers"),
    "31": ("W", 1, "Legal services, including legal defense funds"),
    "35": ("W", 1, "Other"),

    # ── V  Vote related — 1 point ────────────────────────────────────────────
    "32": ("V", 1, "Conditions/qualifications for voting (proof of citizenship, etc.)"),
    "33": ("V", 1, "Campaign contributions"),

    # ── T  Transportation — 3 points ─────────────────────────────────────────
    "63": ("T", 3, "Government Contracts"),
    "66": ("T", 3, "Transporting immigrants"),
}

VALID_TYPES = set(TYPE_POINTS)


def normalize_subtype(raw) -> str:
    """Canonicalize a raw subtype value to its integer-string code where possible.
    '13' / '13.0' / ' 13 ' -> '13'. Non-numeric junk ('null', 'language', 'T')
    is returned stripped so it can be reported as unknown."""
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    try:
        return str(int(float(s)))
    except (TypeError, ValueError):
        return s


def subtype_type(code: str):
    """Return the canonical type for a subtype code, or None if unknown."""
    entry = SUBTYPES.get(normalize_subtype(code))
    return entry[0] if entry else None


def is_known_subtype(code: str) -> bool:
    return normalize_subtype(code) in SUBTYPES


def is_valid_pair(type_: str, subtype) -> bool:
    """True iff `subtype` is a known code AND it belongs to `type_`."""
    return subtype_type(subtype) == (type_ or "").strip().upper()


def expected_points(subtype) -> int | None:
    entry = SUBTYPES.get(normalize_subtype(subtype))
    return entry[1] if entry else None