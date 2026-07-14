"""
Stage 3 accuracy gate — recall@50 on the `descriptions` collection.

30 hand-written queries spanning all 9 law types. Each is a genuine paraphrase
(NOT the row's text verbatim) whose known target row must appear in the top-50
ANN results. The doc's gate: recall@50 >= 0.9 before reranking (Stage 4) is added.

Run:  python pipeline/eval_stage3.py
"""

from __future__ import annotations

import embed

# (query, target law_id, type) — targets verified against the Stage-1 store.
GOLD = [
    # P — Law Enforcement
    ("Illinois law barring state and local police from assisting federal immigration detention without a criminal warrant", 4978, "P"),
    ("West Virginia law forbidding local governments from adopting policies that limit cooperation with immigration enforcement", 5257, "P"),
    ("Boston police declining all ICE civil immigration detainer requests under the Boston Trust Act", 7194, "P"),
    # B — Benefits
    ("Virginia in-state college tuition for special immigrant juveniles and human trafficking victims", 5144, "B"),
    ("Vermont financial assistance to help pay hospital medical bills, including for immigrants", 5149, "B"),
    ("Connecticut granting in-state tuition rates to students without legal immigration status", 3953, "B"),
    ("Illinois Welcoming City program accepting a foreign passport or consular ID as identification", 210, "B"),
    ("Vermont excluding the income of asylum seekers and refugees from household income calculations", 5147, "B"),
    # D — Driver's licenses
    ("Virginia driving privilege card for people who do not qualify for a standard driver's license", 4915, "D"),
    ("Idaho requiring proof of citizenship to obtain a driver's license", 5097, "D"),
    ("Washington DC limited-purpose driver license for residents regardless of immigration status", 4238, "D"),
    ("California anti-discrimination and privacy protections for immigrants who hold driver's licenses", 4216, "D"),
    # E — Employment
    ("North Carolina requiring employers with 25 or more employees to use E-Verify", 3998, "E"),
    ("Seattle ordinance protecting cannabis industry workers from losing their jobs", 1668, "E"),
    ("Missouri city law making English official and fining employers who hire undocumented workers", 7024, "E"),
    # L — Language
    ("New York requiring state agencies to translate vital documents for limited-English speakers", 5120, "L"),
    ("Hazleton Pennsylvania Illegal Immigration Relief Act declaring English the official language", 7132, "L"),
    # H — Housing
    ("Fremont Nebraska ordinance restricting landlords from renting to undocumented immigrants", 7144, "H"),
    ("Los Angeles mayoral directive banning the use of city property as an ICE staging area", 10676, "H"),
    ("Georgia maximum occupancy ordinance limiting how many people may live in a dwelling", 55, "H"),
    # W — Law related
    ("Virginia prohibiting notaries public from giving immigration legal advice", 4296, "W"),
    ("Long Beach Defending Our Values Act strengthening the city's sanctuary policy", 9274, "W"),
    ("Illinois task force on universal legal representation for people in immigration removal proceedings", 5209, "W"),
    ("Colorado law setting completion deadlines for immigration certification forms and limiting disclosure", 4958, "W"),
    # V — Vote related
    ("Arizona requiring proof of citizenship to register to vote", 5058, "V"),
    ("Washington DC allowing noncitizen residents to vote in local elections", 5085, "V"),
    ("Virginia requiring removal of noncitizens from the voter registration rolls", 4293, "V"),
    # T — Transportation
    ("DeKalb Illinois ordinance regulating where intercity buses may drop off migrants", 7156, "T"),
    ("New York City requiring charter buses to give 32 hours notice before dropping off migrants", 1746, "T"),
    ("New York City executive order on charter buses transporting migrants into the city", 1747, "T"),
]

K = 50


def run():
    hits, ranks, misses = 0, [], []
    per_type = {}
    for query, target, typ in GOLD:
        results = embed.search_laws(query, k=K)
        ids = [r["law_id"] for r in results]
        found = target in ids
        rank = ids.index(target) + 1 if found else None
        hits += int(found)
        per_type.setdefault(typ, [0, 0])
        per_type[typ][1] += 1
        per_type[typ][0] += int(found)
        if found:
            ranks.append(rank)
        else:
            misses.append((query, target, typ))

    n = len(GOLD)
    recall = hits / n
    mrr = sum(1 / r for r in ranks) / n

    print(f"Stage 3 gate — recall@{K} on `descriptions`")
    print(f"  queries      : {n}")
    print(f"  recall@{K}    : {recall:.3f}   (gate: >= 0.90)  {'PASS' if recall >= 0.9 else 'FAIL'}")
    print(f"  MRR          : {mrr:.3f}")
    print("  per type     : " + ", ".join(f"{t} {c}/{tot}" for t, (c, tot) in sorted(per_type.items())))
    if misses:
        print("  misses:")
        for q, t, ty in misses:
            print(f"    [{ty}] target {t}: {q}")
    return recall


if __name__ == "__main__":
    import sys
    sys.exit(0 if run() >= 0.9 else 1)
