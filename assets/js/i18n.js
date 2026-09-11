/* MiCAR Register Tracker — bilingual (NL/EN) UI text.
 * Loaded BEFORE app.js in every page: app.js and the inline page scripts call
 * t("some.path") to get the current-language string. No build step, no
 * framework — language switching just persists the choice and reloads the
 * page, since none of the pages have reactive state to re-render in place.
 */

const I18N_LANG_KEY = "esma-tracker-lang";

function getLang() {
  try {
    const stored = localStorage.getItem(I18N_LANG_KEY);
    if (stored === "nl" || stored === "en") return stored;
  } catch (e) { /* localStorage unavailable (e.g. private browsing) */ }
  return "nl";
}

function setLang(lang) {
  try { localStorage.setItem(I18N_LANG_KEY, lang); } catch (e) { /* ignore */ }
  location.reload();
}

function resolveI18nPath(obj, path) {
  return path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

// t("nav.dashboard") for plain strings, t("table.count", 3, 10) for entries
// whose dictionary value is a function (templated strings with arguments).
function t(path, ...args) {
  const lang = getLang();
  let val = resolveI18nPath(TRANSLATIONS[lang], path);
  if (val === undefined) val = resolveI18nPath(TRANSLATIONS.nl, path); // fall back to NL, then the raw key
  if (val === undefined) return path;
  return typeof val === "function" ? val(...args) : val;
}

const TRANSLATIONS = {
  nl: {
    nav: {
      dashboard: "Dashboard", casps: "CASPs", art: "ART", emt: "EMT",
      whitepapers: "Whitepapers", non_compliant: "Non-compliant", changelog: "Wijzigingen",
    },
    brand: { title: "MiCAR Register Tracker" },
    dashboard: {
      title: "Dashboard",
      subtitle: "Doorzoekbare spiegel van de 5 officiële MiCAR-registers. Automatisch bijgewerkt.",
      recentChanges: "Recente wijzigingen",
      fullHistoryLink: "Volledige wijzigingsgeschiedenis →",
      noChanges: "Nog geen wijzigingen geregistreerd.",
    },
    registerPage: {
      titleFallback: "Register",
      unknownPrefix: "Onbekend register: ",
      loadError: (msg) => `Kon de data voor dit register nog niet laden. Is de scraper al gedraaid? (${msg})`,
      subtitle: (count, generated) => `${count} record(s) — bron: ESMA, laatst gegenereerd ${generated}.`,
    },
    changelogPage: {
      title: "Wijzigingsgeschiedenis",
      filterRegisterLabel: "Register",
      filterTypeLabel: "Type",
      emptyFiltered: "Geen wijzigingen gevonden voor deze filters.",
      count: (n) => `${n} wijziging${n === 1 ? "" : "en"} in de afgelopen 7 dagen`,
    },
    registers: {
      casps: { label: "Crypto-asset service providers (CASP's)", shortLabel: "CASPs" },
      art: { label: "Uitgevers van asset-referenced tokens (ART)", shortLabel: "ART-uitgevers" },
      emt: { label: "Uitgevers van e-money tokens (EMT)", shortLabel: "EMT-uitgevers" },
      whitepapers: { label: "Whitepapers (overige crypto-assets)", shortLabel: "Whitepapers" },
      non_compliant: { label: "Non-compliant entiteiten", shortLabel: "Non-compliant" },
    },
    columns: {
      name: "Naam", nameIssuer: "Naam issuer/aanbieder", lei: "LEI", country: "Land",
      authority: "Toezichthouder", services: "Diensten", website: "Website", status: "Status",
      creditInstitution: "Kredietinstelling", institutionType: "Type instelling",
      whitepapersCount: "Whitepapers", involvedCasp: "Betrokken CASP", reason: "Reden", decisionDate: "Besluitdatum",
      authorisationNumber: "Vergunningsnummer", authorisationType: "Type vergunning",
    },
    afmAuthType: {
      authorisation: "Vergunning (art. 63)", notification: "Notificatie (art. 60)",
      cross_border: "Cross-border (art. 65)", other: "Overig",
    },
    filters: {
      all: "Alle",
      allOfLabel: (label) => `${label}: alle`,
      searchPlaceholder: "Zoek op naam, LEI, website…",
      textPlaceholder: "Filter…",
      dropdownSearchPlaceholder: "Zoeken…",
      clearAll: "Alles wissen",
    },
    buttons: { resetFilters: "Reset filters", exportCsv: "Exporteer CSV", close: "Sluiten" },
    theme: {
      toggleLabel: "Weergave", light: "Licht", dark: "Donker",
      switchToLight: "Schakel naar lichte modus", switchToDark: "Schakel naar donkere modus",
    },
    status: { active: "Actief", withdrawn: "Ingetrokken", unknown: "Onbekend" },
    table: {
      count: (shown, total) => `${shown} van ${total} records`,
      empty: "Geen records gevonden voor deze zoekopdracht/filters.",
    },
    pagination: {
      perPage: "Per pagina:",
      pageInfo: (page, totalPages) => `Pagina ${page} van ${totalPages}`,
      prev: "‹ Vorige",
      next: "Volgende ›",
    },
    detail: {
      titleFallback: "Details",
      dataSource: "Databron",
      dataSourceEsma: "ESMA",
      dataSourceAfm: "AFM (nog niet in ESMA's eigen register)",
      commercialName: "Handelsnaam",
      whatChanged: "Wat is er gewijzigd",
      changeDetail: {
        serviceAdded: (label) => `${label} toegevoegd aan dienstverlening`,
        serviceRemoved: (label) => `${label} niet langer aangeboden`,
        serviceCountriesAdded: (label, list) => `${label} nu ook aangeboden in: ${list}`,
        serviceCountriesRemoved: (label, list) => `${label} niet langer aangeboden in: ${list}`,
        fieldChanged: (field) => `${field} gewijzigd`,
        // Shown when a record is flagged "changed" but describe_record_change()
        // in fetch_esma.py found nothing worth describing - e.g. ESMA/AFM
        // deduplicating redundant service rows that already resolved to the
        // same effective code -> countries mapping (see that function's own
        // comment). Without this, "Wat is er gewijzigd" would be silently
        // omitted even though the record's badge says "Gewijzigd".
        noMeaningfulChange: "Alleen technische opschoning in de brondata, geen inhoudelijke wijziging",
      },
      registeredOn: "Geregistreerd op",
      removedOn: "Verwijderd op",
      competentAuthority: "Bevoegde autoriteit", homeMemberState: "Lidstaat", lei: "LEI",
      headOfficeCountry: "Land hoofdkantoor", address: "Adres", website: "Website",
      websitePlatform: "Website platform", authorisationDate: "Datum autorisatie", withdrawalDate: "Datum intrekking",
      creditInstitution: "Kredietinstelling", exemption484: "Vrijstelling art. 48(4)", exemption485: "Vrijstelling art. 48(5)",
      institutionType: "Type instelling", reason: "Reden", decisionDate: "Besluitdatum", comments: "Opmerkingen",
      article17: "Artikel 17-inbreuk (ESMA)", servicesTitle: "Diensten", whitepapersTitle: "Whitepapers",
      offerStart: (date) => ` — start aanbieding: ${date}`,
      countriesLabel: (list) => `Landen: ${list}`,
      viaCasp: (name) => ` — via CASP: ${name}`,
      authorisationNumber: "Vergunningsnummer", authorisationType: "Type vergunning",
      suspensionPeriods: "Opschortingsperiodes", euPassport: "EU-paspoort (art. 65 MiCAR)",
      equivalentServices: "Gelijkwaardige dienstverlening",
    },
    services: {
      a: { label: "Bewaring", full: "Bewaring en administratie van crypto-activa namens cliënten" },
      b: { label: "Handelsplatform", full: "Exploiteren van een handelsplatform voor crypto-activa" },
      c: { label: "Wisselen — fiat", full: "Wisselen van crypto-activa voor geld" },
      d: { label: "Wisselen — crypto", full: "Wisselen van crypto-activa voor andere crypto-activa" },
      e: { label: "Orderuitvoering", full: "Uitvoeren van orders voor crypto-activa namens cliënten" },
      f: { label: "Plaatsing", full: "Plaatsen van crypto-activa" },
      g: { label: "Orderdoorgifte", full: "Ontvangen en doorgeven van orders voor crypto-activa namens cliënten" },
      h: { label: "Advies", full: "Advies verlenen over crypto-activa" },
      i: { label: "Vermogensbeheer", full: "Portefeuillebeheer van crypto-activa" },
      j: { label: "Overdracht", full: "Overdrachtsdiensten voor crypto-activa namens cliënten" },
    },
    countries: {
      AT: "Oostenrijk", BE: "België", BG: "Bulgarije", CY: "Cyprus", CZ: "Tsjechië",
      DE: "Duitsland", DK: "Denemarken", EE: "Estland", EL: "Griekenland", GR: "Griekenland",
      ES: "Spanje", FI: "Finland", FR: "Frankrijk", HR: "Kroatië", HU: "Hongarije",
      IE: "Ierland", IS: "IJsland", IT: "Italië", LI: "Liechtenstein", LT: "Litouwen",
      LU: "Luxemburg", LV: "Letland", MT: "Malta", NL: "Nederland", NO: "Noorwegen",
      PL: "Polen", PT: "Portugal", RO: "Roemenië", SE: "Zweden", SI: "Slovenië",
      SK: "Slowakije", GB: "Verenigd Koninkrijk", CH: "Zwitserland",
    },
    footer: {
      lastCheckedLoading: "Laatst gecontroleerd: laden…",
      lastChecked: (ts) => `Laatst gecontroleerd: ${ts}`,
      neverChecked: "Nog geen scrape uitgevoerd — draai de GitHub Actions workflow eenmalig handmatig.",
      neverCheckedShort: "Nog geen scrape uitgevoerd.",
      sourcePrefix: "Bron: ",
      sourceLinkText: "ESMA Interim MiCA Register",
      sourceAnd: " en ",
      sourceLinkTextAfm: "AFM Cryptoregister",
    },
    badges: { added: "Nieuw", changed: "Gewijzigd", removed: "Verwijderd" },
    misc: { unknownValue: "onbekend", fetchError: (path, status) => `Kon ${path} niet laden (${status})` },
    easterEgg: {
      genesisTitle: "Genesisblok, 3 januari 2009:",
      genesisQuote: "\"The Times 03/Jan/2009 Chancellor on brink of second bailout for banks.\"",
      emptyToTheMoon: "Deze bestemming valt buiten het territoriale toepassingsgebied van MiCAR (Verordening (EU) 2023/1114). Voor toezicht op de Maan verwijzen wij u door naar een bevoegde autoriteit die nog moet worden opgericht.",
      emptyWenLambo: "Er is geen entiteit geregistreerd die \"Lambo-as-a-Service\" aanbiedt als dienst in de zin van MiCAR art. 3(1)(16). Cliëntenwens genoteerd; wetgeving volgt (nog) niet.",
    },
  },

  en: {
    nav: {
      dashboard: "Dashboard", casps: "CASPs", art: "ART", emt: "EMT",
      whitepapers: "Whitepapers", non_compliant: "Non-compliant", changelog: "Changes",
    },
    brand: { title: "MiCAR Register Tracker" },
    dashboard: {
      title: "Dashboard",
      subtitle: "Searchable mirror of the 5 official MiCAR registers. Updated automatically.",
      recentChanges: "Recent changes",
      fullHistoryLink: "Full change history →",
      noChanges: "No changes recorded yet.",
    },
    registerPage: {
      titleFallback: "Register",
      unknownPrefix: "Unknown register: ",
      loadError: (msg) => `Could not load data for this register yet. Has the scraper run? (${msg})`,
      subtitle: (count, generated) => `${count} record(s) — source: ESMA, last generated ${generated}.`,
    },
    changelogPage: {
      title: "Change history",
      filterRegisterLabel: "Register",
      filterTypeLabel: "Type",
      emptyFiltered: "No changes found for these filters.",
      count: (n) => `${n} change${n === 1 ? "" : "s"} in the last 7 days`,
    },
    registers: {
      casps: { label: "Crypto-asset service providers (CASPs)", shortLabel: "CASPs" },
      art: { label: "Issuers of asset-referenced tokens (ART)", shortLabel: "ART issuers" },
      emt: { label: "Issuers of e-money tokens (EMT)", shortLabel: "EMT issuers" },
      whitepapers: { label: "Whitepapers (other crypto-assets)", shortLabel: "Whitepapers" },
      non_compliant: { label: "Non-compliant entities", shortLabel: "Non-compliant" },
    },
    columns: {
      name: "Name", nameIssuer: "Issuer/offeror name", lei: "LEI", country: "Country",
      authority: "Supervisor", services: "Services", website: "Website", status: "Status",
      creditInstitution: "Credit institution", institutionType: "Institution type",
      whitepapersCount: "Whitepapers", involvedCasp: "Related CASP", reason: "Reason", decisionDate: "Decision date",
      authorisationNumber: "Authorisation number", authorisationType: "Authorisation type",
    },
    afmAuthType: {
      authorisation: "Authorisation (Art. 63)", notification: "Notification (Art. 60)",
      cross_border: "Cross-border (Art. 65)", other: "Other",
    },
    filters: {
      all: "All",
      allOfLabel: (label) => `${label}: all`,
      searchPlaceholder: "Search by name, LEI, website…",
      textPlaceholder: "Filter…",
      dropdownSearchPlaceholder: "Search…",
      clearAll: "Clear all",
    },
    buttons: { resetFilters: "Reset filters", exportCsv: "Export CSV", close: "Close" },
    theme: {
      toggleLabel: "Appearance", light: "Light", dark: "Dark",
      switchToLight: "Switch to light mode", switchToDark: "Switch to dark mode",
    },
    status: { active: "Active", withdrawn: "Withdrawn", unknown: "Unknown" },
    table: {
      count: (shown, total) => `${shown} of ${total} records`,
      empty: "No records found for this search/filters.",
    },
    pagination: {
      perPage: "Per page:",
      pageInfo: (page, totalPages) => `Page ${page} of ${totalPages}`,
      prev: "‹ Previous",
      next: "Next ›",
    },
    detail: {
      titleFallback: "Details",
      dataSource: "Data source",
      dataSourceEsma: "ESMA",
      dataSourceAfm: "AFM (not yet in ESMA's own register)",
      commercialName: "Commercial name",
      whatChanged: "What changed",
      changeDetail: {
        serviceAdded: (label) => `${label} added to services offered`,
        serviceRemoved: (label) => `${label} no longer offered`,
        serviceCountriesAdded: (label, list) => `${label} now also offered in: ${list}`,
        serviceCountriesRemoved: (label, list) => `${label} no longer offered in: ${list}`,
        fieldChanged: (field) => `${field} changed`,
        noMeaningfulChange: "Only a technical clean-up of the source data, no substantive change",
      },
      registeredOn: "Registered on",
      removedOn: "Removed on",
      competentAuthority: "Competent authority", homeMemberState: "Home member state", lei: "LEI",
      headOfficeCountry: "Head office country", address: "Address", website: "Website",
      websitePlatform: "Platform website", authorisationDate: "Authorisation date", withdrawalDate: "Withdrawal date",
      creditInstitution: "Credit institution", exemption484: "Exemption Art. 48(4)", exemption485: "Exemption Art. 48(5)",
      institutionType: "Institution type", reason: "Reason", decisionDate: "Decision date", comments: "Comments",
      article17: "Article 17 infringement (ESMA)", servicesTitle: "Services", whitepapersTitle: "Whitepapers",
      offerStart: (date) => ` — offer start date: ${date}`,
      countriesLabel: (list) => `Countries: ${list}`,
      viaCasp: (name) => ` — via CASP: ${name}`,
      authorisationNumber: "Authorisation number", authorisationType: "Authorisation type",
      suspensionPeriods: "Suspension periods", euPassport: "EU passport (Art. 65 MiCAR)",
      equivalentServices: "Equivalent services",
    },
    services: {
      a: { label: "Custody", full: "Custody and administration of crypto-assets on behalf of clients" },
      b: { label: "Trading platform", full: "Operation of a trading platform for crypto-assets" },
      c: { label: "Exchange — fiat", full: "Exchange of crypto-assets for funds" },
      d: { label: "Exchange — crypto", full: "Exchange of crypto-assets for other crypto-assets" },
      e: { label: "Order execution", full: "Execution of orders for crypto-assets on behalf of clients" },
      f: { label: "Placing", full: "Placing of crypto-assets" },
      g: { label: "Order transmission", full: "Reception and transmission of orders for crypto-assets on behalf of clients" },
      h: { label: "Advice", full: "Advice on crypto-assets" },
      i: { label: "Portfolio management", full: "Portfolio management on crypto-assets" },
      j: { label: "Transfer services", full: "Transfer services for crypto-assets on behalf of clients" },
    },
    countries: {
      AT: "Austria", BE: "Belgium", BG: "Bulgaria", CY: "Cyprus", CZ: "Czechia",
      DE: "Germany", DK: "Denmark", EE: "Estonia", EL: "Greece", GR: "Greece",
      ES: "Spain", FI: "Finland", FR: "France", HR: "Croatia", HU: "Hungary",
      IE: "Ireland", IS: "Iceland", IT: "Italy", LI: "Liechtenstein", LT: "Lithuania",
      LU: "Luxembourg", LV: "Latvia", MT: "Malta", NL: "Netherlands", NO: "Norway",
      PL: "Poland", PT: "Portugal", RO: "Romania", SE: "Sweden", SI: "Slovenia",
      SK: "Slovakia", GB: "United Kingdom", CH: "Switzerland",
    },
    footer: {
      lastCheckedLoading: "Last checked: loading…",
      lastChecked: (ts) => `Last checked: ${ts}`,
      neverChecked: "No scrape has run yet — trigger the GitHub Actions workflow manually once.",
      neverCheckedShort: "No scrape has run yet.",
      sourcePrefix: "Source: ",
      sourceLinkText: "ESMA Interim MiCA Register",
      sourceAnd: " and ",
      sourceLinkTextAfm: "AFM Crypto register",
    },
    badges: { added: "New", changed: "Changed", removed: "Removed" },
    misc: { unknownValue: "unknown", fetchError: (path, status) => `Could not load ${path} (${status})` },
    easterEgg: {
      genesisTitle: "Genesis block, 3 January 2009:",
      genesisQuote: "\"The Times 03/Jan/2009 Chancellor on brink of second bailout for banks.\"",
      emptyToTheMoon: "This destination falls outside MiCAR's (Regulation (EU) 2023/1114) territorial scope. For lunar supervisory matters, please contact a competent authority that has yet to be established.",
      emptyWenLambo: "No entity is registered as offering \"Lambo-as-a-Service\" within the meaning of MiCAR Art. 3(1)(16). Client demand noted; legislation does not (yet) follow.",
    },
  },
};

// Static markup translation: any element tagged with data-i18n="path" gets its
// textContent replaced, data-i18n-placeholder="path" gets its placeholder
// attribute set, data-i18n-title="path" gets its title attribute set. Dynamic
// content generated by app.js/register.html/changelog.html scripts calls t()
// directly instead.
function applyStaticTranslations() {
  document.documentElement.lang = getLang();
  document.querySelectorAll("[data-i18n]").forEach((elm) => {
    elm.textContent = t(elm.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((elm) => {
    elm.setAttribute("placeholder", t(elm.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((elm) => {
    elm.setAttribute("title", t(elm.getAttribute("data-i18n-title")));
  });
}

// Small NL/EN segmented toggle, inserted into the top nav on every page.
function renderLangToggle(container) {
  const wrap = document.createElement("div");
  wrap.className = "lang-toggle";
  const current = getLang();
  for (const code of ["nl", "en"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-toggle__btn" + (code === current ? " is-active" : "");
    btn.textContent = code.toUpperCase();
    btn.addEventListener("click", () => { if (code !== current) setLang(code); });
    wrap.appendChild(btn);
  }
  container.appendChild(wrap);
  return wrap;
}

document.documentElement.lang = getLang();
