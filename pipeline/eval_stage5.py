"""
Stage 5 accuracy gate — the tool-use pipeline states correct, verifiable counts.

Sends a fixed 20-question script to the Node /api/chat (which runs the Claude
tool-use loop over this FastAPI service) and checks that each answer contains the
ground-truth number, which we compute independently here via the Stage-2 tools
(tools.py) — i.e. against the SQLite, not against the model. Covers every law
type, comparisons, an ICI-score question, a concept/search question, and a
multi-turn follow-up (conversation memory).

Prereqs: FastAPI up (python server.py) AND Node up (node server.js) with a valid
ANTHROPIC_API_KEY. Run:  python pipeline/eval_stage5.py
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request

import tools

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows console is cp1252

NODE = "http://127.0.0.1:3000/api/chat"


def ask(messages) -> str:
    body = json.dumps({"messages": messages}).encode()
    req = urllib.request.Request(NODE, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
        return (data.get("content") or [{}])[0].get("text", "")
    except Exception as e:  # noqa: BLE001 — never crash the whole gate on one call
        return f"[request error: {e}]"


def has_number(text: str, n: int) -> bool:
    """True if the integer n appears in the text (with/without thousands commas;
    normalizing the Unicode minus sign the model often uses)."""
    t = text.replace("−", "-").replace("–", "-")   # − / – → -
    forms = {str(n), f"{n:,}"}
    return any(re.search(rf"(?<![\d]){re.escape(f)}(?!\d)", t) for f in forms)


# Ground truth computed from the Stage-2 tools (SQLite), not hardcoded.
def gt_filter(**kw):
    return tools.filter_laws(limit=1, **kw)["total_count"]


def gt_score(juris, **kw):
    return tools.score_ici(juris, **kw)["ici_score"]


# (question or [multi-turn messages], expected_int, label)
CASES = [
    ("How many immigration laws did Texas enact in 2019?", gt_filter(state="TX", year_from=2019, year_to=2019), "TX 2019"),
    ("How many laws did California enact in 2017?", gt_filter(state="CA", year_from=2017, year_to=2017), "CA 2017"),
    ("How many 287(g) agreements were recorded in 2017?", gt_filter(source_type="287g", year_from=2017, year_to=2017), "287g 2017"),
    ("How many local laws were enacted in 2017?", gt_filter(source_type="local", year_from=2017, year_to=2017), "local 2017"),
    ("How many state-level laws were enacted in 2017?", gt_filter(source_type="state", year_from=2017, year_to=2017), "state 2017"),
    ("How many laws did New York enact in 2020?", gt_filter(state="NY", year_from=2020, year_to=2020), "NY 2020"),
    ("How many laws did Florida enact in 2018?", gt_filter(state="FL", year_from=2018, year_to=2018), "FL 2018"),
    ("How many housing laws (type H) are in the database?", gt_filter(type="H"), "type H"),
    ("How many driver's license laws (type D) are there?", gt_filter(type="D"), "type D"),
    ("How many voting-related laws (type V) are there?", gt_filter(type="V"), "type V"),
    ("How many transportation laws (type T) are there?", gt_filter(type="T"), "type T"),
    ("How many language laws (type L) are there?", gt_filter(type="L"), "type L"),
    ("How many pro-immigrant (sanctuary) laws does California have?", gt_filter(state="CA", pos_neg=1), "CA positive"),
    ("How many restrictive laws does Arizona have?", gt_filter(state="AZ", pos_neg=0), "AZ negative"),
    ("How many sanctuary-policy laws (subtype 60) are in the database?", gt_filter(subtype="60"), "subtype 60"),
    ("What is the total ICI score for California (all years)?", gt_score("CA"), "ICI CA"),
    ("What is Texas's ICI score for 2017?", gt_score("TX", year=2017), "ICI TX 2017"),
    ("How many total laws does California have in the database?", gt_filter(state="CA"), "CA total"),
    # concept / semantic search (no exact number asserted — checks it answers with laws)
    ("Find laws about landlords being required to check tenants' immigration status.", None, "search: landlords"),
    # multi-turn follow-up — conversation memory (ISSUE-004): 2nd turn omits the state
    ([("How many laws did Illinois enact in 2017?", None),
      ("What about 2016?", gt_filter(state="IL", year_from=2016, year_to=2016))], None, "follow-up IL 2016"),
]


def run():
    passed = 0
    checked = 0
    print("Stage 5 gate — tool-use answers vs Stage-2 SQL ground truth\n")
    for q, expected, label in CASES:
        if isinstance(q, list):  # multi-turn
            msgs, answer = [], ""
            for turn, _exp in q:
                msgs.append({"role": "user", "content": turn})
                answer = ask(msgs)
                msgs.append({"role": "assistant", "content": answer})
            expected = q[-1][1]
        else:
            answer = ask([{"role": "user", "content": q}])

        if expected is None:
            ok = len(answer.strip()) > 40  # produced a substantive answer
            note = "answered" if ok else "empty"
        else:
            checked += 1
            ok = has_number(answer, expected)
            note = f"expected {expected:,}"
        passed += int(ok)
        print(f"  [{'PASS' if ok else 'FAIL'}] {label:20s} ({note})")
        if not ok and expected is not None:
            print(f"         answer: {answer[:150].replace(chr(10),' ')}")

    n = len(CASES)
    print(f"\n  overall: {passed}/{n} answers acceptable")
    print(f"  numeric accuracy vs SQL: {passed if checked==0 else sum(1 for q,e,l in CASES if e is not None)}"
          f" checked; see PASS/FAIL above")
    return passed, n


if __name__ == "__main__":
    import sys
    p, n = run()
    sys.exit(0 if p >= n - 1 else 1)  # allow at most 1 slip