#!/usr/bin/env python3
"""
Local test harness for scraper/fetch_esma.py — validates the parsing/grouping/diff
logic against real ESMA CSV excerpts, without making any network calls.

Not part of the shipped repo; lives in test_fixtures/ for one-off local verification.
"""
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scraper"))
FIXTURES = Path(__file__).resolve().parent

import fetch_esma as fe  # noqa: E402

# IMPORTANT: redirect the module's data dirs to a throwaway tmp location so this
# test run never touches the real repo's data/ folder (which should stay pristine
# until the first real GitHub Actions run).
_TMP = Path(tempfile.mkdtemp(prefix="esma-tracker-test-"))
fe.DATA_DIR = _TMP / "data"
fe.HISTORY_DIR = fe.DATA_DIR / "history"

FILES = {
    "OTHER": FIXTURES / "OTHER_sample.csv",
    "ARTZZ": FIXTURES / "ARTZZ_sample.csv",
    "EMTWP": FIXTURES / "EMTWP_sample.csv",
    "CASPS": FIXTURES / "CASPS_sample.csv",
    "NCASP": FIXTURES / "NCASP_sample.csv",
}


def fake_fetcher(register_code: str):
    text = FILES[register_code].read_text(encoding="utf-8")
    return fe.parse_csv_text(text)


def reset_data_dir():
    if fe.DATA_DIR.exists():
        shutil.rmtree(fe.DATA_DIR)


def load(register):
    with (fe.DATA_DIR / f"{register}.json").open(encoding="utf-8") as f:
        return json.load(f)["records"]


def find(records, name):
    matches = [r for r in records if r.get("name") == name]
    assert len(matches) == 1, f"expected exactly one record named {name!r}, found {len(matches)}"
    return matches[0]


def check(label, condition):
    status = "OK  " if condition else "FAIL"
    print(f"[{status}] {label}")
    if not condition:
        global failures
        failures += 1


def read_change_summary(github_output_path: Path) -> list[str]:
    """Parses the change_summary<<EOF ... EOF heredoc block run() writes to
    $GITHUB_OUTPUT (the same format GitHub Actions itself expects) back into
    a plain list of lines, so tests can assert on the actual Slack summary
    ordering rather than just re-deriving it from all_changes directly."""
    text = github_output_path.read_text(encoding="utf-8")
    block = text.split("change_summary<<EOF\n", 1)[1].split("\nEOF\n", 1)[0]
    return block.split("\n")


# Each summary line now reads "<emoji> <name> (<Register label>)[ — detail]"
# (see run()'s github_output block) instead of the old "register: name -> ..."
# prefix - this reverse-lookup lets tests recover the register key from the
# "(Label)" tag without hardcoding the emoji/formatting. No surrounding
# underscores: Slack Workflow Builder doesn't render *bold*/_italic_ markup
# from a webhook variable, so it was dropped from the real output too.
LABEL_TO_REGISTER = {v: k for k, v in fe.REGISTER_LABELS_NL.items()}


def line_register(line: str) -> str | None:
    m = re.search(r"\(([^)]+)\)", line)
    return LABEL_TO_REGISTER.get(m.group(1)) if m else None


failures = 0

print("=== Run 1: first scrape (empty data dir) ===")
reset_data_dir()
github_output_1 = _TMP / "github_output_run1.txt"
os.environ["GITHUB_OUTPUT"] = str(github_output_1)
rc = fe.run(fetcher=fake_fetcher)
check("exit code 0", rc == 0)

casps = load("casps")
emt = load("emt")
whitepapers = load("whitepapers")
ncasp = load("non_compliant")
art = load("art")

bitpanda = find(casps, "Bitpanda GmbH")
check("Bitpanda GmbH: pipe-joined single-row services split into 3 items", len(bitpanda["services"]) == 3)
check("Bitpanda GmbH: each split service is a clean single label (no stray '|')", all("|" not in s["service"] for s in bitpanda["services"]))
check("Bitpanda GmbH status active (no end date)", bitpanda["status"] == "active")

trade_republic = find(casps, "Trade Republic Bank GmbH")
check("Trade Republic Bank grouped to 4 services", len(trade_republic["services"]) == 4)

stratos = find(casps, "Stratos Europe Ltd")
check("Stratos Europe Ltd status withdrawn (has end date)", stratos["status"] == "withdrawn")

check("CASPs: 6 unique entities from 11 sample rows", len(casps) == 6)

allunity = find(emt, "AllUnity GmbH")
check("AllUnity GmbH grouped to 3 whitepapers", len(allunity["whitepapers"]) == 3)

circle = find(emt, "Circle Internet Financial Europe SAS")
check("Circle grouped to 2 whitepapers", len(circle["whitepapers"]) == 2)

quantoz = find(emt, "Quantoz Payments B.V")
check("Quantoz grouped to 3 whitepapers", len(quantoz["whitepapers"]) == 3)

check("ART register empty (0 issuers, matches real state)", len(art) == 0)

crm = find(whitepapers, "Crypto Risk Metrics GmbH")
check("Crypto Risk Metrics GmbH grouped to 5 whitepapers", len(crm["whitepapers"]) == 5)

biogena = find(whitepapers, "Biogena GmbH & Co KG")
check("Biogena whitepaper carries linked CASP name", biogena["whitepapers"][0]["casp_name"] == "Tangany GmbH")

check("NCASP: exact duplicate row (DFG789) deduped", len(ncasp) == 5)
dobibo_entries = [r for r in ncasp if r["name"] == "Dobibo"]
check("NCASP: two distinct Dobibo incidents kept (different decision dates)", len(dobibo_entries) == 2)

meta = json.loads((fe.DATA_DIR / "meta.json").read_text(encoding="utf-8"))
check("meta.json has record_counts for all 5 registers", set(meta["record_counts"]) == set(fe.SOURCES))

changelog = json.loads((fe.DATA_DIR / "history" / "changelog.json").read_text(encoding="utf-8"))
total_records = len(casps) + len(emt) + len(art) + len(whitepapers) + len(ncasp)
added = [c for c in changelog if c["type"] == "added"]
check(f"changelog: {total_records} 'added' entries on first run", len(added) == total_records)

# Slack summary priority ordering: CASPs first, then EMT, ART, Whitepapers,
# Non-compliant last (art has 0 records in the fixture, so no "art:" lines
# appear at all - that's expected, not a gap in the check).
summary_1 = read_change_summary(github_output_1)
register_order_seen = []
for line in summary_1:
    # line_register() returns None for the "... en N andere wijziging(en)"
    # truncation footer (MAX_SUMMARY_LINES cut Run 1's detail lines down to 20) -
    # it carries no "(Label)" tag, so it's simply skipped here.
    reg = line_register(line)
    if reg and reg not in register_order_seen:
        register_order_seen.append(reg)
check("Slack summary: registers appear in priority order (casps, emt, whitepapers, non_compliant - art has 0 records)",
      register_order_seen == ["casps", "emt", "whitepapers", "non_compliant"])
check("Slack summary: all 6 CASPs lines come before the first EMT line",
      summary_1.index(next(l for l in summary_1 if line_register(l) == "emt")) == 6)

print("\n=== Run 2: identical data again (should report zero changes) ===")
rc = fe.run(fetcher=fake_fetcher)
check("exit code 0", rc == 0)
changelog2 = json.loads((fe.DATA_DIR / "history" / "changelog.json").read_text(encoding="utf-8"))
check("changelog unchanged after identical re-run", len(changelog2) == len(changelog))

print("\n=== Run 3: mutate one CASP (new service added) + remove one CASP row + add a brand-new CASP ===")
casps_text = FILES["CASPS"].read_text(encoding="utf-8")
# Give Bitpanda a 4th service line (a change), drop the Cryptonow GmbH row
# entirely (a removal), and add a brand-new CASP (an addition) - all three
# change types within the same register in the same run, so this run also
# tests that a new CASP floats above the *other* CASP changes, not just
# above other registers (which have zero changes this run either way).
mutated = casps_text + (
    'Austrian Financial Market Authority (FMA),AT,Bitpanda GmbH,5493007WZ7IFULIL8G21,AT,Bitpanda,'
    '"Stella-Klein-Löw-Weg 17, 1020 Vienna, Austria",https://www.bitpanda.com,,09/04/2025,,'
    'j. providing transfer services for crypto-assets on behalf of clients,AT|BE|BG,,18/06/2026,\n'
    'Netherlands Authority for the Financial Markets (AFM),NL,NewCryptoCasp B.V.,724500ABCDEFGH12345,NL,NewCryptoCasp,'
    '"Meent 106, 3011 JS Rotterdam",https://newcryptocasp.example,,01/07/2026,,'
    'a. providing custody and administration of crypto-assets on behalf of clients,NL,,01/07/2026,\n'
)
mutated = "\n".join(line for line in mutated.splitlines() if "Cryptonow GmbH" not in line)
mutated_path = FIXTURES / "_CASPS_mutated.csv"
mutated_path.write_text(mutated, encoding="utf-8")


def fake_fetcher_mutated(register_code: str):
    if register_code == "CASPS":
        return fe.parse_csv_text(mutated_path.read_text(encoding="utf-8"))
    return fake_fetcher(register_code)


github_output_3 = _TMP / "github_output_run3.txt"
os.environ["GITHUB_OUTPUT"] = str(github_output_3)
rc = fe.run(fetcher=fake_fetcher_mutated)
check("exit code 0", rc == 0)
changelog3 = json.loads((fe.DATA_DIR / "history" / "changelog.json").read_text(encoding="utf-8"))
new_entries = changelog3[len(changelog2):]
change_types = {(c["type"], c["name"]) for c in new_entries}
check("diff detected Bitpanda GmbH as 'changed'", ("changed", "Bitpanda GmbH") in change_types)
check("diff detected Cryptonow GmbH as 'removed'", ("removed", "Cryptonow GmbH") in change_types)
check("diff detected NewCryptoCasp B.V. as 'added'", ("added", "NewCryptoCasp B.V.") in change_types)
check("exactly 3 changes detected in run 3", len(new_entries) == 3)

# The "removed" entry has no record left in data/casps.json to look its
# registration date up from afterwards - it must be snapshotted into the
# changelog entry itself at the moment of removal (see REGISTRATION_DATE_FIELD
# / registered_on in fetch_esma.py, and openRemovedDetail() in app.js which
# displays it). Cryptonow's ac_authorisationNotificationDate in the CSV
# fixture is 15/10/2025.
cryptonow_entry = next(c for c in new_entries if c["type"] == "removed" and c["name"] == "Cryptonow GmbH")
check("removed Cryptonow GmbH entry captured its registered_on date", cryptonow_entry.get("registered_on") == "15/10/2025")

# describe_service_changes() used to bake ready-made Dutch sentences straight
# into changelog.json (e.g. "Overdracht toegevoegd aan dienstverlening"), so a
# website visitor with English selected would still see Dutch service names
# in the "What changed" panel. It now stores a language-neutral {kind, code}
# dict instead, and Bitpanda gaining service "j" (transfer services) in this
# run's mutated CSV is exactly the case that used to be affected - assert the
# stored changelog entry is structured data, not a pre-baked string, and that
# format_change_line_nl() (used only for the Dutch Slack notification) still
# renders the same Dutch sentence as before from that structured data.
bitpanda_entry = next(c for c in new_entries if c["type"] == "changed" and c["name"] == "Bitpanda GmbH")
check("Bitpanda's service-added change is stored as a structured dict, not a pre-baked Dutch string",
      {"kind": "service_added", "code": "j"} in bitpanda_entry.get("detail", []))
check("format_change_line_nl() renders that structured line as the expected Dutch sentence for Slack",
      fe.format_change_line_nl({"kind": "service_added", "code": "j"}) == "Overdracht toegevoegd aan dienstverlening")
check("format_change_line_nl() passes plain strings (generic field diffs) through unchanged",
      fe.format_change_line_nl("status: active → withdrawn") == "status: active → withdrawn")

# Slack summary priority ordering, this time *within* a single register: the
# brand-new CASP should float above the changed/removed CASPs in the same run.
summary_3 = read_change_summary(github_output_3)
new_casp_idx = next(i for i, l in enumerate(summary_3) if "NewCryptoCasp" in l)
bitpanda_idx = next(i for i, l in enumerate(summary_3) if "Bitpanda" in l)
cryptonow_idx = next(i for i, l in enumerate(summary_3) if "Cryptonow" in l)
check("Slack summary: the brand-new CASP line comes before the changed CASP's lines",
      new_casp_idx < bitpanda_idx)
check("Slack summary: the brand-new CASP line comes before the removed CASP's line",
      new_casp_idx < cryptonow_idx)
check("Slack summary: Bitpanda's line reads as the expected Dutch sentence end-to-end (structured data -> summarize_change_detail -> Slack text)",
      summary_3[bitpanda_idx] == "✏️ Bitpanda GmbH (CASPs) — Overdracht toegevoegd aan dienstverlening")
check("Slack summary: a brand-new CASP has no ' — detail' suffix (nothing to summarize)",
      summary_3[new_casp_idx] == "🆕 NewCryptoCasp B.V. (CASPs)")
check("Slack summary: a removed CASP has no ' — detail' suffix either",
      summary_3[cryptonow_idx] == "❌ Cryptonow GmbH (CASPs)")

print("\n=== summarize_change_detail(): grouping & truncation (option 3 Slack redesign) ===")

many_services_same_country = [
    {"kind": "service_countries_added", "code": c, "countries": ["DK"]}
    for c in ["a", "c", "d", "e", "g", "i", "j"]  # 7 services, same new country
]
check("7 services gaining the same new country collapse to a count, not 7 names",
      fe.summarize_change_detail(many_services_same_country) == "7 diensten nu ook aangeboden in: DK")

few_services_same_country = [
    {"kind": "service_countries_added", "code": c, "countries": ["DK"]}
    for c in ["a", "e"]
]
check("2 services gaining the same new country are named, not collapsed",
      fe.summarize_change_detail(few_services_same_country) == "Bewaring, Orderuitvoering nu ook aangeboden in: DK")

many_countries_one_service = [{
    "kind": "service_countries_added", "code": "a",
    "countries": ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
                  "FR", "GR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV"],
}]
check("20 new countries for one service are truncated to 6 named + a '+N andere' remainder",
      fe.summarize_change_detail(many_countries_one_service) ==
      "Bewaring nu ook aangeboden in: AT, BE, BG, CY, CZ, DE +14 andere")

mixed_and_generic = [
    {"kind": "service_added", "code": "a"},
    {"kind": "service_removed", "code": "b"},
    {"kind": "service_countries_added", "code": "c", "countries": ["DK"]},
    "status: active → withdrawn",
]
check("More than MAX_SEGMENTS distinct aspects on one record get capped with a '+N andere wijziging(en)' remainder",
      fe.summarize_change_detail(mixed_and_generic) ==
      "Bewaring toegevoegd aan dienstverlening; Handelsplatform niet langer aangeboden; "
      "Wisselen — fiat nu ook aangeboden in: DK; +1 andere wijziging(en)")

print("\n=== field_changed: list/dict-valued field diffs (e.g. a register's own 'whitepapers' list changing shape) ===")

old_rec = {"id": "x1", "name": "Test EMT BV", "whitepapers": [{"url": "https://a"}], "status": "active"}
new_rec = {"id": "x1", "name": "Test EMT BV", "whitepapers": [{"url": "https://a"}, {"url": "https://b"}], "status": "active"}
field_changed_detail = fe.describe_record_change(old_rec, new_rec)
check("describe_record_change() marks a list-valued field diff as a structured {kind: field_changed} dict, not a pre-baked Dutch string",
      {"kind": "field_changed", "field": "whitepapers"} in field_changed_detail)
check("format_change_line_nl() renders a field_changed dict as the expected Dutch sentence for Slack",
      fe.format_change_line_nl({"kind": "field_changed", "field": "whitepapers"}) == "whitepapers gewijzigd")
check("format_change_line_nl() replaces underscores in multi-word field names too",
      fe.format_change_line_nl({"kind": "field_changed", "field": "home_member_state"}) == "home member state gewijzigd")
check("summarize_change_detail() renders a lone field_changed dict the same way (not grouped as a service, which would KeyError on a missing 'code')",
      fe.summarize_change_detail([{"kind": "field_changed", "field": "whitepapers"}]) == "whitepapers gewijzigd")
check("summarize_change_detail() mixes a field_changed dict alongside a scalar field-diff string correctly",
      fe.summarize_change_detail([{"kind": "field_changed", "field": "whitepapers"}, "status: active → withdrawn"]) ==
      "whitepapers gewijzigd; status: active → withdrawn")

print("\n=== no_meaningful_change: a record flagged 'changed' with nothing worth describing ===")

# Reproduces a real case (TRIA BRIDGE LIMITED, 2026-09-07): ESMA's own export
# briefly carried duplicate service rows for the same codes - one stale row
# scoped to just the home country, one current row already covering the full
# EU/EEA passport list - and then deduplicated them, dropping the stale rows.
# _index_services_by_code() merges duplicate rows for the same code into one
# countries set regardless, so the *effective* code -> countries mapping
# (and thus describe_service_changes()'s output) is identical before and
# after, even though old.get("services") != new.get("services") as raw lists
# (different item count) - which is exactly what makes diff_records() call
# describe_record_change() in the first place. Every other field is
# identical too, so without a fallback this would return [] entirely.
dedup_old_services = [
    {"service": "a. providing custody and administration of crypto-assets on behalf of clients",
     "countries": ["CY"], "comments": None, "last_update": "15/07/2026"},
    {"service": "a. providing custody and administration of crypto-assets on behalf of clients",
     "countries": ["AT", "CY", "DE"], "comments": None, "last_update": "31/07/2026"},
]
dedup_new_services = [
    {"service": "a. providing custody and administration of crypto-assets on behalf of clients",
     "countries": ["AT", "CY", "DE"], "comments": None, "last_update": "31/07/2026"},
]
dedup_old_rec = {"id": "y1", "name": "Test CASP Ltd", "services": dedup_old_services, "status": "active"}
dedup_new_rec = {"id": "y1", "name": "Test CASP Ltd", "services": dedup_new_services, "status": "active"}
check("Sanity check: the raw records are NOT equal (stale duplicate row dropped)",
      dedup_old_rec != dedup_new_rec)
no_meaningful_detail = fe.describe_record_change(dedup_old_rec, dedup_new_rec)
check("describe_record_change() never returns an empty list - falls back to a 'no_meaningful_change' marker",
      no_meaningful_detail == [{"kind": "no_meaningful_change"}])
check("format_change_line_nl() renders that marker as the expected Dutch explanation for Slack",
      fe.format_change_line_nl({"kind": "no_meaningful_change"}) ==
      "alleen technische opschoning in brondata, geen inhoudelijke wijziging")
check("summarize_change_detail() renders a lone no_meaningful_change marker the same way (not grouped as a "
      "service, which would KeyError on a missing 'code')",
      fe.summarize_change_detail([{"kind": "no_meaningful_change"}]) ==
      "alleen technische opschoning in brondata, geen inhoudelijke wijziging")

print("\n=== clean_lei(): normalising malformed LEI values so identity/matching is stable across runs ===")

check("A clean 20-char LEI passes through unchanged (just uppercased)",
      fe.clean_lei("89450036uw3id72t1m84") == "89450036UW3ID72T1M84")
check("A trailing period (real-world 'Ramp Swaps (Ireland) Limited' case) is stripped and the LEI validates",
      fe.clean_lei("89450036UW3ID72T1M84.") == "89450036UW3ID72T1M84")
check("Surrounding whitespace is stripped",
      fe.clean_lei("  89450036UW3ID72T1M84  ") == "89450036UW3ID72T1M84")
check("A 19-char truncated LEI (real-world 'WEB3 Technology B.V.' case) is invalid, not silently kept",
      fe.clean_lei("724500YJVIN0Q94ZZG5") is None)
check("A 21-char LEI (too long) is also invalid",
      fe.clean_lei("89450036UW3ID72T1M845") is None)
check("Empty/None input returns None", fe.clean_lei(None) is None and fe.clean_lei("") is None)

print("\n=== clean_commercial_name(): ESMA's pipe-joined trade-name cells ===")

# Real-world production example: ESMA's ae_commercial_name cell for the
# entity trading as Banxa was "EU Internet Ventures |EUIV|BNXA" (note the
# stray leading space before the first pipe too) - shown verbatim as the
# site's "Handelsnaam" value instead of a clean, readable list of aliases.
check("A pipe-joined multi-alias cell is cleaned into a comma-separated list",
      fe.clean_commercial_name("EU Internet Ventures |EUIV|BNXA") == "EU Internet Ventures, EUIV, BNXA")
check("A single, ordinary commercial name (the common case) passes through unchanged",
      fe.clean_commercial_name("Bitpanda") == "Bitpanda")
check("Empty/None input returns None", fe.clean_commercial_name(None) is None and fe.clean_commercial_name("") is None)

print("\n=== merge_esma_and_afm_casps(): a malformed LEI must not split one real CASP into two rows ===")

# Reproduces the exact production bug: ESMA's own export and AFM's register
# disagree on the LEI's exact formatting for the same real entity (a stray
# trailing period on ESMA's side here) - before clean_lei(), _casps_match_key()
# compared these two strings as different LEIs, so the AFM row wasn't
# recognised as "already covered by ESMA" and was added as a spurious
# duplicate second row with a different competent authority.
esma_ramp_swaps = {
    "id": "esma-id-1", "name": "Ramp Swaps (Ireland) Limited", "lei": "89450036UW3ID72T1M84.",
    "competent_authority": "Central Bank of Ireland (CBI)", "home_member_state": "IE",
    "services": [], "status": "active",
}
afm_ramp_swaps = {
    "id": "afm-id-1", "name": "Ramp Swaps (Ireland) Limited", "lei": "89450036UW3ID72T1M84",
    "home_member_state": "NL", "services": [], "status": "active",
    "commercial_name": None, "address": None, "website": None, "platform_website": None,
    "authorisation_date": None, "withdrawal_date": None, "authorisation_number": None,
    "authorisation_type": None, "suspension_periods": None, "eu_passport_direction": None,
    "eu_passport_countries": [], "eu_passport_raw": None, "equivalent_services": None,
}
merged = fe.merge_esma_and_afm_casps([esma_ramp_swaps], [afm_ramp_swaps], {})
check("A malformed-vs-clean LEI for the same entity merges into exactly 1 row, not 2",
      len(merged) == 1)
check("...and the surviving row is ESMA's own (source: esma), not a duplicate AFM stand-in",
      merged[0]["source"] == "esma" and merged[0]["id"] == "esma-id-1")

# A genuinely truncated LEI on one side (WEB3 Technology-style: 19 chars, not
# a valid LEI at all) can't be "cleaned" back into the real one - clean_lei()
# correctly refuses to guess the missing character and returns None instead,
# so this must fall back to the normalised-name match instead of staying
# unmatched.
esma_web3 = {
    "id": "esma-id-2", "name": "WEB3 Technology B.V.", "lei": "724500YJVIN0Q94ZZG5",  # 19 chars - invalid
    "competent_authority": "Some Other Authority", "home_member_state": "DE",
    "services": [], "status": "active",
}
afm_web3 = {
    "id": "afm-id-2", "name": "WEB3 Technology B.V.", "lei": "724500YJVIN0Q94ZZG58",  # valid 20 chars
    "home_member_state": "NL", "services": [], "status": "active",
    "commercial_name": None, "address": None, "website": None, "platform_website": None,
    "authorisation_date": None, "withdrawal_date": None, "authorisation_number": None,
    "authorisation_type": None, "suspension_periods": None, "eu_passport_direction": None,
    "eu_passport_countries": [], "eu_passport_raw": None, "equivalent_services": None,
}
merged_web3 = fe.merge_esma_and_afm_casps([esma_web3], [afm_web3], {})
check("An invalid (truncated) LEI on one side still merges via the normalised-name fallback, not 2 rows",
      len(merged_web3) == 1)

# id continuity: a record previously tracked (e.g. matched by LEI last run)
# must keep the SAME id even if this run's LEI briefly comes through
# malformed/invalid - _casps_match_keys() always includes a name key
# alongside the LEI key, so previous_by_key still finds it via name even
# though the LEI key alone wouldn't match this run's (invalid) LEI.
previous_tracked = {
    "stable-id-1": {"id": "stable-id-1", "name": "Flaky LEI Co", "lei": "89450036UW3ID72T1M84"},
}
esma_now_bad_lei = [{
    "id": "freshly-computed-id", "name": "Flaky LEI Co", "lei": "89450036UW3ID72T1M8",  # 19 chars - invalid this run
    "competent_authority": "Some Authority", "home_member_state": "DE", "services": [], "status": "active",
}]
# No AFM reading this run either, so there's nothing valid on either side -
# stub gleif_lookup to a no-op (returns None) so this test never makes a real
# network call; id continuity here comes entirely from the name-key fallback
# in previous_by_key, not from whatever the LEI resolves to.
merged_continuity = fe.merge_esma_and_afm_casps(esma_now_bad_lei, [], previous_tracked, gleif_lookup=lambda name, country: None)
check("A record whose LEI is temporarily invalid keeps its previously-tracked id via the name fallback",
      merged_continuity[0]["id"] == "stable-id-1")

print("\n=== _reconcile_lei() / merge_esma_and_afm_casps(gleif_lookup=...): GLEIF-backed LEI reconciliation ===")

# The exact production bug that motivated this feature: ESMA's own export had
# a malformed LEI (one stray extra "0") for EU Internet Ventures B.V., while
# AFM's own register had the correct, valid one for the same entity - before
# this feature, ESMA's (invalid) reading always won once ESMA had its own row
# at all, so the record showed "unknown" even though a usable LEI was sitting
# right there in AFM's data.
esma_bad_afm_good = {
    "id": "esma-id-3", "name": "EU Internet Ventures B.V.", "lei": None,
    "_raw_lei": "69940000HAL9ODW3IMO22",  # 21 chars - invalid
    "competent_authority": "AFM", "home_member_state": "NL", "head_office_country": "NL",
    "services": [], "status": "active",
}
afm_good = {
    "id": "afm-id-3", "name": "EU Internet Ventures B.V.", "lei": "6994000HAL9ODW3IMO22",
    "_raw_lei": "6994000HAL9ODW3IMO22",  # 20 chars - valid
    "home_member_state": "NL", "services": [], "status": "active",
    "commercial_name": None, "address": None, "website": None, "platform_website": None,
    "authorisation_date": None, "withdrawal_date": None, "authorisation_number": None,
    "authorisation_type": None, "suspension_periods": None, "eu_passport_direction": None,
    "eu_passport_countries": [], "eu_passport_raw": None, "equivalent_services": None,
}
merged_lei_fix = fe.merge_esma_and_afm_casps(
    [esma_bad_afm_good], [afm_good], {}, gleif_lookup=lambda name, country: (_ for _ in ()).throw(AssertionError("should not need GLEIF - AFM side already valid"))
)
check("ESMA invalid + AFM valid: the merged record uses AFM's valid LEI instead of showing 'unknown'",
      merged_lei_fix[0]["lei"] == "6994000HAL9ODW3IMO22")
check("The merged record's internal '_raw_lei' scratch field never leaks into the final record",
      "_raw_lei" not in merged_lei_fix[0])

# Mirror case: ESMA's side is fine, AFM's is the malformed one - ESMA should
# win without needing GLEIF either.
esma_good = {
    "id": "esma-id-4", "name": "Mirror Case B.V.", "lei": "5493001KJTIIGC8Y1R12",
    "_raw_lei": "5493001KJTIIGC8Y1R12", "competent_authority": "AFM", "home_member_state": "NL",
    "head_office_country": "NL", "services": [], "status": "active",
}
afm_bad = {
    "id": "afm-id-4", "name": "Mirror Case B.V.", "lei": None,
    "_raw_lei": "5493001KJTIIGC8Y1R12X",  # 21 chars - invalid
    "home_member_state": "NL", "services": [], "status": "active",
    "commercial_name": None, "address": None, "website": None, "platform_website": None,
    "authorisation_date": None, "withdrawal_date": None, "authorisation_number": None,
    "authorisation_type": None, "suspension_periods": None, "eu_passport_direction": None,
    "eu_passport_countries": [], "eu_passport_raw": None, "equivalent_services": None,
}
merged_mirror = fe.merge_esma_and_afm_casps(
    [esma_good], [afm_bad], {}, gleif_lookup=lambda name, country: (_ for _ in ()).throw(AssertionError("should not need GLEIF - ESMA side already valid"))
)
check("ESMA valid + AFM invalid: the merged record keeps ESMA's valid LEI",
      merged_mirror[0]["lei"] == "5493001KJTIIGC8Y1R12")

# Both sides malformed - only GLEIF (by legal name) can resolve this one.
esma_both_bad = {
    "id": "esma-id-5", "name": "Both Sides Broken Ltd", "lei": None,
    "_raw_lei": "5299000WZ7IFULIL8G2",  # 19 chars - invalid
    "competent_authority": "AFM", "home_member_state": "NL", "head_office_country": "NL",
    "services": [], "status": "active",
}
afm_both_bad = {
    "id": "afm-id-5", "name": "Both Sides Broken Ltd", "lei": None,
    "_raw_lei": "5299000WZ7IFULIL8G2..",  # trailing junk, still invalid after cleaning (22 chars)
    "home_member_state": "NL", "services": [], "status": "active",
    "commercial_name": None, "address": None, "website": None, "platform_website": None,
    "authorisation_date": None, "withdrawal_date": None, "authorisation_number": None,
    "authorisation_type": None, "suspension_periods": None, "eu_passport_direction": None,
    "eu_passport_countries": [], "eu_passport_raw": None, "equivalent_services": None,
}
gleif_calls = []
def fake_gleif_found(name, country):
    gleif_calls.append((name, country))
    return "5299000WZ7IFULIL8G21"
merged_both_bad = fe.merge_esma_and_afm_casps([esma_both_bad], [afm_both_bad], {}, gleif_lookup=fake_gleif_found)
check("Both sides malformed: GLEIF is consulted by name and its result is used",
      merged_both_bad[0]["lei"] == "5299000WZ7IFULIL8G21" and gleif_calls == [("Both Sides Broken Ltd", "NL")])

merged_both_bad_no_match = fe.merge_esma_and_afm_casps([esma_both_bad], [afm_both_bad], {}, gleif_lookup=lambda name, country: None)
check("Both sides malformed and GLEIF has no confident match either: falls back to 'unknown' (None), not a guess",
      merged_both_bad_no_match[0]["lei"] is None)

# Both sides individually valid but genuinely disagree (rare) - GLEIF acts as
# tie-breaker; if it picks neither, the existing ESMA-first default applies.
esma_conflict = {
    "id": "esma-id-6", "name": "Conflicting LEI Co", "lei": "AAAAAAAAAAAAAAAAAAAA",
    "_raw_lei": "AAAAAAAAAAAAAAAAAAAA", "competent_authority": "AFM", "home_member_state": "NL",
    "head_office_country": "NL", "services": [], "status": "active",
}
afm_conflict = {
    "id": "afm-id-6", "name": "Conflicting LEI Co", "lei": "BBBBBBBBBBBBBBBBBBBB",
    "_raw_lei": "BBBBBBBBBBBBBBBBBBBB", "home_member_state": "NL", "services": [], "status": "active",
    "commercial_name": None, "address": None, "website": None, "platform_website": None,
    "authorisation_date": None, "withdrawal_date": None, "authorisation_number": None,
    "authorisation_type": None, "suspension_periods": None, "eu_passport_direction": None,
    "eu_passport_countries": [], "eu_passport_raw": None, "equivalent_services": None,
}
merged_conflict_gleif_picks_afm = fe.merge_esma_and_afm_casps(
    [esma_conflict], [afm_conflict], {}, gleif_lookup=lambda name, country: "BBBBBBBBBBBBBBBBBBBB"
)
check("Both valid but disagree: GLEIF's pick (matching AFM's side here) wins as tie-breaker",
      merged_conflict_gleif_picks_afm[0]["lei"] == "BBBBBBBBBBBBBBBBBBBB")

merged_conflict_gleif_undecided = fe.merge_esma_and_afm_casps(
    [esma_conflict], [afm_conflict], {}, gleif_lookup=lambda name, country: None
)
check("Both valid but disagree: if GLEIF can't confirm either, falls back to ESMA's value (unchanged default behaviour)",
      merged_conflict_gleif_undecided[0]["lei"] == "AAAAAAAAAAAAAAAAAAAA")

print(f"\n{'ALL TESTS PASSED' if failures == 0 else f'{failures} TEST(S) FAILED'}")
sys.exit(1 if failures else 0)
