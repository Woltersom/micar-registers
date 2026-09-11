// Node/jsdom smoke test for assets/js/app.js — exercises real rendering code
// (table build, sort, filter, search, detail panel, chip filters) against
// real ESMA-derived fixture data, without needing a live browser.
import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "http://localhost/register.html?type=casps", runScripts: "dangerously" });
const { window } = dom;
global.window = window;
global.document = window.document;

// i18n.js MUST load before app.js — app.js calls t()/getLang() while building
// CASP_SERVICES and REGISTERS at parse time.
const i18nJs = fs.readFileSync(new URL("../assets/js/i18n.js", import.meta.url), "utf-8");
const i18nScriptEl = window.document.createElement("script");
i18nScriptEl.textContent = i18nJs;
window.document.body.appendChild(i18nScriptEl);

const appJs = fs.readFileSync(new URL("../assets/js/app.js", import.meta.url), "utf-8");
const scriptEl = window.document.createElement("script");
scriptEl.textContent = appJs;
window.document.body.appendChild(scriptEl);

// const/let declarations in a classic <script> don't attach to `window` - bridge
// them explicitly so this harness (running as a separate ES module) can reach them.
const bridge = window.document.createElement("script");
bridge.textContent = "window.__b = { REGISTERS, renderRegisterTable, openDetail, cleanServiceLabel, expandCaspServiceEntries, CASP_SERVICES, extractServiceCode, extractServiceCodes, countryName, parseEsmaDate, t, getLang, setLang, buildDropdownFilter, authorityCell, shortAuthority, statusLabel, changelogTypeLabel, changelogItemHtml, authorisationTypeLabel };";
window.document.body.appendChild(bridge);

const {
  REGISTERS, renderRegisterTable, openDetail, cleanServiceLabel, expandCaspServiceEntries, CASP_SERVICES,
  extractServiceCode, extractServiceCodes, countryName, parseEsmaDate, t, getLang, setLang, buildDropdownFilter, authorityCell,
  shortAuthority, statusLabel, changelogTypeLabel, changelogItemHtml, authorisationTypeLabel,
} = window.__b;

let failures = 0;
function check(label, cond) {
  console.log(`[${cond ? "OK  " : "FAIL"}] ${label}`);
  if (!cond) failures++;
}

// .col-filter-dropdown__list and .chip-popover panels are appended straight
// to <body> (position: fixed, positioned via positionFloatingPanel() in
// app.js) rather than nested inside their trigger's <th>/wrap, specifically
// so a filter that narrows the table to very few rows can't clip them - see
// the "Appended straight to <body>" comments in buildDropdownFilter() and the
// chip-filter block in app.js. Each panel carries a `_anchorEl` back-reference
// to its trigger button, which this helper uses to find the right one among
// however many of that selector exist on the page.
const panelForBtn = (btn, selector) => [...document.querySelectorAll(selector)].find((p) => p._anchorEl === btn);

// --- i18n ---
check("Default language is Dutch (no localStorage value set)", getLang() === "nl");
check("t() resolves a nested NL string", t("columns.name") === "Naam");
check("t() falls back to the raw key when a path doesn't exist", t("nonexistent.path") === "nonexistent.path");
check("t() resolves a templated (function-valued) string with args", t("table.count", 3, 10) === "3 van 10 records");
check("CASP_SERVICES labels are sourced from the i18n dictionary", CASP_SERVICES[0].label === t("services.a.label") && CASP_SERVICES[0].label === "Bewaring");

// --- pure helpers ---
check("cleanServiceLabel strips letter prefix", cleanServiceLabel("a. providing custody and administration of crypto-assets on behalf of clients") === "Providing custody and administration of crypto-assets on behalf of clients");
check("countryName maps NL", countryName("NL").includes("Nederland"));
check("parseEsmaDate parses dd/mm/yyyy", parseEsmaDate("18/04/2025").getUTCFullYear() === 2025);
check("parseEsmaDate handles blank", parseEsmaDate("") === null);
check("CASP_SERVICES has all 10 canonical MiCAR services (a-j)", CASP_SERVICES.length === 10);
check("extractServiceCode reads the leading letter", extractServiceCode("a. providing custody and administration of crypto-assets on behalf of clients") === "a");
check("extractServiceCode falls back to keyword match when no letter prefix", extractServiceCode("exchange of crypto-assets for funds") === "c");
check("extractServiceCode returns null for unrecognisable text", extractServiceCode("something completely unrelated") === null);

// Real-world case (Ronin EM Ltd): one unprefixed "/"-joined sentence naming
// several services at once, instead of a per-service prefixed/piped row. A
// naive first-match keyword scan would silently recognise only one of them
// and drop the rest — extractServiceCodes() must return all of them.
const roninStyleText = "Reception and transmission of orders in relation to one or more crypto-assets / Execution of orders for crypto-assets on behalf of clients / Providing custody and administration of crypto-assets on behalf of clients / Providing transfer services for crypto-assets on behalf of clients";
check("extractServiceCodes finds every matching service in an unprefixed multi-service blob", JSON.stringify(extractServiceCodes(roninStyleText)) === JSON.stringify(["a", "e", "g", "j"]));
check("extractServiceCode (back-compat wrapper) still returns just one code for the same blob", extractServiceCode(roninStyleText) === "a");
check("extractServiceCodes still returns a single-element array for a letter-prefixed row (prefix wins outright)", JSON.stringify(extractServiceCodes("a. providing custody and administration of crypto-assets on behalf of clients")) === JSON.stringify(["a"]));
check("extractServiceCodes returns an empty array for unrecognisable text", extractServiceCodes("something completely unrelated").length === 0);

{
  const { known, unknown } = expandCaspServiceEntries([{ service: roninStyleText, countries: ["AT"], comments: "" }]);
  check("expandCaspServiceEntries resolves an unprefixed multi-service row to all 4 known codes (not just the first)",
    known.size === 4 && ["a", "e", "g", "j"].every((code) => known.has(code)));
  check("...and leaves nothing bucketed as unknown", unknown.length === 0);
  check("...each resolved code carries the row's country", [...known.values()].every((v) => v.countries.has("AT")));
}

// --- authority cell: plain text only, no logo/monogram icon ---
check("shortAuthority extracts the bracketed code when ESMA's data has one", shortAuthority("Netherlands Authority for the Financial Markets (AFM)") === "AFM");
check("shortAuthority falls back to the full name when there's no bracketed code", shortAuthority("Banco de Portugal") === "Banco de Portugal");
check("authorityCell renders just the short code as plain text, no icon/badge/logo markup",
  authorityCell("Netherlands Authority for the Financial Markets (AFM)").includes(">AFM<") &&
  !authorityCell("Netherlands Authority for the Financial Markets (AFM)").includes("authority-badge") &&
  !authorityCell("Netherlands Authority for the Financial Markets (AFM)").includes("authority-logo") &&
  !authorityCell("Netherlands Authority for the Financial Markets (AFM)").includes("<img"));
check("authorityCell renders the full name as plain text when there's no bracketed code",
  authorityCell("Banco de Portugal") === "Banco de Portugal");

// --- reusable dropdown filter component (used by both register tables and changelog.html) ---
{
  const syntheticOptions = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "Nederland", "Duitsland"];
  let picked;
  const dd = buildDropdownFilter({
    label: "Test", options: syntheticOptions, getValue: (v) => v, getLabel: (v) => v,
    onChange: (v) => { picked = v; },
  });
  window.document.body.appendChild(dd.el);
  // dd.list is appended straight to <body> (not nested inside dd.el) so it can
  // be positioned with position: fixed, clear of .table-wrap's overflow - see
  // positionFloatingPanel()/the "Appended straight to <body>" comments in
  // buildDropdownFilter() in app.js. Look it up via dd.list, not dd.el.
  check("Dropdown search box appears once there are more than 6 options", dd.list.querySelector(".col-filter-dropdown__search") !== null);
  const searchInput = dd.list.querySelector(".col-filter-dropdown__search");
  searchInput.value = "neder";
  searchInput.dispatchEvent(new window.Event("input"));
  const visibleNonAllRows = [...dd.list.querySelectorAll(".col-filter-dropdown__option")].filter((r) => r.textContent.trim() !== "Alle" && r.style.display !== "none");
  check("Typing 'neder' narrows the option list to just Nederland", visibleNonAllRows.length === 1 && visibleNonAllRows[0].textContent.includes("Nederland"));
  const nlRow = [...dd.list.querySelectorAll(".col-filter-dropdown__option")].find((r) => r.textContent.includes("Nederland"));
  nlRow.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Selecting the filtered option calls onChange with the right value", picked === "Nederland");
  check("dd.list was appended to <body>, not nested inside dd.el (needed for position: fixed to escape .table-wrap's overflow)",
        dd.list.parentElement === window.document.body && !dd.el.contains(dd.list));
  dd.el.remove();
  dd.list.remove();
}

// --- render each register with real fixture data ---
for (const key of Object.keys(REGISTERS)) {
  const data = JSON.parse(fs.readFileSync(`/tmp/site_test_data/data/${REGISTERS[key].file}.json`, "utf-8"));
  const root = document.createElement("div");
  document.body.appendChild(root);
  let threw = null;
  try {
    renderRegisterTable(root, REGISTERS[key], data.records);
  } catch (e) {
    threw = e;
  }
  check(`${key}: renderRegisterTable runs without throwing`, !threw);
  if (threw) console.error(threw);

  const rows = root.querySelectorAll("tbody tr");
  check(`${key}: renders ${data.records.length || "0 (empty state)"} row(s)`,
    data.records.length ? rows.length === data.records.length : root.querySelector(".empty-row") !== null);

  // every "Naam"-style column should truncate via .cell-ellipsis, not stretch the table
  const nameCol = REGISTERS[key].columns.find((c) => c.ellipsis);
  if (nameCol && data.records.length) {
    check(`${key}: ellipsis column ("${nameCol.label}") renders a .cell-ellipsis span`, root.querySelector(".cell-ellipsis") !== null);
  }

  if (data.records.length) {
    const target = data.records[0];
    const term = (target.commercial_name || target.name || "").split(" ")[0];
    const search = root.querySelector('input[type="search"]');
    search.value = term;
    search.dispatchEvent(new window.Event("input"));
    const visibleRows = root.querySelectorAll("tbody tr:not(.empty-row)");
    check(`${key}: search for "${term}" narrows results (${visibleRows.length} row(s), was ${data.records.length})`, visibleRows.length >= 1 && visibleRows.length <= data.records.length);
    search.value = "";
    search.dispatchEvent(new window.Event("input"));

    const firstHeader = root.querySelector("thead th");
    let sortThrew = null;
    try {
      firstHeader.dispatchEvent(new window.Event("click", { bubbles: true }));
      firstHeader.dispatchEvent(new window.Event("click", { bubbles: true }));
    } catch (e) { sortThrew = e; }
    check(`${key}: column sort (asc/desc) runs without throwing`, !sortThrew);

    let detailThrew = null;
    try {
      openDetail(REGISTERS[key], target);
    } catch (e) { detailThrew = e; }
    check(`${key}: openDetail runs without throwing`, !detailThrew);
    const overlay = document.getElementById("detail-overlay");
    check(`${key}: detail overlay opens and has content`, overlay && overlay.classList.contains("open") && overlay.querySelector("#detail-body").innerHTML.length > 20);
  }

  // Per-column filters generalise beyond CASPs too: non_compliant's
  // "authority" column shows the shortened name (via shortAuthority) as the
  // dropdown option label, not the raw long ESMA competent-authority string,
  // each row is plain text (no icon/logo), and the options are sorted
  // alphabetically by that displayed short code — not by the underlying raw
  // ESMA string, which would put them in a different order.
  if (key === "non_compliant" && data.records.length) {
    const authorityDropdown = root.querySelector('tr.col-filter-row th.col-filter-cell[data-key="authority"] .col-filter-dropdown');
    check(`${key}: authority column has a dropdown filter`, authorityDropdown !== null);
    if (authorityDropdown) {
      // The option list itself is a <body> child (position: fixed - see the
      // panelForBtn() comment above), not nested inside authorityDropdown.
      const authorityBtn = authorityDropdown.querySelector(".col-filter-dropdown__btn");
      const optionRows = panelForBtn(authorityBtn, ".col-filter-dropdown__list").querySelectorAll(".col-filter-dropdown__option");
      const optionTexts = [...optionRows].map((o) => o.textContent.trim());
      check(`${key}: authority dropdown shows the short "AFM" label, not the full raw name`,
        optionTexts.some((txt) => txt.includes("AFM")) && !optionTexts.some((txt) => txt.includes("Netherlands Authority for the Financial Markets")));
      const afmRow = [...optionRows].find((o) => o.textContent.includes("AFM"));
      check(`${key}: authority dropdown row for AFM has no icon/logo markup, just the text label`,
        afmRow.querySelector(".authority-logo") === null && afmRow.querySelector(".authority-badge") === null && afmRow.querySelector("img") === null);
      // Fixture has AFM (NL), CONSOB (IT) and NBS (SK) — alphabetically by
      // short code that's AFM, CONSOB, NBS, which differs from sorting the
      // raw long names (CONSOB, NBS, AFM), so this actually exercises the fix.
      const realOptionTexts = optionTexts.filter((txt) => txt !== t("filters.all"));
      check(`${key}: authority dropdown is sorted alphabetically by the displayed short code (AFM, CONSOB, NBS)`,
        JSON.stringify(realOptionTexts) === JSON.stringify(["AFM", "CONSOB", "NBS"]));
    }
  }

  // AFM's own crypto register no longer has its own tab/page - AFM-only
  // CASPs (not yet in ESMA's export) are folded straight into casps.json by
  // merge_esma_and_afm_casps() (fetch_esma.py), tagged source: "afm". AFM
  // writes services as "(x) description" (parens, not ESMA's "x. desc") -
  // normalize_afm() rewrites each line to the same "x. desc" shape ESMA's
  // CASPS register uses so the existing CASP_SERVICES icon rendering "just
  // works" with zero JS changes. Confirm that holds for a real AFM-shaped
  // record merged into the casps register, and that the detail view shows
  // AFM-only fields (authorisation number/type, EU-passport, etc.) ONLY for
  // source === "afm" records, never for ESMA-native ones.
  if (key === "casps" && data.records.length) {
    const btcDirect = data.records.find((r) => (r.name || "").includes("BTC Direct"));
    check(`${key}: AFM-merged BTC Direct fixture row is present with source "afm"`, !!btcDirect && btcDirect.source === "afm");
    if (btcDirect) {
      const { known } = expandCaspServiceEntries(btcDirect.services);
      check(`${key}: BTC Direct's AFM services ("(c)...", "(d)...", "(j)...") resolve to codes c/d/j via the CASP_SERVICES machinery`,
        known.has("c") && known.has("d") && known.has("j") && !known.has("a"));
      check(`${key}: authorisationTypeLabel translates AFM's authorisation type`,
        authorisationTypeLabel(btcDirect.authorisation_type) === "Vergunning (art. 63)");

      openDetail(REGISTERS.casps, btcDirect);
      const afmDetailBody = document.getElementById("detail-body").innerHTML;
      check(`${key}: detail view shows "Databron: AFM..." for an AFM-sourced record`, afmDetailBody.includes(t("detail.dataSourceAfm")));
      check(`${key}: detail view shows the AFM-only "Vergunningsnummer" field for an AFM-sourced record`, afmDetailBody.includes(t("detail.authorisationNumber")) && afmDetailBody.includes("41000009"));

      const esmaRecord = data.records.find((r) => r.source === "esma");
      if (esmaRecord) {
        openDetail(REGISTERS.casps, esmaRecord);
        const esmaDetailBody = document.getElementById("detail-body").innerHTML;
        check(`${key}: detail view shows "Databron: ESMA" for an ESMA-native record`, esmaDetailBody.includes(t("detail.dataSourceEsma")));
        check(`${key}: detail view hides the AFM-only "Vergunningsnummer" field for an ESMA-native record`, !esmaDetailBody.includes(t("detail.authorisationNumber")));
      }
    }
  }
}

// --------------------------------------------------------------------------
// CASPs-specific regression checks: the pipe-joined-services-in-one-row bug,
// icons-only-for-offered-services, and the per-column filter row (text,
// select, and the OR-logic chip popover for Diensten).
// --------------------------------------------------------------------------
// These regression checks predate the AFM merge and assert exact counts
// against the 6 ESMA-native CASPs.json fixture rows - filter out the
// AFM-merged BTC Direct row (covered separately above) so they stay decoupled
// from that merge and keep testing the original ESMA-only behaviour untouched.
const caspsData = JSON.parse(fs.readFileSync("/tmp/site_test_data/data/casps.json", "utf-8"));
caspsData.records = caspsData.records.filter((r) => r.source !== "afm");
const caspsRoot = window.document.createElement("div");
window.document.body.appendChild(caspsRoot);
renderRegisterTable(caspsRoot, REGISTERS.casps, caspsData.records);

const bpRow = [...caspsRoot.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Bitpanda"));
const dienstenCell = bpRow.children[4]; // name, lei, country, authority, services
check("Bitpanda's Diensten cell renders as icons, not a text blob", dienstenCell.querySelector(".service-icons") !== null);
const activeIcons = dienstenCell.querySelectorAll(".service-icon.is-active");
check(`Bitpanda has exactly 3 active service icons (a, c, d)`, activeIcons.length === 3);
check("Bitpanda's Diensten cell shows ONLY offered services (no dimmed icons for the other 7)", dienstenCell.querySelectorAll(".service-icon").length === 3);
check("Bitpanda's Diensten cell has no stray pipe characters", !dienstenCell.textContent.includes("|"));

// Stratos Europe Ltd (commercial name "Tradu") is a real-world row whose
// pipe-joined services have NO letter prefixes at all — confirms the keyword
// fallback recovers them anyway.
const stratosRow = [...caspsRoot.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Tradu"));
check("Stratos/Tradu row found in the table", stratosRow !== undefined);
const stratosActive = stratosRow.children[4].querySelectorAll(".service-icon.is-active");
check("Stratos (no letter-prefixed services) still resolves via keyword fallback", stratosActive.length > 0);

// --- Per-column filter row: every column gets its own filter control -----
const filterCells = caspsRoot.querySelectorAll("tr.col-filter-row th.col-filter-cell");
check("Every CASPs column has a filter cell (7 columns)", filterCells.length === REGISTERS.casps.columns.length);

const cellFor = (key) => caspsRoot.querySelector(`tr.col-filter-row th.col-filter-cell[data-key="${key}"]`);
check("Naam column gets a free-text filter input", cellFor("name").querySelector(".col-filter-input") !== null);
check("Land column gets a dropdown filter", cellFor("country").querySelector(".col-filter-dropdown") !== null);
check("Toezichthouder column gets a dropdown filter", cellFor("authority").querySelector(".col-filter-dropdown") !== null);
check("Status column gets a dropdown filter", cellFor("status").querySelector(".col-filter-dropdown") !== null);
check("Diensten column gets a chip-popover filter, not a dropdown", cellFor("services").querySelector(".col-filter-chips") !== null);

// Dropdown option rows carry the branded icon matching their column: a flag
// for Land, and a colour-coded dot for Status.
const countryBtnForIcons = cellFor("country").querySelector(".col-filter-dropdown__btn");
const countryOptionRows = panelForBtn(countryBtnForIcons, ".col-filter-dropdown__list").querySelectorAll(".col-filter-dropdown__option");
const atRow = [...countryOptionRows].find((o) => o.textContent.includes("(AT)"));
check("Land dropdown row for Oostenrijk (AT) shows a flag icon", atRow && atRow.querySelector(".dropdown-icon--flag") !== null);
const statusBtnForIcons = cellFor("status").querySelector(".col-filter-dropdown__btn");
const statusOptionRows = panelForBtn(statusBtnForIcons, ".col-filter-dropdown__list").querySelectorAll(".col-filter-dropdown__option");
const activeStatusRow = [...statusOptionRows].find((o) => o.textContent.trim() === "Actief");
check("Status dropdown row for 'Actief' shows a green status dot", activeStatusRow && activeStatusRow.querySelector(".status-dot--active") !== null);

// Text filter on "Naam": narrows to the matching CASP only.
const nameInput = cellFor("name").querySelector(".col-filter-input");
nameInput.value = "bitpanda";
nameInput.dispatchEvent(new window.Event("input"));
check("Text filter on Naam narrows to exactly Bitpanda", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 1
  && caspsRoot.querySelector("tbody tr").textContent.includes("Bitpanda"));
nameInput.value = "";
nameInput.dispatchEvent(new window.Event("input"));
check("Clearing the Naam filter restores all 6 CASPs", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 6);

// Dropdown filter on "Land": all sample CASPs happen to be NL-free (AT/CY/CZ/DE),
// so filtering on "AT" should narrow to the 3 Austrian entries.
const countryDropdown = cellFor("country").querySelector(".col-filter-dropdown");
const countryBtn = countryDropdown.querySelector(".col-filter-dropdown__btn");
const countryList = panelForBtn(countryBtn, ".col-filter-dropdown__list");
check("Land dropdown is closed by default", !countryList.classList.contains("open"));
countryBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Clicking the Land filter button opens its dropdown", countryList.classList.contains("open"));
const countryRows = countryList.querySelectorAll(".col-filter-dropdown__option");
const atOptionRow = [...countryRows].find((o) => o.textContent.includes("(AT)"));
atOptionRow.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Selecting 'Oostenrijk (AT)' narrows to the 3 Austrian CASPs", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 3);
check("Dropdown closes itself after picking an option", !countryList.classList.contains("open"));
check("Filter button shows the selected flag + country once chosen", countryBtn.classList.contains("has-selection") && countryBtn.querySelector(".dropdown-icon--flag") !== null);
countryBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
const allRow = [...countryList.querySelectorAll(".col-filter-dropdown__option")].find((o) => o.textContent.trim() === "Alle");
allRow.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Picking 'Alle' clears the Land filter (all 6 CASPs shown again)", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 6);

// Chip-popover filter on "Diensten": fixed canonical option set (10 services),
// not derived from the data (which is what caused the earlier combinatorial-
// explosion dropdown bug), combined with OR logic.
const chipsWrap = cellFor("services").querySelector(".col-filter-chips");
const chipsBtn = chipsWrap.querySelector(".col-filter-chips__btn");
const popover = panelForBtn(chipsBtn, ".chip-popover");
check("Diensten popover is closed by default", !popover.classList.contains("open"));
chipsBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Clicking the Diensten filter button opens the popover", popover.classList.contains("open"));
const chipButtons = popover.querySelectorAll(".chip-popover__btn");
check("Diensten popover has exactly 10 chips (the canonical MiCAR services)", chipButtons.length === 10);

// OR logic: selecting two services should show CASPs offering EITHER one, not
// only CASPs offering both. Per the fixture: only Trade Republic Bank offers
// "Orderuitvoering" (e); Bitpanda/Bybit (but not Cryptonow) offer "Wisselen —
// fiat" (c). Selecting both must union these sets, not intersect them.
const countRowsWithName = (root, name) => [...root.querySelectorAll("tbody tr:not(.empty-row)")].filter((tr) => tr.textContent.includes(name)).length;
const executionBtn = [...chipButtons].find((b) => b.textContent.includes("Orderuitvoering"));
const exchangeBtn = [...chipButtons].find((b) => b.textContent.includes("Wisselen — fiat"));
executionBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("After selecting 'Orderuitvoering' only: Trade Republic (has 'e') is shown", countRowsWithName(caspsRoot, "Trade Republic") === 1);
check("After selecting 'Orderuitvoering' only: Bitpanda (no 'e') is hidden", countRowsWithName(caspsRoot, "Bitpanda") === 0);
check("After selecting 'Orderuitvoering' only: exactly 1 CASP matches", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 1);
check("Filter button shows a '1' count badge while a service is selected", chipsBtn.querySelector(".col-filter-chips__count").textContent === "1");
exchangeBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("After adding 'Wisselen — fiat' (OR): Bitpanda (has 'c') now shown too", countRowsWithName(caspsRoot, "Bitpanda") === 1);
check("OR filter still shows Trade Republic (has 'e', not 'c')", countRowsWithName(caspsRoot, "Trade Republic") === 1);
check("OR filter still hides Cryptonow (has neither 'e' nor 'c')", countRowsWithName(caspsRoot, "Cryptonow") === 0);
check("After OR of 2 codes: 3 CASPs match (Trade Republic, Bitpanda, Bybit)", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 3);

// Reset via the popover's "Alles wissen" link.
popover.querySelector(".chip-popover__clear").dispatchEvent(new window.Event("click", { bubbles: true }));
check("'Alles wissen' resets the Diensten filter (all 6 CASPs shown again)", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 6);
check("Filter button count badge is hidden again after reset", chipsBtn.querySelector(".col-filter-chips__count").hidden === true);

// --- "Reset filters" toolbar button clears every active filter at once ---
const searchInputEl = caspsRoot.querySelector('input[type="search"]');
searchInputEl.value = "bit";
searchInputEl.dispatchEvent(new window.Event("input"));
nameInput.value = "bitpanda";
nameInput.dispatchEvent(new window.Event("input"));
countryBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
[...countryList.querySelectorAll(".col-filter-dropdown__option")].find((o) => o.textContent.includes("(AT)")).dispatchEvent(new window.Event("click", { bubbles: true }));
chipsBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
[...popover.querySelectorAll(".chip-popover__btn")].find((b) => b.textContent.includes("Bewaring")).dispatchEvent(new window.Event("click", { bubbles: true }));
check("Sanity: combined text+dropdown+chip filters narrow to just Bitpanda", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 1);

const resetBtn = caspsRoot.querySelector(".btn--reset");
check("Reset filters button renders in the toolbar", resetBtn !== null);
resetBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Reset filters button restores all 6 CASPs", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 6);
check("Reset filters clears the global search box", searchInputEl.value === "");
check("Reset filters clears the Naam text filter", nameInput.value === "");
check("Reset filters clears the Land dropdown back to 'Alle'", !countryBtn.classList.contains("has-selection"));
check("Reset filters clears the Diensten chip selection", chipsBtn.querySelector(".col-filter-chips__count").hidden === true);

// --------------------------------------------------------------------------
// Pagination + default alphabetical sort. Every CSV-derived fixture above
// has under 10 records, so it never forces a second page - use a synthetic
// 23-record set (plain non_compliant-shaped records) instead, big enough to
// actually exercise 10/25/50 page sizes and prev/next boundaries.
// --------------------------------------------------------------------------
{
  const names = [
    "Zeta Trading BV", "Alpha Coin Ltd", "Mango Exchange NV", "Nova Assets GmbH",
    "Delta Wallet SA", "Echo Markets OU", "Foxtrot Finance Oy", "Golf Capital Sarl",
    "Hotel Crypto AB", "India Token AG", "Juliet Ventures BV", "Kilo Exchange Ltd",
    "Lima Assets NV", "Mike Digital GmbH", "November Coin SA", "Oscar Markets OU",
    "Papa Finance Oy", "Quebec Capital Sarl", "Romeo Crypto AB", "Sierra Token AG",
    "Tango Ventures BV", "Uniform Exchange Ltd", "Victor Assets NV",
  ]; // 23 synthetic entities, deliberately unsorted
  const synthRecords = names.map((name, i) => ({
    id: `synthetic-${i}`, name, home_member_state: "NL", competent_authority: "Test Authority (TA)",
    reason: "test", decision_date: null,
  }));
  const sortedNames = names.slice().sort();

  const pagRoot = window.document.createElement("div");
  window.document.body.appendChild(pagRoot);
  renderRegisterTable(pagRoot, REGISTERS.non_compliant, synthRecords);

  const rowNames = () => [...pagRoot.querySelectorAll("tbody tr:not(.empty-row) td:first-child")].map((td) => td.textContent.trim());
  const prevButton = pagRoot.querySelectorAll(".pagination-bar__btn")[0];
  const nextButton = pagRoot.querySelectorAll(".pagination-bar__btn")[1];

  check("Pagination: defaults to 10 rows shown", pagRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 10);
  check("Pagination: default sort is alphabetical by name", JSON.stringify(rowNames()) === JSON.stringify(sortedNames.slice(0, 10)));
  check("Pagination: 'Per pagina' toggle shows 10/25/50 in order",
    [...pagRoot.querySelectorAll(".page-size-toggle__btn")].map((b) => b.textContent).join(",") === "10,25,50");
  check("Pagination: '10' is the active page-size button by default",
    pagRoot.querySelector(".page-size-toggle__btn.is-active").textContent === "10");
  check("Pagination bar is visible when there's more than 1 page (23 records / 10)",
    pagRoot.querySelector(".pagination-bar").style.display !== "none");
  check("Pagination info shows page 1 of 3", pagRoot.querySelector(".pagination-bar__info").textContent === t("pagination.pageInfo", 1, 3));
  check("Prev button is disabled on page 1", prevButton.disabled === true);
  check("Next button is enabled on page 1", nextButton.disabled === false);

  nextButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Clicking 'Volgende' moves to page 2 (next 10 alphabetical names)", JSON.stringify(rowNames()) === JSON.stringify(sortedNames.slice(10, 20)));
  check("Pagination info updates to page 2 of 3", pagRoot.querySelector(".pagination-bar__info").textContent === t("pagination.pageInfo", 2, 3));
  check("Prev button re-enables on page 2", prevButton.disabled === false);

  nextButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Page 3 shows the remaining 3 records", pagRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 3);
  check("Next button disables on the last page", nextButton.disabled === true);

  prevButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  prevButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Prev button navigates back to page 1", JSON.stringify(rowNames()) === JSON.stringify(sortedNames.slice(0, 10)));

  const size25Btn = [...pagRoot.querySelectorAll(".page-size-toggle__btn")].find((b) => b.textContent === "25");
  size25Btn.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Switching to 25 per page shows all 23 records on one page", pagRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 23);
  check("Pagination bar hides itself once everything fits on one page", pagRoot.querySelector(".pagination-bar").style.display === "none");

  const pagSearch = pagRoot.querySelector('input[type="search"]');
  pagSearch.value = "assets";
  pagSearch.dispatchEvent(new window.Event("input"));
  check("A new search filter resets back to page 1", pagRoot.querySelector(".pagination-bar__info").textContent.includes("van 1") || pagRoot.querySelector(".pagination-bar").style.display === "none");

  // "to the moon" / "wen lambo" easter eggs: none of these synthetic names
  // match either phrase, so both searches hit the empty state - which should
  // show the dedicated easter-egg copy instead of the generic empty message.
  pagSearch.value = "to the moon";
  pagSearch.dispatchEvent(new window.Event("input"));
  check("Searching 'to the moon' shows the MiCAR-territorial-scope joke, not the generic empty message",
    pagRoot.querySelector(".empty-row")?.textContent.includes(t("easterEgg.emptyToTheMoon")));
  pagSearch.value = "wen lambo";
  pagSearch.dispatchEvent(new window.Event("input"));
  check("Searching 'wen lambo' shows the Lambo-as-a-Service joke, not the generic empty message",
    pagRoot.querySelector(".empty-row")?.textContent.includes(t("easterEgg.emptyWenLambo")));
  pagSearch.value = "some other term with zero matches";
  pagSearch.dispatchEvent(new window.Event("input"));
  check("An ordinary zero-match search still shows the plain generic empty message",
    pagRoot.querySelector(".empty-row")?.textContent === t("table.empty"));
}

// --------------------------------------------------------------------------
// Easter eggs — Konami code (logo coin-spin + ₿ confetti) and typing
// "satoshi" anywhere (genesis-block toast). Both listeners are wired
// unconditionally at app.js load time (no per-page setup call), so they're
// already active on `document` in this harness.
// --------------------------------------------------------------------------
{
  const press = (key) => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));

  // Fake topnav markup so the Konami handler's `.topnav__brand svg` lookup
  // has something to find, same as the real nav in index/register/changelog.html.
  const fakeNav = window.document.createElement("div");
  fakeNav.className = "topnav__brand";
  fakeNav.innerHTML = `<svg viewBox="0 0 40 48"></svg>`;
  document.body.appendChild(fakeNav);
  const logo = fakeNav.querySelector("svg");

  check("Konami: logo has no coin-spin class before the sequence is entered", !logo.classList.contains("coin-spin"));
  for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) press(key);
  check("Konami: entering the full sequence adds 'coin-spin' to the logo", logo.classList.contains("coin-spin"));
  check("Konami: a firework layer is spawned", document.querySelector(".btc-firework-layer") !== null);
  check("Konami: firework layer has 28 ₿ pieces", document.querySelectorAll(".btc-firework-piece").length === 28);
  document.querySelector(".btc-firework-layer").remove();

  check("Konami: an incomplete/wrong sequence doesn't trigger anything", (() => {
    logo.classList.remove("coin-spin");
    for (const key of ["ArrowUp", "ArrowUp", "ArrowUp"]) press(key); // wrong 3rd key (should be ArrowDown)
    return !logo.classList.contains("coin-spin") && document.querySelector(".btc-firework-layer") === null;
  })());

  check("Satoshi: no toast present before typing the word", document.querySelector(".easter-toast") === null);
  for (const key of ["s", "a", "t", "o", "s", "h", "i"]) press(key);
  const toast = document.querySelector(".easter-toast");
  check("Satoshi: typing 'satoshi' shows a toast", toast !== null);
  check("Satoshi: toast quotes the genesis block headline", toast && toast.textContent.includes("Chancellor on brink of second bailout for banks"));
  if (toast) toast.remove();

  fakeNav.remove();
}

console.log(failures === 0 ? "\nALL SITE TESTS PASSED" : `\n${failures} SITE TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
