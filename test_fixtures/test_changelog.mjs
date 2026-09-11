// Dry-run test of changelog.html's runtime logic: the 7-day rolling window,
// reverse-chronological order, and the register/type dropdown filters.
// Loads i18n.js + app.js for real, then re-implements changelog.html's init()
// against synthetic fetch() data (real fetch() needs a server; this doesn't).
import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!DOCTYPE html><body><div id='changelog-toolbar'><span id='changelog-count'></span></div><div id='changelog-list'></div></body>", {
  url: "http://localhost/changelog.html", runScripts: "dangerously",
});
const { window } = dom;
global.window = window;
global.document = window.document;

for (const rel of ["../assets/js/i18n.js", "../assets/js/app.js"]) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), "utf-8");
  const s = window.document.createElement("script");
  s.textContent = src;
  window.document.body.appendChild(s);
}
const bridge = window.document.createElement("script");
bridge.textContent = "window.__b = { REGISTERS, buildDropdownFilter, changelogTypeLabel, changelogItemHtml, sortChangelogForDisplay, buildChangelogItem, describeChangeLine, el, t };";
window.document.body.appendChild(bridge);
const { REGISTERS, buildDropdownFilter, changelogTypeLabel, changelogItemHtml, sortChangelogForDisplay, buildChangelogItem, describeChangeLine, el, t } = window.__b;

// buildChangelogItem's click handlers call app.js's own openDetail/openRemovedDetail
// and (for added/changed) loadRegisterRecords() -> fetchJSON() -> fetch() - jsdom has
// no real fetch, so it's stubbed per-test below via window.fetch.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let failures = 0;
function check(label, cond) {
  console.log(`[${cond ? "OK  " : "FAIL"}] ${label}`);
  if (!cond) failures++;
}

const now = Date.now();
const days = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
// changelog.json is append-only, so real data is chronologically ascending
// (oldest first) — the synthetic fixture below mirrors that ordering, since
// the render logic assumes it and reverses to get newest-first.
const synthetic = [
  { type: "added", register: "casps", name: "Old CASP (10 days ago)", timestamp: days(10) },
  { type: "added", register: "art", name: "Boundary ART (7.1 days ago)", timestamp: days(7.1) },
  { type: "changed", register: "emt", name: "Recent EMT (6.9 days ago)", timestamp: days(6.9) },
  { type: "added", register: "casps", name: "Recent CASP (2 days ago)", timestamp: days(2) },
  { type: "removed", register: "non_compliant", name: "Recent NCASP (1 day ago)", timestamp: days(1) },
];
// 5 entries total; 2 fall outside the 7-day window (10d and 7.1d ago), so 3 remain.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const cutoff = now - SEVEN_DAYS_MS;
let changelog = sortChangelogForDisplay(synthetic.filter((c) => new Date(c.timestamp).getTime() >= cutoff));

check("7-day window excludes the 10-day-old entry", !changelog.some((c) => c.name.includes("Old CASP")));
check("7-day window excludes the 7.1-day-old (just past cutoff) entry", !changelog.some((c) => c.name.includes("Boundary ART")));
check("7-day window includes the 6.9-day-old entry (just within cutoff)", changelog.some((c) => c.name.includes("Recent EMT")));
check("7-day window includes the 2-day and 1-day-old entries", changelog.some((c) => c.name.includes("Recent CASP")) && changelog.some((c) => c.name.includes("Recent NCASP")));
check("Reverse-chronological: most recent (1 day ago) entry comes first", changelog[0].name.includes("Recent NCASP"));
check("Reverse-chronological: oldest kept entry (6.9 days ago) comes last", changelog[changelog.length - 1].name.includes("Recent EMT"));

const toolbar = document.getElementById("changelog-toolbar");
const countEl = document.getElementById("changelog-count");
const listEl = document.getElementById("changelog-list");

let registerFilter = null;
let typeFilter = null;
const registerDropdown = buildDropdownFilter({
  label: t("changelogPage.filterRegisterLabel"), options: Object.keys(REGISTERS),
  getValue: (k) => k, getLabel: (k) => REGISTERS[k].shortLabel,
  onChange: (v) => { registerFilter = v; render(); },
});
const typeDropdown = buildDropdownFilter({
  label: t("changelogPage.filterTypeLabel"), options: ["added", "changed", "removed"],
  getValue: (v) => v, getLabel: (v) => changelogTypeLabel(v), searchable: false,
  onChange: (v) => { typeFilter = v; render(); },
});
toolbar.insertBefore(registerDropdown.el, countEl);
toolbar.insertBefore(typeDropdown.el, countEl);

function render() {
  const filtered = changelog.filter((c) => (!registerFilter || c.register === registerFilter) && (!typeFilter || c.type === typeFilter));
  countEl.textContent = t("changelogPage.count", filtered.length);
  listEl.innerHTML = "";
  if (!filtered.length) { listEl.innerHTML = `<p class="filter-note">${t("changelogPage.emptyFiltered")}</p>`; return; }
  for (const c of filtered) listEl.appendChild(buildChangelogItem(c));
}
render();

check("Changelog toolbar has Register + Type dropdowns (not native selects)", toolbar.querySelectorAll(".col-filter-dropdown").length === 2);
check("Count message reflects the 3 in-window entries", countEl.textContent.includes("3"));
check("All 3 in-window items render in the list", listEl.querySelectorAll(".changelog-item").length === 3);

const caspsOption = [...registerDropdown.list.querySelectorAll(".col-filter-dropdown__option")].find((o) => o.textContent.includes("CASPs"));
caspsOption.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Filtering by Register=CASPs narrows to just the 1 in-window CASP entry", listEl.querySelectorAll(".changelog-item").length === 1 && listEl.textContent.includes("Recent CASP"));

const allOption = registerDropdown.list.querySelector(".col-filter-dropdown__option");
allOption.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Resetting Register back to 'Alle' restores all 3 in-window entries", listEl.querySelectorAll(".changelog-item").length === 3);

const removedOption = [...typeDropdown.list.querySelectorAll(".col-filter-dropdown__option")].find((o) => o.textContent === changelogTypeLabel("removed"));
removedOption.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Filtering by Type=removed narrows to just the 1 removed entry", listEl.querySelectorAll(".changelog-item").length === 1 && listEl.textContent.includes("Recent NCASP"));

// --------------------------------------------------------------------------
// Priority ordering: within a single run (identical timestamp), CASPs should
// sort first - a brand-new CASP ahead of every other CASP change too - then
// EMT, ART, Whitepapers, Non-compliant last. Mirrors REGISTER_PRIORITY /
// _change_priority_key in scraper/fetch_esma.py (Slack summary ordering).
// --------------------------------------------------------------------------
{
  const batchTime = days(0.5);
  const batch = [
    { type: "added", register: "non_compliant", name: "Non-compliant Co", timestamp: batchTime },
    { type: "added", register: "whitepapers", name: "Whitepaper Co", timestamp: batchTime },
    { type: "changed", register: "casps", name: "Changed CASP BV", timestamp: batchTime, detail: ["status: actief → ingetrokken"] },
    { type: "added", register: "art", name: "ART Co", timestamp: batchTime },
    { type: "added", register: "emt", name: "EMT Co", timestamp: batchTime },
    { type: "added", register: "casps", name: "Brand New CASP BV", timestamp: batchTime },
  ];
  const sorted = sortChangelogForDisplay(batch);
  check("Priority: a brand-new CASP sorts first, ahead of every other CASP change and register", sorted[0].name === "Brand New CASP BV");
  check("Priority: the rest of CASPs comes right after, still ahead of every other register", sorted[1].name === "Changed CASP BV");
  check("Priority: EMT is next", sorted[2].register === "emt");
  check("Priority: ART is next", sorted[3].register === "art");
  check("Priority: Whitepapers is next", sorted[4].register === "whitepapers");
  check("Priority: Non-compliant is last", sorted[5].register === "non_compliant");
}

// --------------------------------------------------------------------------
// Click-to-detail: added/changed/removed changelog entries all open the same
// overlay register.html's own row clicks use (openDetail() / openRemovedDetail()
// in app.js) - this superseded the old inline expand/chevron mechanism.
// Added/changed entries lazy-fetch the current record by id (fetch stubbed
// below); removed entries render straight from the changelog entry's own
// registered_on/timestamp fields, since no current record exists to look up.
// --------------------------------------------------------------------------
await (async () => {
  const fakeRecords = {
    casps: [{ id: "c1", name: "Detail CASP", commercial_name: "Detail CASP BV" }],
    art: [],
  };
  window.fetch = async (url) => {
    const m = /^data\/(\w+)\.json$/.exec(url);
    const records = (m && fakeRecords[m[1]]) || [];
    return { ok: true, json: async () => ({ records }) };
  };

  const getOverlay = () => document.getElementById("detail-overlay");
  const overlayTitle = () => getOverlay()?.querySelector("#detail-title").textContent;
  const overlayOpen = () => !!getOverlay()?.classList.contains("open");

  const added = buildChangelogItem({ type: "added", register: "casps", id: "c1", name: "Detail CASP", timestamp: days(0.1) });
  check("An added entry is marked clickable", added.classList.contains("is-clickable"));
  added.dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();
  // The overlay title now leads with the full legal name (record.name), not
  // the shorter commercial_name trade name - see the #detail-title comment in
  // openDetail() in app.js for why (was showing e.g. "Penning" instead of
  // "Penning Financial Services ApS"). The commercial name isn't lost, just
  // relocated: it now shows as its own "Commercial name" field in the body.
  check("Clicking an added entry opens the register detail overlay for the matching record, titled with the full legal name",
        overlayOpen() && overlayTitle() === "Detail CASP");
  check("...with the commercial (trade) name still visible in the body, not dropped",
        getOverlay().querySelector("#detail-body").textContent.includes("Detail CASP BV"));
  check("An added entry's overlay has no 'what changed' summary", getOverlay().querySelector(".detail-change-summary") === null);

  const changed = buildChangelogItem({
    type: "changed", register: "casps", id: "c1", name: "Detail CASP", timestamp: days(0.1),
    detail: ["status: actief → ingetrokken", "website: a.nl → b.nl"],
  });
  check("A changed entry is marked clickable", changed.classList.contains("is-clickable"));
  changed.dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();
  const summary = getOverlay().querySelector(".detail-change-summary");
  check("Clicking a changed entry opens the same overlay for the matching record", overlayOpen() && overlayTitle() === "Detail CASP");
  check("...and shows a 'what changed' summary with one <li> per detail line", summary !== null && summary.querySelectorAll("li").length === 2);

  const titleBeforeMiss = overlayTitle();
  const noMatch = buildChangelogItem({ type: "added", register: "art", id: "does-not-exist", name: "Ghost ART Co", timestamp: days(0.1) });
  noMatch.dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();
  check("Clicking an added/changed entry with no matching current record leaves the overlay untouched", overlayTitle() === titleBeforeMiss);

  const removedWithDate = buildChangelogItem({ type: "removed", register: "casps", name: "Gone CASP BV", timestamp: days(0.1), registered_on: "15/10/2025" });
  check("A removed entry is marked clickable", removedWithDate.classList.contains("is-clickable"));
  removedWithDate.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Clicking a removed entry opens the overlay immediately (no fetch needed)", overlayOpen() && overlayTitle() === "Gone CASP BV");
  check("...showing its captured registration date", getOverlay().querySelector("#detail-body").textContent.includes("15/10/2025"));

  const removedNoDate = buildChangelogItem({ type: "removed", register: "casps", name: "Unknown-date CASP BV", timestamp: days(0.1) });
  removedNoDate.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("A removed entry without a captured registration date falls back to the 'unknown' label", getOverlay().querySelector("#detail-body").textContent.includes(t("misc.unknownValue")));
})();

// --------------------------------------------------------------------------
// describeChangeLine(): scraper/fetch_esma.py's describe_record_change() used
// to bake ready-made Dutch sentences (e.g. "Wisselen — fiat nu ook aangeboden
// in: DK") straight into changelog.json, so a visitor with English selected
// would still see Dutch service names inside an otherwise-English "What
// changed" panel. It now stores language-neutral {kind, code, ...} dicts
// instead, and this function renders them via t() in whichever language this
// page loaded in (this file loads with the default NL - see test_i18n_en.mjs
// for the equivalent check on a page loaded in English, since CASP_SERVICES'
// labels - like everything else language-dependent here - are built once at
// load time, not live-reactive to a language change without a page reload;
// see i18n.js's own comment on setLang()). Generic field-diff strings (e.g.
// "status: active -> withdrawn") pass through unchanged, same as legacy
// all-string changelog entries from before this structured format existed.
// --------------------------------------------------------------------------
{
  check("A plain string line (generic field diff, or a legacy pre-refactor entry) passes through unchanged",
    describeChangeLine("status: active → withdrawn") === "status: active → withdrawn");
  check("service_added renders in Dutch on this (default-language) page",
    describeChangeLine({ kind: "service_added", code: "c" }) === "Wisselen — fiat toegevoegd aan dienstverlening");
  check("service_removed renders in Dutch on this (default-language) page",
    describeChangeLine({ kind: "service_removed", code: "c" }) === "Wisselen — fiat niet langer aangeboden");
  check("service_countries_added renders in Dutch on this (default-language) page",
    describeChangeLine({ kind: "service_countries_added", code: "c", countries: ["DK", "NL"] }) === "Wisselen — fiat nu ook aangeboden in: DK, NL");
  check("service_countries_removed renders in Dutch on this (default-language) page",
    describeChangeLine({ kind: "service_countries_removed", code: "c", countries: ["DK"] }) === "Wisselen — fiat niet langer aangeboden in: DK");
  // field_changed (a list/dict-valued field like "whitepapers" that changed
  // shape) used to be baked into changelog.json as a plain Dutch string
  // ("whitepapers gewijzigd") that leaked into English page loads verbatim -
  // see fetch_esma.py's describe_record_change(). It's now a {kind, field}
  // dict rendered via t(), same as the service kinds above.
  check("field_changed renders in Dutch on this (default-language) page",
    describeChangeLine({ kind: "field_changed", field: "whitepapers" }) === "whitepapers gewijzigd");
  check("field_changed replaces underscores in multi-word field names too",
    describeChangeLine({ kind: "field_changed", field: "home_member_state" }) === "home member state gewijzigd");
  // no_meaningful_change: describe_record_change() in fetch_esma.py falls
  // back to this marker when a record is flagged "changed" (raw records
  // genuinely differ) but nothing above found anything worth describing -
  // e.g. ESMA/AFM deduplicating redundant service rows that already resolved
  // to the same effective code -> countries mapping (real case: TRIA BRIDGE
  // LIMITED, 2026-09-07). Without this, changeLines would be an empty array
  // and openDetail()'s "Wat is gewijzigd" section wouldn't render at all.
  check("no_meaningful_change renders as the expected Dutch explanation on this (default-language) page",
    describeChangeLine({ kind: "no_meaningful_change" }) === "Alleen technische opschoning in de brondata, geen inhoudelijke wijziging");

  // ...and the same translation mechanism runs when rendered through the full
  // click-to-detail path, not just describeChangeLine() in isolation.
  const structuredChanged = buildChangelogItem({
    type: "changed", register: "casps", id: "c1", name: "Detail CASP", timestamp: days(0.1),
    detail: [{ kind: "service_added", code: "c" }],
  });
  structuredChanged.dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();
  check("The full changelog-click-to-detail path renders a structured detail line via t(), not a raw object",
    document.getElementById("detail-body").textContent.includes("Wisselen — fiat toegevoegd aan dienstverlening"));
}

console.log(failures === 0 ? "\nALL CHANGELOG TESTS PASSED" : `\n${failures} CHANGELOG TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
