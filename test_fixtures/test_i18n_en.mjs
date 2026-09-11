// Verifies the English translation set actually takes effect end-to-end
// (not just that the dictionary has EN keys) — pre-seed localStorage with
// lang=en before app.js runs, since REGISTERS/CASP_SERVICES are built once
// at load time using whatever getLang() returns at that moment.
import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "http://localhost/register.html?type=casps", runScripts: "dangerously" });
const { window } = dom;
global.window = window;
global.document = window.document;
window.localStorage.setItem("esma-tracker-lang", "en");

for (const rel of ["../assets/js/i18n.js", "../assets/js/app.js"]) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), "utf-8");
  const s = window.document.createElement("script");
  s.textContent = src;
  window.document.body.appendChild(s);
}
const bridge = window.document.createElement("script");
bridge.textContent = "window.__b = { REGISTERS, CASP_SERVICES, countryName, getLang, t, statusBadge, describeChangeLine };";
window.document.body.appendChild(bridge);
const { REGISTERS, CASP_SERVICES, countryName, getLang, t, statusBadge, describeChangeLine } = window.__b;

let failures = 0;
function check(label, cond) {
  console.log(`[${cond ? "OK  " : "FAIL"}] ${label}`);
  if (!cond) failures++;
}

check("getLang() picks up the pre-seeded 'en' value", getLang() === "en");
check("Register labels are in English", REGISTERS.casps.shortLabel === "CASPs" && REGISTERS.art.shortLabel === "ART issuers" && REGISTERS.non_compliant.label === "Non-compliant entities");
check("Column labels are in English", REGISTERS.casps.columns.find((c) => c.key === "name").label === "Name" && REGISTERS.casps.columns.find((c) => c.key === "country").label === "Country");
check("Country names are in English", countryName("NL").includes("Netherlands") && countryName("DE").includes("Germany"));
check("CASP service labels are in English", CASP_SERVICES.find((s) => s.code === "a").label === "Custody");
check("Status badge text is in English", statusBadge("active").includes("Active") && statusBadge("withdrawn").includes("Withdrawn"));
check("t() for filters.searchPlaceholder is in English", t("filters.searchPlaceholder") === "Search by name, LEI, website…");

// Regression check: describe_record_change() in fetch_esma.py used to bake
// ready-made Dutch sentences straight into changelog.json's "detail" field,
// so a changed CASP's "What changed" panel showed Dutch service names (e.g.
// "Wisselen — fiat") even on this English-language page. It now stores
// language-neutral {kind, code, ...} dicts, and describeChangeLine() renders
// them via t()/CASP_SERVICE_BY_CODE - both built in English on this page - so
// the exact same stored data must come out fully in English here.
check("describeChangeLine renders a structured service_added line in English",
  describeChangeLine({ kind: "service_added", code: "a" }) === "Custody added to services offered");
check("describeChangeLine renders a structured service_countries_added line in English",
  describeChangeLine({ kind: "service_countries_added", code: "c", countries: ["DK"] }) === "Exchange — fiat now also offered in: DK");
check("describeChangeLine still passes plain strings through unchanged on this page too",
  describeChangeLine("status: active → withdrawn") === "status: active → withdrawn");

// This is the exact bug a user reported live: a whitepaper's "What changed"
// panel showed the Dutch word "gewijzigd" even with English selected, because
// describe_record_change()'s fallback for list/dict-valued fields (e.g. a
// register's own "whitepapers" list) used to bake a plain Dutch string
// ("whitepapers gewijzigd") straight into changelog.json instead of a
// structured, per-viewer-translatable dict like the service-change kinds.
check("describeChangeLine renders a structured field_changed line in English, not the Dutch 'gewijzigd'",
  describeChangeLine({ kind: "field_changed", field: "whitepapers" }) === "whitepapers changed");

// no_meaningful_change: describe_record_change()'s fallback for a record
// that's flagged "changed" but has nothing else worth describing (e.g. a
// deduplicated service row - see fetch_esma.py's own comment) must also
// render in English here, not the Dutch fallback sentence.
check("describeChangeLine renders the no_meaningful_change marker in English, not the Dutch sentence",
  describeChangeLine({ kind: "no_meaningful_change" }) === "Only a technical clean-up of the source data, no substantive change");

console.log(failures === 0 ? "\nALL EN I18N TESTS PASSED" : `\n${failures} EN I18N TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
