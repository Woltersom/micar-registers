/* ESMA MiCAR Register Tracker — shared front-end logic.
 * No build step, no framework: plain fetch() over the data/*.json files that
 * scraper/fetch_esma.py maintains, rendered with vanilla DOM APIs. UI text
 * comes from assets/js/i18n.js's t() helper, which MUST be loaded first.
 */

// EL ("Griekenland"/"Greece" in older EU documents) has no matching flag emoji
// code point - alias to GR. This is a flag-rendering detail, not a language
// string, so it stays here rather than in the i18n dictionary.
const FLAG_ALIAS = { EL: "GR" };

function countryName(code) {
  if (!code) return "—";
  const c = code.trim().toUpperCase();
  const name = t(`countries.${c}`);
  return name === `countries.${c}` ? c : `${name} (${c})`;
}

function flagEmoji(code) {
  if (!code) return "";
  let cc = code.trim().toUpperCase();
  cc = FLAG_ALIAS[cc] || cc;
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

// Compact "flag + code" cell with the full country name as a hover tooltip.
function countryCell(code) {
  if (!code) return "—";
  const flag = flagEmoji(code);
  return `<span class="flag-cell" title="${escapeHtml(countryName(code))}">${flag ? `<span class="flag-cell__emoji">${flag}</span> ` : ""}${escapeHtml(code.toUpperCase())}</span>`;
}

// ESMA's "Competent Authority" field is a long official name, usually ending
// in a parenthesised abbreviation, e.g. "Austrian Financial Market Authority
// (FMA)". Show just the abbreviation, full name on hover.
function shortAuthority(name) {
  if (!name) return "—";
  const m = /\(([^()]+)\)\s*$/.exec(name.trim());
  return m ? m[1].trim() : name.trim();
}

// No icon/logo next to the authority name (decided against both the real
// scraped logos and the monogram badge that preceded them) — just the short
// code (bracketed abbreviation from ESMA's data, e.g. FMA/BaFin/AFM) with the
// full official name available on hover.
function authorityCell(name) {
  if (!name) return "—";
  const short = shortAuthority(name);
  return short === name.trim() ? escapeHtml(name) : `<span title="${escapeHtml(name)}">${escapeHtml(short)}</span>`;
}

function shortDomain(url) {
  if (!url) return null;
  const clean = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].split("?")[0];
  return clean || null;
}

function websiteCell(url) {
  if (!url) return "—";
  const domain = shortDomain(url);
  const clean = url.trim();
  const href = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(domain || clean)}</a>`;
}

// --------------------------------------------------------------------------
// Small icon helpers for the per-column filter dropdown's option rows — a
// flag for country values, the authority monogram badge for competent-
// authority values, and a colour-coded dot for status values, so the filter
// itself carries the same visual language as the table cells it filters.
// --------------------------------------------------------------------------

function countryFlagIconHtml(code) {
  const flag = flagEmoji(code);
  return flag ? `<span class="dropdown-icon dropdown-icon--flag">${flag}</span>` : "";
}

function statusIconHtml(value) {
  const cls = value === "active" ? "status-dot--active" : value === "withdrawn" ? "status-dot--withdrawn" : "status-dot--unknown";
  return `<span class="status-dot ${cls}"></span>`;
}

function cleanServiceLabel(s) {
  if (!s) return "";
  return s.replace(/^\s*[a-j]\s*[.)]\s*/i, "").trim().replace(/^./, (c) => c.toUpperCase());
}

// ESMA dates are dd/mm/yyyy — parse to a sortable Date, tolerant of blanks.
function parseEsmaDate(s) {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}

function formatTimestamp(iso) {
  if (!iso) return t("misc.unknownValue");
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const locale = getLang() === "en" ? "en-GB" : "nl-NL";
  return d.toLocaleString(locale, {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(t("misc.fetchError", path, res.status));
  return res.json();
}

function statusBadge(status) {
  if (status === "active") return `<span class="badge badge--success">${escapeHtml(t("status.active"))}</span>`;
  if (status === "withdrawn") return `<span class="badge badge--neutral">${escapeHtml(t("status.withdrawn"))}</span>`;
  return `<span class="badge badge--neutral">${escapeHtml(t("status.unknown"))}</span>`;
}

function statusLabel(status) {
  return status === "active" ? t("status.active") : status === "withdrawn" ? t("status.withdrawn") : "—";
}

// Shared by index.html's "recent changes" list and changelog.html's full list.
function changelogTypeLabel(type) {
  return type === "added" ? t("badges.added") : type === "removed" ? t("badges.removed") : t("badges.changed");
}

function changelogBadgeHtml(type) {
  const cls = type === "added" ? "badge--success" : type === "removed" ? "badge--neutral" : "badge--warning";
  return `<span class="badge ${cls}">${escapeHtml(changelogTypeLabel(type))}</span>`;
}

function changelogItemHtml(c) {
  const registerLabel = REGISTERS[c.register]?.shortLabel || c.register;
  return `
    ${changelogBadgeHtml(c.type)}
    <span>${escapeHtml(c.name || `(${t("misc.unknownValue")})`)}</span>
    <span class="register-tag">${escapeHtml(registerLabel)}</span>
    <time>${formatTimestamp(c.timestamp)}</time>
  `;
}

// [registerRank, isNewCaspRank] - lower sorts first. Mirrors
// REGISTER_PRIORITY/_change_priority_key in scraper/fetch_esma.py, which
// ranks the Slack notification's summary the same way: CASPs first (newly
// added ones floated above every other CASP change too), then EMT, ART,
// Whitepapers, Non-compliant last.
function changelogPriorityKey(c) {
  const registerRank = REGISTERS[c.register]?.priority ?? 99;
  const isNewCasp = c.register === "casps" && c.type === "added" ? 0 : 1;
  return [registerRank, isNewCasp];
}

// Newest run first; within the same run (identical timestamp - every change
// in one scrape shares the exact moment the scrape ran), most important
// first. A plain array .reverse() would also invert priority order *within*
// a single run's batch (since it flips everything, not just the run-to-run
// ordering), so this sorts explicitly instead - shared by index.html's
// "recent changes" and changelog.html's full list.
function sortChangelogForDisplay(changelog) {
  return changelog.slice().sort((a, b) => {
    const byTime = new Date(b.timestamp) - new Date(a.timestamp);
    if (byTime !== 0) return byTime;
    const [aRank, aNew] = changelogPriorityKey(a);
    const [bRank, bNew] = changelogPriorityKey(b);
    return aRank !== bRank ? aRank - bRank : aNew - bNew;
  });
}

// Clicking a changelog row opens the same detail overlay a register-table
// row would: "added"/"changed" entries look up the entity's current data
// (lazily fetched + cached per register, see loadRegisterRecords() below) and
// reuse the register's own detail() renderer - a "changed" entry additionally
// passes along its already-computed field-level detail (describe_record_
// change() in fetch_esma.py) so openDetail() can show a "what changed"
// summary on top. "removed" entries have no current record to look up (see
// openRemovedDetail()).
function buildChangelogItem(c) {
  const item = el("div", { class: "changelog-item" }, changelogItemHtml(c));
  if (c.type === "removed") {
    item.classList.add("is-clickable");
    item.addEventListener("click", () => openRemovedDetail(c));
  } else if (c.type === "added" || c.type === "changed") {
    item.classList.add("is-clickable");
    item.addEventListener("click", async () => {
      const records = await loadRegisterRecords(c.register);
      const record = records.find((r) => r.id === c.id);
      if (!record) return; // e.g. added, then removed again since - nothing current to show
      openDetail(REGISTERS[c.register], record, c.type === "changed" ? c.detail : undefined);
    });
  }
  return item;
}

function el(tag, attrs = {}, html) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// --------------------------------------------------------------------------
// Shared popover/dropdown plumbing — used by per-column filters on the
// register pages AND by changelog.html's Register/Type filters, so there's
// one place that knows how to open/close/search a dropdown list.
// --------------------------------------------------------------------------

let popoverCloseWired = false;
function closeAllPopovers(except) {
  document.querySelectorAll(".col-filter-dropdown__list.open, .chip-popover.open").forEach((p) => {
    if (p !== except) p.classList.remove("open");
  });
}
function wireGlobalPopoverClose() {
  if (popoverCloseWired) return;
  popoverCloseWired = true;
  document.addEventListener("click", () => closeAllPopovers());
  // Both panel types are position: fixed, anchored to their trigger button's
  // own on-screen position (see positionFloatingPanel() below) rather than
  // being laid out by their original <th> ancestor - so if the page (or the
  // table's own horizontal scrollbar) scrolls, or the window resizes, while
  // one is open, it needs to be re-measured or it'll visibly drift away from
  // its button. `capture: true` also catches scrolling inside .table-wrap
  // itself, which doesn't bubble as a normal "scroll" event on window/document.
  const repositionOpenPanels = () => {
    document.querySelectorAll(".col-filter-dropdown__list.open, .chip-popover.open").forEach((p) => {
      if (p._anchorEl) positionFloatingPanel(p, p._anchorEl);
    });
  };
  window.addEventListener("scroll", repositionOpenPanels, { capture: true, passive: true });
  window.addEventListener("resize", repositionOpenPanels);
}

// Positions a floating filter panel (a direct <body> child, position: fixed -
// see the "appended to document.body" comments at each call site) from its
// trigger button's current getBoundingClientRect(), instead of the CSS
// `position: absolute; top: calc(100% + 6px)` the panel used to rely on. That
// old approach anchored the panel inside .table-wrap, which needs
// `overflow-x: auto` for horizontal scrolling on narrow screens - and per the
// CSS Overflow spec, a non-"visible" overflow-x forces overflow-y to compute
// as "auto" too (there is no way to keep one axis truly "visible" while the
// other clips), so .table-wrap was always going to clip the panel once a
// filter narrowed the table down to too few rows to contain it. Rendering the
// panel as a <body> child sidesteps that ancestor entirely.
function positionFloatingPanel(panel, anchor) {
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const panelWidth = panel.offsetWidth || 210;
  let left = rect.left;
  if (left + panelWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - panelWidth - 8);
  panel.style.top = `${rect.bottom + gap}px`;
  panel.style.left = `${left}px`;
}

// A single-select dropdown (button + popover list), styled to match the
// site rather than a native <select> — which can only show plain text, so it
// can't carry a flag / authority badge / status colour next to each option.
// Reused for register-table column filters and for changelog.html's filters.
function buildDropdownFilter({ label, options, getValue, getLabel, optionIcon, onChange, searchable = true }) {
  wireGlobalPopoverClose();
  let current = null;
  const wrap = el("div", { class: "col-filter-dropdown" });
  const btn = el("button", { type: "button", class: "col-filter-dropdown__btn" },
    `<span class="col-filter-dropdown__current"></span><svg class="col-filter-dropdown__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`);
  const currentLabel = btn.querySelector(".col-filter-dropdown__current");
  const list = el("div", { class: "col-filter-dropdown__list" });
  // Appended straight to <body> (not to `wrap`/the <th> it visually belongs
  // to) so it's positioned with position: fixed + JS-computed coordinates -
  // see positionFloatingPanel() - instead of being clipped by .table-wrap's
  // overflow once a filter narrows the table down to very few rows.
  list._anchorEl = btn;
  document.body.appendChild(list);

  let searchInput = null;
  if (searchable && options.length > 6) {
    searchInput = el("input", { type: "text", class: "col-filter-dropdown__search", placeholder: t("filters.dropdownSearchPlaceholder") });
    searchInput.addEventListener("click", (e) => e.stopPropagation());
    list.appendChild(searchInput);
  }

  const optionRows = [];
  function addOptionRow(value, displayLabel, iconHtml, isAll) {
    const row = el("div", { class: "col-filter-dropdown__option" },
      `${iconHtml || ""}<span>${escapeHtml(displayLabel)}</span><svg class="col-filter-dropdown__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`);
    row.dataset.searchText = displayLabel.toLowerCase();
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      current = value;
      updateSelected();
      list.classList.remove("open");
      onChange(value);
    });
    optionRows.push({ row, value, isAll: !!isAll });
    list.appendChild(row);
  }
  addOptionRow(null, t("filters.all"), "", true);
  for (const opt of options) {
    addOptionRow(getValue(opt), getLabel(opt), optionIcon ? optionIcon(opt) : "");
  }

  function updateSelected() {
    for (const { row, value } of optionRows) row.classList.toggle("is-selected", value === current);
    if (current === null) {
      currentLabel.innerHTML = escapeHtml(t("filters.allOfLabel", label));
    } else {
      const match = options.find((o) => getValue(o) === current);
      const iconHtml = optionIcon && match ? optionIcon(match) : "";
      currentLabel.innerHTML = `${iconHtml}<span>${escapeHtml(match ? getLabel(match) : current)}</span>`;
    }
    btn.classList.toggle("has-selection", current !== null);
  }
  updateSelected();

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      for (const { row, isAll } of optionRows) {
        if (isAll) continue;
        row.style.display = !term || row.dataset.searchText.includes(term) ? "" : "none";
      }
    });
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !list.classList.contains("open");
    closeAllPopovers();
    if (willOpen) {
      positionFloatingPanel(list, btn);
      list.classList.add("open");
      if (searchInput) {
        searchInput.value = "";
        for (const { row, isAll } of optionRows) if (!isAll) row.style.display = "";
        searchInput.focus();
      }
    }
  });

  wrap.appendChild(btn);
  return { el: wrap, btn, list, reset: () => { current = null; updateSelected(); } };
}

// --------------------------------------------------------------------------
// CASP services (MiCAR Art. 3(1)(16), letters a-j) — a fixed, canonical list.
// ESMA's `ac_serviceCode` field carries these as free-text sentences that
// start with the letter code (e.g. "a. providing custody..."), and — this is
// the quirk that broke the table earlier — sometimes pipe-joins ALL of a
// CASP's services into that single field on one row instead of repeating the
// row per service. We match on the leading letter, not the sentence text, so
// grouping is robust regardless of which shape the source row takes.
// --------------------------------------------------------------------------

function svgIcon(path) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const CASP_SERVICE_ICON_PATHS = {
  a: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  b: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  c: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  d: '<path d="m17 3 4 4-4 4"/><path d="M3 7h18"/><path d="m7 21-4-4 4-4"/><path d="M21 17H3"/>',
  e: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/>',
  f: '<path d="m3 11 18-8-8 18-2-8-8-2Z"/>',
  g: '<circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="m8.1 10.9 7.8-3.8M8.1 13.1l7.8 3.8"/>',
  h: '<path d="M21 11.5a8.4 8.4 0 0 1-4.7 7.6 8.4 8.4 0 0 1-3.8.9h-.5A8.5 8.5 0 0 1 3 11.5 8.5 8.5 0 0 1 11.5 3h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M11.5 8v4l2.5 1.5"/>',
  i: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  j: '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
};

const CASP_SERVICES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((code) => ({
  code,
  label: t(`services.${code}.label`),
  full: t(`services.${code}.full`),
  icon: svgIcon(CASP_SERVICE_ICON_PATHS[code]),
}));
const CASP_SERVICE_BY_CODE = Object.fromEntries(CASP_SERVICES.map((s) => [s.code, s]));

// Most ESMA rows lead each service with its letter code ("a. providing
// custody..."), but some (e.g. real-world entries like "Stratos Europe Ltd")
// omit the letter entirely. Fall back to matching on the official English
// MiCAR service wording so those still resolve to a canonical service. This
// matching is against ESMA's own (English) source text, so it is NOT
// language-dependent — it stays fixed regardless of the site's UI language.
const CASP_SERVICE_KEYWORDS = [
  { code: "a", re: /custody/i },
  { code: "b", re: /trading platform/i },
  { code: "c", re: /exchange of crypto-assets? for funds/i },
  { code: "d", re: /exchange of crypto-assets? for other crypto/i },
  { code: "e", re: /execution of orders/i },
  { code: "f", re: /placing of crypto-assets/i },
  { code: "g", re: /reception and transmission/i },
  { code: "h", re: /advice on crypto-assets/i },
  { code: "i", re: /portfolio management/i },
  { code: "j", re: /transfer services/i },
];

// Most ESMA rows name exactly one service per segment (after splitting on
// "|"), usually with a leading letter prefix ("a. providing custody...") -
// for those, the prefix is authoritative and wins outright, no need to also
// keyword-scan the rest of the sentence. But some real-world rows (e.g.
// "Ronin EM Ltd") write ALL of a CASP's services as a single unprefixed,
// "/"-joined sentence instead of repeating/pipe-joining per service - a
// plain first-match keyword scan would then silently recognise only
// whichever service happened to be mentioned first and drop the rest. So
// without a prefix, this scans for every keyword that appears anywhere in
// the text and returns all of them, not just the first.
function extractServiceCodes(rawPart) {
  const m = /^\s*([a-j])\s*[.)]/i.exec(rawPart || "");
  if (m) return [m[1].toLowerCase()];
  return CASP_SERVICE_KEYWORDS.filter(({ re }) => re.test(rawPart || "")).map(({ code }) => code);
}

// Back-compat single-code accessor - prefer extractServiceCodes().
function extractServiceCode(rawPart) {
  return extractServiceCodes(rawPart)[0] || null;
}

// Splits every service row (defensively re-splitting on "|" in case the row
// bundles several services into one field) and buckets each part into either
// one-or-more known MiCAR service codes or an "unknown" fallback so nothing
// is silently dropped even if ESMA's export doesn't match the expected
// letter-prefix shape.
function expandCaspServiceEntries(services) {
  const known = new Map(); // code -> { countries: Set, comments: Set }
  const unknown = [];
  for (const s of services || []) {
    const parts = (s.service || "").split("|").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const codes = extractServiceCodes(part).filter((code) => CASP_SERVICE_BY_CODE[code]);
      if (codes.length) {
        for (const code of codes) {
          if (!known.has(code)) known.set(code, { countries: new Set(), comments: new Set() });
          const entry = known.get(code);
          (s.countries || []).forEach((c) => entry.countries.add(c));
          if (s.comments) entry.comments.add(s.comments);
        }
      } else if (part) {
        unknown.push({ label: cleanServiceLabel(part), countries: s.countries || [], comments: s.comments });
      }
    }
  }
  return { known, unknown };
}

// Only the services a CASP actually offers get an icon — a dimmed icon for
// each of the other ~9 services just added noise without adding information.
function renderServiceIcons(known) {
  const offered = CASP_SERVICES.filter((svc) => known.has(svc.code));
  if (!offered.length) return "—";
  const icons = offered.map((svc) => `<span class="service-icon is-active" title="${escapeHtml(svc.label)}">${svc.icon}</span>`).join("");
  return `<span class="service-icons">${icons}</span>`;
}

function caspServiceSummary(r) {
  const { known, unknown } = expandCaspServiceEntries(r.services);
  const labels = [...known.keys()].map((code) => CASP_SERVICE_BY_CODE[code].label).concat(unknown.map((u) => u.label));
  return labels.length ? labels.join("; ") : "—";
}

function caspServiceDetailItems(r) {
  const { known, unknown } = expandCaspServiceEntries(r.services);
  const items = CASP_SERVICES.filter((svc) => known.has(svc.code)).map((svc) => {
    const info = known.get(svc.code);
    const countries = [...info.countries];
    const comments = [...info.comments].filter(Boolean);
    return `${svc.icon}<strong>${escapeHtml(svc.label)}</strong> — <span class="detail-service-desc">${escapeHtml(svc.full)}</span>${countries.length ? `<br>${escapeHtml(t("detail.countriesLabel", countries.join(", ")))}` : ""}${comments.length ? `<br><em>${escapeHtml(comments.join(" · "))}</em>` : ""}`;
  });
  const extra = unknown.map((u) => `${escapeHtml(u.label)}${u.countries?.length ? ` — ${u.countries.join(", ")}` : ""}`);
  return [...items, ...extra];
}

// AFM's crypto register only tracks 3 broad authorisation types (no
// per-country nuance like ESMA's authority/country columns) - straightforward
// code -> translated label lookup, same pattern as statusLabel()/countryName().
function authorisationTypeLabel(code) {
  if (!code) return "—";
  return t(`afmAuthType.${code}`) || code;
}

// --------------------------------------------------------------------------
// Register configuration — one entry per data/<key>.json file.
// --------------------------------------------------------------------------

const REGISTERS = {
  casps: {
    label: t("registers.casps.label"),
    shortLabel: t("registers.casps.shortLabel"),
    file: "casps",
    // Importance ranking (lower = more important) for the changelog: CASPs
    // first, then EMT, ART, Whitepapers, Non-compliant - see
    // changelogPriorityKey()/sortChangelogForDisplay() below. Mirrors
    // REGISTER_PRIORITY in scraper/fetch_esma.py, which ranks the Slack
    // notification's summary the same way.
    priority: 0,
    // Unlike the other registers, CASPs blends ESMA's own export with AFM-
    // sourced entities not yet in it (see merge_esma_and_afm_casps() in
    // fetch_esma.py) - the footer's default "Bron: ESMA..." line only tells
    // half the story here, so register.html appends this second source too.
    extraSourceUrl: "https://www.afm.nl/en/sector/registers/vergunningenregisters/cryptopartijen",
    extraSourceLinkText: t("footer.sourceLinkTextAfm"),
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website, r.competent_authority],
    columns: [
      { key: "name", label: t("columns.name"), value: (r) => r.commercial_name || r.name || "—", ellipsis: true },
      { key: "lei", label: t("columns.lei"), value: (r) => r.lei || "—" },
      {
        key: "country", label: t("columns.country"), value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName, optionIcon: countryFlagIconHtml },
      },
      {
        key: "authority", label: t("columns.authority"), value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      {
        key: "services", label: t("columns.services"),
        value: caspServiceSummary,
        render: (r) => renderServiceIcons(expandCaspServiceEntries(r.services).known),
        sortValue: (r) => { const { known, unknown } = expandCaspServiceEntries(r.services); return known.size + unknown.length; },
        filter: {
          type: "chips", options: CASP_SERVICES,
          matchFn: (r, selectedCodes) => {
            const { known } = expandCaspServiceEntries(r.services);
            return selectedCodes.some((code) => known.has(code));
          },
        },
      },
      { key: "website", label: t("columns.website"), value: (r) => r.website || "—", render: (r) => websiteCell(r.website) },
      {
        key: "status", label: t("columns.status"), value: (r) => statusLabel(r.status), render: (r) => statusBadge(r.status),
        filter: { type: "select", valueFn: (r) => r.status, formatFn: statusLabel, optionIcon: statusIconHtml },
      },
    ],
    detail: (r) => detailArticle(r, [
      [t("detail.dataSource"), r.source === "afm" ? t("detail.dataSourceAfm") : t("detail.dataSourceEsma")],
      // Only shown when there actually is a distinct trade name - most CASPs
      // have none, and a "Commercial name: —" row for every single one of
      // those would just be noise. See the #detail-title comment in
      // openDetail() for why the title itself no longer shows this instead.
      ...(r.commercial_name && r.commercial_name !== r.name ? [[t("detail.commercialName"), r.commercial_name]] : []),
      [t("detail.competentAuthority"), r.competent_authority],
      [t("detail.homeMemberState"), countryName(r.home_member_state)],
      [t("detail.lei"), r.lei],
      [t("detail.headOfficeCountry"), countryName(r.head_office_country)],
      [t("detail.address"), r.address],
      [t("detail.website"), linkify(r.website)],
      [t("detail.websitePlatform"), linkify(r.platform_website)],
      [t("detail.authorisationDate"), r.authorisation_date],
      [t("detail.withdrawalDate"), r.withdrawal_date || "—"],
      // AFM-only extras: only meaningful (and only populated) for records
      // still sourced from AFM's own register rather than ESMA's export -
      // see merge_esma_and_afm_casps() in fetch_esma.py.
      ...(r.source === "afm" ? [
        [t("detail.authorisationNumber"), r.authorisation_number || "—"],
        [t("detail.authorisationType"), authorisationTypeLabel(r.authorisation_type)],
        [t("detail.suspensionPeriods"), r.suspension_periods || "—"],
        [t("detail.euPassport"), r.eu_passport_raw || "—"],
        [t("detail.equivalentServices"), r.equivalent_services || "—"],
      ] : []),
    ], t("detail.servicesTitle"), caspServiceDetailItems(r)),
  },

  art: {
    label: t("registers.art.label"),
    shortLabel: t("registers.art.shortLabel"),
    file: "art",
    priority: 2,
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website, r.competent_authority],
    columns: [
      { key: "name", label: t("columns.name"), value: (r) => r.commercial_name || r.name || "—", ellipsis: true },
      { key: "lei", label: t("columns.lei"), value: (r) => r.lei || "—" },
      {
        key: "country", label: t("columns.country"), value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName, optionIcon: countryFlagIconHtml },
      },
      {
        key: "authority", label: t("columns.authority"), value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      { key: "credit_institution", label: t("columns.creditInstitution"), value: (r) => r.credit_institution || "—" },
      {
        key: "whitepapers", label: t("columns.whitepapersCount"),
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
      {
        key: "status", label: t("columns.status"), value: (r) => statusLabel(r.status), render: (r) => statusBadge(r.status),
        filter: { type: "select", valueFn: (r) => r.status, formatFn: statusLabel, optionIcon: statusIconHtml },
      },
    ],
    detail: (r) => detailArticle(r, [
      ...(r.commercial_name && r.commercial_name !== r.name ? [[t("detail.commercialName"), r.commercial_name]] : []),
      [t("detail.competentAuthority"), r.competent_authority],
      [t("detail.homeMemberState"), countryName(r.home_member_state)],
      [t("detail.lei"), r.lei],
      [t("detail.address"), r.address],
      [t("detail.website"), linkify(r.website)],
      [t("detail.creditInstitution"), r.credit_institution || "—"],
      [t("detail.authorisationDate"), r.authorisation_date],
      [t("detail.withdrawalDate"), r.withdrawal_date || "—"],
    ], t("detail.whitepapersTitle"), (r.whitepapers || []).map((w) =>
      `${linkify(w.url)}${w.start_date ? escapeHtml(t("detail.offerStart", w.start_date)) : ""}${w.offer_countries?.length ? `<br>${escapeHtml(t("detail.countriesLabel", w.offer_countries.join(", ")))}` : ""}`
    )),
  },

  emt: {
    label: t("registers.emt.label"),
    shortLabel: t("registers.emt.shortLabel"),
    file: "emt",
    priority: 1,
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website, r.competent_authority],
    columns: [
      { key: "name", label: t("columns.name"), value: (r) => r.commercial_name || r.name || "—", ellipsis: true },
      { key: "lei", label: t("columns.lei"), value: (r) => r.lei || "—" },
      {
        key: "country", label: t("columns.country"), value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName, optionIcon: countryFlagIconHtml },
      },
      {
        key: "authority", label: t("columns.authority"), value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      {
        key: "institution_type", label: t("columns.institutionType"), value: (r) => r.institution_type || "—",
        filter: { type: "select", valueFn: (r) => r.institution_type },
      },
      {
        key: "whitepapers", label: t("columns.whitepapersCount"),
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
      {
        key: "status", label: t("columns.status"), value: (r) => statusLabel(r.status), render: (r) => statusBadge(r.status),
        filter: { type: "select", valueFn: (r) => r.status, formatFn: statusLabel, optionIcon: statusIconHtml },
      },
    ],
    detail: (r) => detailArticle(r, [
      ...(r.commercial_name && r.commercial_name !== r.name ? [[t("detail.commercialName"), r.commercial_name]] : []),
      [t("detail.competentAuthority"), r.competent_authority],
      [t("detail.homeMemberState"), countryName(r.home_member_state)],
      [t("detail.lei"), r.lei],
      [t("detail.address"), r.address],
      [t("detail.website"), linkify(r.website)],
      [t("detail.institutionType"), r.institution_type || "—"],
      [t("detail.exemption484"), r.exemption_48_4 || "—"],
      [t("detail.exemption485"), r.exemption_48_5 || "—"],
      [t("detail.authorisationDate"), r.authorisation_date],
      [t("detail.withdrawalDate"), r.withdrawal_date || "—"],
    ], t("detail.whitepapersTitle"), (r.whitepapers || []).map((w) =>
      `${linkify(w.url)}${w.start_date ? escapeHtml(t("detail.offerStart", w.start_date)) : ""}${w.comments ? `<br><em>${escapeHtml(w.comments)}</em>` : ""}`
    )),
  },

  whitepapers: {
    label: t("registers.whitepapers.label"),
    shortLabel: t("registers.whitepapers.shortLabel"),
    file: "whitepapers",
    priority: 3,
    searchFields: (r) => [r.name, r.lei, r.competent_authority],
    columns: [
      { key: "name", label: t("columns.nameIssuer"), value: (r) => r.name || "—", ellipsis: true },
      { key: "lei", label: t("columns.lei"), value: (r) => r.lei || "—" },
      {
        key: "country", label: t("columns.country"), value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName, optionIcon: countryFlagIconHtml },
      },
      {
        key: "authority", label: t("columns.authority"), value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      {
        key: "casp", label: t("columns.involvedCasp"),
        value: (r) => (r.whitepapers || []).find((w) => w.casp_name)?.casp_name || "—", ellipsis: true,
      },
      {
        key: "whitepapers", label: t("columns.whitepapersCount"),
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
    ],
    detail: (r) => detailArticle(r, [
      [t("detail.competentAuthority"), r.competent_authority],
      [t("detail.homeMemberState"), countryName(r.home_member_state)],
      [t("detail.lei"), r.lei],
    ], t("detail.whitepapersTitle"), (r.whitepapers || []).map((w) =>
      `${linkify(w.url)}${w.casp_name ? escapeHtml(t("detail.viaCasp", w.casp_name)) : ""}${w.offer_countries?.length ? `<br>${escapeHtml(t("detail.countriesLabel", w.offer_countries.join(", ")))}` : ""}${w.comments ? `<br><em>${escapeHtml(w.comments)}</em>` : ""}`
    )),
  },

  non_compliant: {
    label: t("registers.non_compliant.label"),
    shortLabel: t("registers.non_compliant.shortLabel"),
    file: "non_compliant",
    priority: 4,
    searchFields: (r) => [r.name, r.lei, r.website, r.competent_authority],
    columns: [
      { key: "name", label: t("columns.name"), value: (r) => r.name || "—", ellipsis: true },
      {
        key: "country", label: t("columns.country"), value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName, optionIcon: countryFlagIconHtml },
      },
      {
        key: "authority", label: t("columns.authority"), value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      { key: "reason", label: t("columns.reason"), value: (r) => r.reason || "—", ellipsis: true, maxWidth: 280 },
      { key: "decision_date", label: t("columns.decisionDate"), value: (r) => r.decision_date || "—", sortValue: (r) => parseEsmaDate(r.decision_date) },
    ],
    detail: (r) => detailArticle(r, [
      [t("detail.competentAuthority"), r.competent_authority],
      [t("detail.homeMemberState"), countryName(r.home_member_state)],
      [t("detail.lei"), r.lei || "—"],
      [t("detail.website"), linkify(r.website)],
      [t("detail.article17"), r.article_17_infringement || "—"],
      [t("detail.reason"), r.reason || "—"],
      [t("detail.decisionDate"), r.decision_date || "—"],
      [t("detail.comments"), r.comments || "—"],
    ]),
  },
};

function linkify(url) {
  if (!url || url === "—") return "—";
  const clean = url.trim();
  const href = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(clean)}</a>`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function detailArticle(record, fieldPairs, subitemsTitle, subitemsHtml) {
  let html = `<dl>`;
  for (const [label, value] of fieldPairs) {
    html += `<dt>${escapeHtml(label)}</dt><dd>${value || "—"}</dd>`;
  }
  html += `</dl>`;
  if (subitemsTitle && subitemsHtml && subitemsHtml.length) {
    html += `<h3>${escapeHtml(subitemsTitle)} (${subitemsHtml.length})</h3><ul class="subitems">`;
    html += subitemsHtml.map((s) => `<li>${s}</li>`).join("");
    html += `</ul>`;
  }
  return html;
}

// --------------------------------------------------------------------------
// Generic table + filter/search/sort component
// --------------------------------------------------------------------------

// A compact segmented control (same visual pattern as the NL/EN lang-toggle)
// for the fixed set of page-size choices — a native <select> would work too,
// but this stays visually consistent with the rest of the toolbar and needs
// no extra click to see all 3 options.
function buildPageSizeToggle(sizes, current, onChange) {
  const wrap = el("div", { class: "page-size-toggle" });
  wrap.appendChild(el("span", { class: "page-size-toggle__label" }, escapeHtml(t("pagination.perPage"))));
  const buttons = [];
  for (const size of sizes) {
    const btn = el("button", { type: "button", class: "page-size-toggle__btn" + (size === current ? " is-active" : "") }, String(size));
    btn.addEventListener("click", () => {
      if (btn.classList.contains("is-active")) return;
      for (const b of buttons) b.classList.remove("is-active");
      btn.classList.add("is-active");
      onChange(size);
    });
    buttons.push(btn);
    wrap.appendChild(btn);
  }
  return wrap;
}

// Prev/next pager shown below the table, with a "page X of Y" indicator.
function buildPaginationBar(onPrev, onNext) {
  const bar = el("div", { class: "pagination-bar" });
  const prevBtn = el("button", { type: "button", class: "btn pagination-bar__btn" }, escapeHtml(t("pagination.prev")));
  const info = el("span", { class: "pagination-bar__info" });
  const nextBtn = el("button", { type: "button", class: "btn pagination-bar__btn" }, escapeHtml(t("pagination.next")));
  prevBtn.addEventListener("click", onPrev);
  nextBtn.addEventListener("click", onNext);
  bar.appendChild(prevBtn);
  bar.appendChild(info);
  bar.appendChild(nextBtn);
  return { bar, prevBtn, info, nextBtn };
}

const PAGE_SIZES = [10, 25, 50];

function renderRegisterTable(root, config, records) {
  let filtered = records.slice();
  // Default: alphabetical by the same "name" column every register shows
  // first (commercial_name-or-name for CASPs/ART/EMT, name for whitepapers/
  // non-compliant) — every REGISTERS config uses "name" as that column's key.
  let sortKey = "name";
  let sortDir = 1;
  let currentPage = 1;
  let pageSize = PAGE_SIZES[0];
  const activeFilters = {};
  let searchTerm = "";
  const filterResetters = [];

  const toolbar = el("div", { class: "toolbar" });
  const searchInput = el("input", { type: "search", placeholder: t("filters.searchPlaceholder") });
  toolbar.appendChild(searchInput);

  const resetBtn = el("button", { class: "btn btn--reset", type: "button" }, escapeHtml(t("buttons.resetFilters")));
  toolbar.appendChild(resetBtn);

  const exportBtn = el("button", { class: "btn", type: "button" }, escapeHtml(t("buttons.exportCsv")));
  toolbar.appendChild(exportBtn);

  const pageSizeToggle = buildPageSizeToggle(PAGE_SIZES, pageSize, (size) => {
    pageSize = size;
    currentPage = 1;
    renderPage();
  });
  toolbar.appendChild(pageSizeToggle);

  const countLabel = el("span", { class: "toolbar__count" });
  toolbar.appendChild(countLabel);
  root.appendChild(toolbar);

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "data" });
  const thead = el("thead");
  const headRow = el("tr");
  for (const col of config.columns) {
    const th = el("th", { "data-key": col.key }, `${escapeHtml(col.label)} <span class="arrow"></span>`);
    th.addEventListener("click", () => {
      if (sortKey === col.key) sortDir = -sortDir;
      else { sortKey = col.key; sortDir = 1; }
      applyAndRender();
    });
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  // Every column gets its own filter, right below its header: a text input by
  // default, or a select / OR-logic chip popover for columns that declare
  // `filter: {...}`. This replaces the old toolbar-level filters, which only
  // covered a handful of hand-picked columns.
  const filterRow = el("tr", { class: "col-filter-row" });
  for (const col of config.columns) {
    const cell = el("th", { class: "col-filter-cell", "data-key": col.key });
    const fc = col.filter || { type: "text" };

    if (fc.type === "select") {
      activeFilters[col.key] = null;
      // Sort by what's actually shown in the dropdown (the formatted label,
      // e.g. the short "AFM"/"BaFin" authority code), not the raw underlying
      // value — otherwise the on-screen order wouldn't be alphabetical.
      const label = (v) => (fc.formatFn ? fc.formatFn(v) : v);
      const options = [...new Set(records.map((r) => fc.valueFn(r)).filter(Boolean))]
        .sort((a, b) => label(a).localeCompare(label(b)));
      const dropdown = buildDropdownFilter({
        label: col.label,
        options,
        getValue: (o) => o,
        getLabel: (o) => (fc.formatFn ? fc.formatFn(o) : o),
        optionIcon: fc.optionIcon,
        onChange: (value) => { activeFilters[col.key] = value; applyAndRender(); },
      });
      cell.appendChild(dropdown.el);
      filterResetters.push(() => { activeFilters[col.key] = null; dropdown.reset(); });
    } else if (fc.type === "chips") {
      activeFilters[col.key] = [];
      wireGlobalPopoverClose();
      const wrap = el("div", { class: "col-filter-chips" });
      const btn = el("button", { type: "button", class: "col-filter-chips__btn" },
        `<span>${escapeHtml(col.label)}</span><span class="col-filter-chips__count" hidden></span>`);
      const countBadge = btn.querySelector(".col-filter-chips__count");
      const popover = el("div", { class: "chip-popover" });
      // Appended straight to <body>, positioned via positionFloatingPanel() -
      // see the matching comment in buildDropdownFilter() above for why.
      popover._anchorEl = btn;
      document.body.appendChild(popover);
      const clearBtn = el("button", { type: "button", class: "chip-popover__clear" }, escapeHtml(t("filters.clearAll")));
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        activeFilters[col.key] = [];
        updateChipVisual();
        applyAndRender();
      });
      popover.appendChild(clearBtn);
      const chipButtons = [];
      for (const opt of fc.options) {
        const chip = el("button", { type: "button", class: "chip-popover__btn", title: opt.full ? escapeHtml(opt.full) : "" },
          `${opt.icon || ""}<span>${escapeHtml(opt.label)}</span>`);
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          const list = activeFilters[col.key];
          const idx = list.indexOf(opt.code);
          if (idx === -1) list.push(opt.code); else list.splice(idx, 1);
          updateChipVisual();
          applyAndRender();
        });
        chipButtons.push({ chip, code: opt.code });
        popover.appendChild(chip);
      }
      function updateChipVisual() {
        const n = activeFilters[col.key].length;
        btn.classList.toggle("has-selection", n > 0);
        countBadge.hidden = n === 0;
        countBadge.textContent = String(n);
        for (const { chip, code } of chipButtons) chip.classList.toggle("is-active", activeFilters[col.key].includes(code));
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = !popover.classList.contains("open");
        closeAllPopovers();
        if (willOpen) {
          positionFloatingPanel(popover, btn);
          popover.classList.add("open");
        }
      });
      wrap.appendChild(btn);
      cell.appendChild(wrap);
      filterResetters.push(() => { activeFilters[col.key] = []; updateChipVisual(); });
    } else {
      const input = el("input", { type: "text", class: "col-filter-input", placeholder: t("filters.textPlaceholder") });
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("input", () => {
        activeFilters[col.key] = input.value.trim().toLowerCase();
        applyAndRender();
      });
      cell.appendChild(input);
      filterResetters.push(() => { input.value = ""; activeFilters[col.key] = ""; });
    }
    filterRow.appendChild(cell);
  }
  thead.appendChild(filterRow);

  resetBtn.addEventListener("click", () => {
    searchTerm = "";
    searchInput.value = "";
    for (const reset of filterResetters) reset();
    applyAndRender();
  });

  const tbody = el("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  root.appendChild(tableWrap);

  const pagination = buildPaginationBar(
    () => { if (currentPage > 1) { currentPage--; renderPage(); } },
    () => { const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); if (currentPage < totalPages) { currentPage++; renderPage(); } },
  );
  root.appendChild(pagination.bar);

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    applyAndRender();
  });

  function applyAndRender() {
    filtered = records.filter((r) => {
      if (searchTerm) {
        const haystack = (config.searchFields(r) || []).join(" ").toLowerCase();
        if (!haystack.includes(searchTerm)) return false;
      }
      for (const col of config.columns) {
        const fc = col.filter || { type: "text" };
        const active = activeFilters[col.key];
        if (fc.type === "select") {
          if (active && fc.valueFn(r) !== active) return false;
        } else if (fc.type === "chips") {
          if (active && active.length && !fc.matchFn(r, active)) return false;
        } else if (active) {
          const text = String(col.value(r) ?? "").toLowerCase();
          if (!text.includes(active)) return false;
        }
      }
      return true;
    });

    if (sortKey) {
      const col = config.columns.find((c) => c.key === sortKey);
      const getVal = col.sortValue || col.value;
      filtered.sort((a, b) => {
        const va = getVal(a), vb = getVal(b);
        if (va === vb) return 0;
        if (va === null || va === undefined || va === "") return 1;
        if (vb === null || vb === undefined || vb === "") return -1;
        return va > vb ? sortDir : -sortDir;
      });
    }

    for (const th of headRow.children) {
      const arrow = th.querySelector(".arrow");
      arrow.textContent = th.dataset.key === sortKey ? (sortDir === 1 ? "▲" : "▼") : "";
    }

    // A new filter/search/sort result starts back on page 1 — otherwise
    // narrowing a filter could leave you stranded on a now out-of-range page.
    currentPage = 1;
    renderPage();
  }

  // Renders just the current page's rows (+ pagination bar / count label)
  // from the already filtered+sorted `filtered` array — used both by
  // applyAndRender() and by the pager/page-size controls, which don't need
  // to redo the filter/sort work themselves.
  function renderPage() {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    const pageRecords = filtered.slice(start, start + pageSize);

    tbody.innerHTML = "";
    if (!pageRecords.length) {
      const tr = el("tr", { class: "empty-row" });
      // Nobody's CASP/ART/EMT issuer is literally named "to the moon" or "wen
      // lambo" - swap the generic empty-state text for something in on this
      // joke instead of just reporting zero results, for whoever tries it.
      const easterMessage = searchTerm.includes("to the moon") ? t("easterEgg.emptyToTheMoon")
        : searchTerm.includes("wen lambo") ? t("easterEgg.emptyWenLambo")
        : null;
      tr.appendChild(el("td", { colspan: config.columns.length }, escapeHtml(easterMessage || t("table.empty"))));
      tbody.appendChild(tr);
    } else {
      for (const r of pageRecords) {
        const tr = el("tr");
        for (const col of config.columns) {
          const td = el("td");
          if (col.render) {
            td.innerHTML = col.render(r);
          } else if (col.ellipsis) {
            const text = col.value(r);
            const style = col.maxWidth ? ` style="max-width:${col.maxWidth}px"` : "";
            td.innerHTML = `<span class="cell-ellipsis" title="${escapeHtml(text)}"${style}>${escapeHtml(text)}</span>`;
          } else {
            td.innerHTML = escapeHtml(col.value(r));
          }
          tr.appendChild(td);
        }
        tr.addEventListener("click", () => openDetail(config, r));
        tbody.appendChild(tr);
      }
    }
    countLabel.textContent = t("table.count", filtered.length, records.length);

    pagination.info.textContent = t("pagination.pageInfo", currentPage, totalPages);
    pagination.prevBtn.disabled = currentPage <= 1;
    pagination.nextBtn.disabled = currentPage >= totalPages;
    pagination.bar.style.display = totalPages <= 1 ? "none" : "";
  }

  exportBtn.addEventListener("click", () => exportCsv(config, filtered));

  applyAndRender();
}

function exportCsv(config, rows) {
  const headers = config.columns.map((c) => c.label);
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cells = config.columns.map((c) => {
      const v = c.value ? c.value(r) : "";
      return `"${String(v).replace(/"/g, '""')}"`;
    });
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `esma-${config.file}-export.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------------------------------
// Detail overlay
// --------------------------------------------------------------------------

function ensureOverlay() {
  let overlay = document.getElementById("detail-overlay");
  if (overlay) return overlay;
  overlay = el("div", { class: "overlay", id: "detail-overlay" });
  const panel = el("div", { class: "detail" });
  panel.appendChild(el("button", { class: "detail__close", type: "button", "aria-label": t("buttons.close") }, "&times;"));
  panel.appendChild(el("h2", { id: "detail-title" }));
  panel.appendChild(el("div", { class: "detail__meta", id: "detail-meta" }));
  panel.appendChild(el("div", { id: "detail-body" }));
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDetail(); });
  panel.querySelector(".detail__close").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
  return overlay;
}

// `changeLines` (optional) is a changelog entry's already-computed
// describe_record_change() output - when given, a highlighted "what changed"
// summary is shown above the record's regular fields. Used when opening this
// same detail view from a "changed" row in the changelog (see
// buildChangelogItem() below); register.html's own row clicks don't pass it.
// Renders one describe_record_change() item (from scraper/fetch_esma.py) as
// display text in the *viewer's currently selected* language. Generic
// field-diff lines are already plain strings (their raw field names/values
// are language-invariant, so there's nothing to translate) and pass through
// unchanged - same as legacy changelog entries from before this structured
// format existed, which are 100% such strings. Structured service-change
// dicts get expanded here via t(), mirroring format_change_line_nl() in
// fetch_esma.py (which does the same for the Slack notification, always in
// Dutch since Slack has no per-viewer language).
function describeChangeLine(line) {
  if (typeof line === "string") return line;
  // "field_changed" (a list/dict-valued field like "whitepapers" that changed
  // shape - too complex to render as a diff, see describe_record_change() in
  // fetch_esma.py) used to be a pre-baked Dutch string ("whitepapers
  // gewijzigd") that leaked into the English site verbatim. It's now a
  // {kind, field} dict like the service-change kinds below, so it can be
  // rendered in the viewer's own language too.
  if (line.kind === "field_changed") return t("detail.changeDetail.fieldChanged", line.field.replace(/_/g, " "));
  // The record was flagged "changed" but describe_record_change() in
  // fetch_esma.py found nothing worth describing (e.g. ESMA/AFM deduplicating
  // redundant service rows that already resolved to the same effective
  // code -> countries mapping - see that function's own comment) - without
  // this, changeLines would be a non-empty array (so the "Wat is gewijzigd"
  // section still renders) containing only this one line, explaining why.
  if (line.kind === "no_meaningful_change") return t("detail.changeDetail.noMeaningfulChange");
  const label = (CASP_SERVICE_BY_CODE[line.code] || {}).label || line.code;
  switch (line.kind) {
    case "service_added": return t("detail.changeDetail.serviceAdded", label);
    case "service_removed": return t("detail.changeDetail.serviceRemoved", label);
    case "service_countries_added": return t("detail.changeDetail.serviceCountriesAdded", label, line.countries.join(", "));
    case "service_countries_removed": return t("detail.changeDetail.serviceCountriesRemoved", label, line.countries.join(", "));
    default: return label;
  }
}

function openDetail(config, record, changeLines) {
  const overlay = ensureOverlay();
  // The full legal name (record.name) is always ESMA's/AFM's official entity
  // name; commercial_name is an optional shorter trade name some CASPs also
  // register. The title used to prefer the trade name, which could show e.g.
  // "Penning" instead of "Penning Financial Services ApS" - now the legal
  // name leads, with the commercial name (if any) still visible in the body
  // via the "Commercial name" detail field pair (see REGISTERS.casps/art/emt).
  overlay.querySelector("#detail-title").textContent = record.name || record.commercial_name || t("detail.titleFallback");
  overlay.querySelector("#detail-meta").textContent = config.label;
  const changeSummaryHtml = (changeLines && changeLines.length)
    ? `<div class="detail-change-summary"><h3>${escapeHtml(t("detail.whatChanged"))}</h3><ul>${changeLines.map((d) => `<li>${escapeHtml(describeChangeLine(d))}</li>`).join("")}</ul></div>`
    : "";
  overlay.querySelector("#detail-body").innerHTML = changeSummaryHtml + config.detail(record);
  overlay.classList.add("open");
}

// A "removed" changelog entry has no current record left to look up (it's no
// longer in data/<register>.json) - show what we do still know: which
// register it was in, when it was first registered (captured at removal
// time into the changelog entry itself, see REGISTRATION_DATE_FIELD in
// fetch_esma.py - "Onbekend" for whitepapers, which has no suitable date
// field, or for older removals recorded before this was tracked), and when
// it was removed (the entry's own timestamp).
function openRemovedDetail(c) {
  const overlay = ensureOverlay();
  const config = REGISTERS[c.register];
  overlay.querySelector("#detail-title").textContent = c.name || t("detail.titleFallback");
  overlay.querySelector("#detail-meta").textContent = config?.label || c.register;
  overlay.querySelector("#detail-body").innerHTML = detailArticle(c, [
    [t("detail.registeredOn"), c.registered_on || t("misc.unknownValue")],
    [t("detail.removedOn"), formatTimestamp(c.timestamp)],
  ]);
  overlay.classList.add("open");
}

function closeDetail() {
  const overlay = document.getElementById("detail-overlay");
  if (overlay) overlay.classList.remove("open");
}

// --------------------------------------------------------------------------
// Changelog entry -> register detail lookup, with a per-register fetch+cache
// so clicking several changelog items for the same register only fetches
// data/<register>.json once. Caches the in-flight promise (not just the
// resolved value) so near-simultaneous clicks don't trigger duplicate fetches.
// --------------------------------------------------------------------------

const _registerRecordsCache = {};
function loadRegisterRecords(registerKey) {
  if (!_registerRecordsCache[registerKey]) {
    const file = REGISTERS[registerKey]?.file || registerKey;
    _registerRecordsCache[registerKey] = fetchJSON(`data/${file}.json`)
      .then((data) => data.records || [])
      .catch(() => []);
  }
  return _registerRecordsCache[registerKey];
}

// --------------------------------------------------------------------------
// Easter eggs — wired unconditionally at script load, since app.js is loaded
// on every page (index/register/changelog), so these work site-wide with no
// per-page setup call needed. Both listen globally, so they still fire while
// a search/filter input has focus (harmless — neither calls preventDefault).
// --------------------------------------------------------------------------

const KONAMI_SEQUENCE = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
let konamiProgress = 0;

// Launched from the bottom of the viewport up past the top, like fireworks -
// see .btc-firework-piece's keyframes in style.css for the actual motion.
function spawnBitcoinFireworks() {
  const layer = el("div", { class: "btc-firework-layer" });
  for (let i = 0; i < 28; i++) {
    const piece = el("span", { class: "btc-firework-piece" }, "₿");
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.fontSize = `${14 + Math.random() * 18}px`;
    piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3400);
}

function triggerKonamiEasterEgg() {
  // The ↑↓ presses used to enter the code scroll the page like any other
  // arrow-key press would - on a long register table that can easily carry
  // the topnav (and the logo the coin-spin plays on) off-screen by the time
  // the code completes. Scroll back to the top so the spin is actually seen;
  // the fireworks are `position: fixed` so they're visible regardless either way.
  window.scrollTo({ top: 0, behavior: "smooth" });
  const logo = document.querySelector(".topnav__brand svg");
  if (logo) {
    logo.classList.remove("coin-spin"); // restart the animation if triggered twice in a row
    void logo.offsetWidth; // force reflow so re-adding the class restarts the keyframes
    logo.classList.add("coin-spin");
  }
  spawnBitcoinFireworks();
}

document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === KONAMI_SEQUENCE[konamiProgress]) {
    konamiProgress++;
    if (konamiProgress === KONAMI_SEQUENCE.length) {
      konamiProgress = 0;
      triggerKonamiEasterEgg();
    }
  } else {
    konamiProgress = key === KONAMI_SEQUENCE[0] ? 1 : 0;
  }
});

// Typing "satoshi" anywhere on the page reveals the Bitcoin genesis block's
// famous embedded headline — a real (and rather pointed) 12-word newspaper
// quote Satoshi Nakamoto mined into block 0 on 3 January 2009 as a timestamp
// and comment on the financial system Bitcoin was built to route around.
const SATOSHI_WORD = "satoshi";
let satoshiBuffer = "";

function showSatoshiToast() {
  const existing = document.querySelector(".easter-toast");
  if (existing) existing.remove();
  const toast = el("div", { class: "easter-toast" },
    `🥚 <strong>${escapeHtml(t("easterEgg.genesisTitle"))}</strong><br>${escapeHtml(t("easterEgg.genesisQuote"))}`);
  document.body.appendChild(toast);
  // Fall back to running synchronously in environments without rAF (e.g. this
  // project's jsdom test harness) - real browsers always have it, so this is
  // just defensive, not something users will ever notice either way.
  (window.requestAnimationFrame || ((fn) => fn()))(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 350);
  }, 6000);
}

document.addEventListener("keydown", (e) => {
  if (e.key.length !== 1) return;
  satoshiBuffer = (satoshiBuffer + e.key.toLowerCase()).slice(-SATOSHI_WORD.length);
  if (satoshiBuffer === SATOSHI_WORD) {
    satoshiBuffer = "";
    showSatoshiToast();
  }
});

// --------------------------------------------------------------------------
// Shared page chrome
// --------------------------------------------------------------------------

function highlightNav(current) {
  document.querySelectorAll(".topnav__links a").forEach((a) => {
    if (a.dataset.nav === current) a.classList.add("active");
  });
}

// --------------------------------------------------------------------------
// Light/dark theme toggle (☀️/🌙) - every fresh visit starts from the OS/
// browser's prefers-color-scheme setting; picking a theme overrides that for
// the rest of the browsing session only (sessionStorage, not localStorage),
// so the next time someone visits, it again starts from whatever the system
// says. The actual re-theming is pure CSS (see :root[data-theme="dark"] in
// style.css) - this just decides which value that attribute should have and
// keeps it in sync with system-setting changes for as long as nothing has
// been explicitly picked yet this session.
//
// The very first paint is handled by a tiny inline script in each page's
// <head> (before this file loads) that mirrors resolveTheme()'s logic, so the
// page never flashes the wrong theme while waiting for app.js to arrive.
// --------------------------------------------------------------------------

const THEME_KEY = "esma-tracker-theme";
const darkSchemeQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

// This session's explicit choice, or null if nothing's been picked yet (i.e.
// still following the system setting).
function getThemeOverride() {
  try {
    const stored = sessionStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch (e) { /* sessionStorage unavailable (e.g. private browsing) */ }
  return null;
}

function setThemeOverride(mode) {
  try { sessionStorage.setItem(THEME_KEY, mode); } catch (e) { /* ignore */ }
  applyTheme();
}

function systemPrefersDark() {
  return !!(darkSchemeQuery && darkSchemeQuery.matches);
}

// The concrete "light"/"dark" outcome, given this session's override (if any)
// and the current system setting.
function resolveTheme() {
  return getThemeOverride() || (systemPrefersDark() ? "dark" : "light");
}

function applyTheme() {
  const theme = resolveTheme();
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

applyTheme();
// Keep following the system live for as long as nothing's been explicitly
// picked this session: if the OS setting flips while this tab is open,
// follow it immediately rather than only picking it up on the next reload.
if (darkSchemeQuery) {
  const onSystemChange = () => { if (!getThemeOverride()) applyTheme(); };
  if (darkSchemeQuery.addEventListener) darkSchemeQuery.addEventListener("change", onSystemChange);
  else if (darkSchemeQuery.addListener) darkSchemeQuery.addListener(onSystemChange); // older Safari
}

// Single round icon button, not a two-option toggle: it always shows the
// *current* resolved theme's icon (☀️ while light, 🌙 while dark), and a
// click just flips to the other theme - no segmented pill, no two buttons
// sitting side by side. Switching theme is a pure CSS variable swap - no
// page reload needed, so a click just re-paints this one button in place.
function renderThemeToggle(container) {
  const btn = el("button", { type: "button", class: "theme-toggle" });
  const paint = () => {
    const current = resolveTheme();
    btn.textContent = current === "dark" ? "🌙" : "☀️";
    // Label/title describe the action a click performs (switch to the OTHER
    // theme), not the icon currently shown - the standard pattern for a
    // single toggle button, so screen readers announce what will happen.
    const label = current === "dark" ? t("theme.switchToLight") : t("theme.switchToDark");
    btn.title = label;
    btn.setAttribute("aria-label", label);
  };
  btn.addEventListener("click", () => {
    setThemeOverride(resolveTheme() === "dark" ? "light" : "dark");
    paint();
  });
  paint();
  container.appendChild(btn);
  return btn;
}
