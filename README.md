# MiCAR Register Tracker

Doorzoekbare spiegel van de 5 officiële MiCAR-registers (whitepapers, ART-uitgevers,
EMT-uitgevers, CASPs, non-compliant entiteiten), automatisch bijgewerkt via GitHub Actions.
Het CASPs-register bevat daarnaast ook CASPs die (nog) alleen bij de AFM vergund/genotificeerd
zijn — zie "AFM in het CASPs-register" hieronder.

Zie `ESMA_MiCAR_Register_Tracker_Ontwerp.md` voor het volledige ontwerp (datamodel, site-architectuur, UI).
Deze repo bevat zowel de **scraper** als de **site** (statisch, voor GitHub Pages).

## Wat de scraper doet

`scraper/fetch_esma.py`:

1. Downloadt de 5 officiële CSV's rechtstreeks van esma.europa.eu, én het AFM-cryptoregister
   (een los `.xlsx`-bestand van afm.nl — zie "AFM in het CASPs-register" hieronder)
   rechtstreeks van afm.nl.
2. Normaliseert elk bestand naar JSON (`data/*.json`), waarbij herhaalde rijen per
   entiteit (CASPs-diensten, whitepapers per uitgever) worden gegroepeerd tot één record
   met een array-veld. Voor CASPs worden ESMA's eigen export en AFM's register hierbij ook
   direct samengevoegd (zie hieronder).
3. Vergelijkt de nieuwe stand met de vorige commit van `/data` en bepaalt wat is
   toegevoegd, gewijzigd of verdwenen — inclusief een veldniveau-omschrijving voor CASPs
   (bv. "Bewaring toegevoegd aan dienstverlening", "nu ook aangeboden in: BE, DE") die ook in
   de Slack-melding terechtkomt (zie "Slack-meldingen" hieronder).
4. Schrijft `data/meta.json` (laatst gecontroleerd, aantallen per register) en
   `data/history/changelog.json` (append-only wijzigingslog).

### AFM in het CASPs-register

Er is bewust géén apart AFM-register (meer) op de site — AFM's
[cryptoregister](https://www.afm.nl/en/sector/registers/vergunningenregisters/cryptopartijen)
bevat toch alleen CASPs, dus die worden direct in `data/casps.json` opgenomen in plaats van in
een eigen tabblad. AFM publiceert een Nederlandse CASP's vergunning/notificatie/dienst vaak
eerder dan ESMA's EU-brede, ietwat trager gepubliceerde verzamelregister — voor een in
Nederland gevestigde en vergunde CASP is de AFM-bron dus geregeld actueler.

`merge_esma_and_afm_casps()` in `fetch_esma.py` regelt dit samenvoegen:

- Een AFM-entiteit wordt gematcht aan een ESMA-entiteit op LEI (of, als een van beide geen LEI
  heeft, op genormaliseerde naam).
- Staat een AFM-entiteit al in ESMA's eigen export? Dan wordt er niets toegevoegd — geen
  dubbele rij, geen dubbele "toegevoegd"-melding.
- Staat een AFM-entiteit nog niet in ESMA's export? Dan komt hij erbij, gemarkeerd
  `source: "afm"` (zichtbaar in het detailpaneel als "Databron: AFM"), mét de AFM-specifieke
  velden (vergunningsnummer, type vergunning, EU-paspoort, gelijkwaardige dienstverlening) die
  ESMA's CASPS-export niet heeft.
- Zodra diezelfde entiteit later ook in ESMA's eigen export verschijnt, neemt de ESMA-versie
  het over (`source: "esma"`) — het record behoudt daarbij zijn bestaande id, zodat dit nooit
  als een "verwijderd" + "toegevoegd"-paar in de changelog/Slack-melding verschijnt.
- De LEI zelf wordt ook tussen beide bronnen gereconcilieerd (`_reconcile_lei()`): is er precies
  één kant met een geldige LEI (20 tekens, `clean_lei()`), dan wint die, ongeacht welke bron
  verder de overhand heeft. Zijn beide ongeldig, of geldig-maar-verschillend (zeldzaam), dan
  wordt GLEIF's publieke, gratis LEI-database (`api.gleif.org`) geraadpleegd als scheidsrechter
  — alleen bij een ondubbelzinnige, actieve match op naam. GLEIF-aanroepen falen altijd stil
  (nooit de scrape blokkerend); levert dat niets bruikbaars op, dan blijft de LEI "onbekend"
  in plaats van dat er geraden wordt.

De AFM publiceert dit register als een los `.xlsx`-bestand (geen CSV-API zoals ESMA), dus
`fetch_afm_rows()`/`normalize_afm()` in `fetch_esma.py` gebruiken `openpyxl` om het in te
lezen. AFM herformatteert dit bestand af en toe (kolomvolgorde, titelregels) — de parser zoekt
daarom dynamisch naar de rij die begint met "Entity name" in plaats van een vaste rij-offset
aan te nemen. Is AFM's bestand tijdelijk niet bereikbaar? Dan valt de scraper terug op
ESMA-only data voor CASPs — dat telt niet mee als "alle bronnen mislukt" en faalt de run dus
niet.

## Automatisering

`.github/workflows/scrape.yml` draait de scraper eenmaal per dag om 08:00 Nederlandse tijd, en
via handmatige trigger (`workflow_dispatch`, te vinden onder de "Actions"-tab van de repo). Bij
een wijziging committeert en pusht de workflow `/data` automatisch — zonder wijziging gebeurt er
niets (behalve dat `meta.json`'s `last_checked` bijwerkt, ook gecommit).

GitHub Actions cron kent alleen UTC, geen tijdzones/zomertijd — daarom staan er in `scrape.yml`
twee cron-regels (`0 7 * 11,12,1,2,3 *` voor de wintermaanden = 08:00 CET, en
`0 6 * 4,5,6,7,8,9,10 *` voor de zomermaanden = 08:00 CEST) in plaats van één. Rond de exacte
overgangsdatum (laatste zondag van maart/oktober) loopt dit een paar dagen 1 uur uit de pas —
een geaccepteerde beperking, want cron kan geen "lokale kloktijd" uitdrukken.

**Let op:** ESMA ververst het interim-register zelf maar wekelijks (het AFM-register wisselt
vaker). Dagelijks checken pikt een update dus ruim op tijd op zonder te wachten op de
eerstvolgende geplande check.

## Slack-meldingen

De workflow post een Slack-bericht zodra een run een échte wijziging vindt (nieuw/gewijzigd/
verwijderd record in één van de 5 registers) — niet bij elke run, want elke run herschrijft
`generated_at`/`last_checked` sowieso (zie `steps.scrape.outputs.real_changes` in
`scrape.yml`). Elke regel is één gewijzigde partij: een 🆕/✏️/❌-icoon voor het type, de naam,
het register tussen haakjes, en — bij een wijziging — een korte omschrijving van wát er precies
veranderde (bv. welke dienst is toegevoegd, welke landen erbij).

`summarize_change_detail()` in `fetch_esma.py` bouwt die omschrijving en voegt daarbij alle
gewijzigde aspecten van één partij samen tot één regel, in plaats van een aparte regel per
dienst/land (dat maakte de melding rommelig als bv. één CASP in één keer 7 diensten in
hetzelfde land erbij kreeg). Drie caps houden een enkele partij-regel behapbaar: meer dan 4
diensten in dezelfde groep wordt een aantal ("7 diensten ..." i.p.v. alle namen), meer dan 6
landen in één lijst wordt de eerste 6 plus een "+N andere"-rest, en meer dan 3 losse gewijzigde
aspecten op één partij wordt de eerste 3 plus een "+N andere wijziging(en)"-rest. Net als de
bestaande `MAX_SUMMARY_LINES`-afkap (max. 20 partij-regels per melding) gaat er hierbij geen
data verloren — de volledige lijst blijft altijd zichtbaar op de changelog-pagina zelf.

Eenmalige setup:

1. Maak in Slack (via **Workflow Builder** → "New Workflow" → trigger "From a webhook") een
   workflow met één tekstvariabele, genaamd `message`, die die variabele in een "Send a
   message"-stap post naar het gewenste kanaal.
2. Kopieer de webhook-URL die Workflow Builder je geeft (`https://hooks.slack.com/triggers/...`).
3. Zet die URL als GitHub-repository-secret: **Settings → Secrets and variables → Actions →
   New repository secret**, naam `SLACK_WEBHOOK_URL`.
4. Voeg de link naar de changelog toe als een **knop** op diezelfde "Send a message"-stap
   (**Add a button** → Button label "Wijzigingsgeschiedenis", Behaviour "Open link", URL
   `https://novarwo.github.io/micar-registers/changelog.html`) — niet via de `message`-variabele.
   Slack past mrkdwn (bold/italic/`<url|label>`-links) namelijk alleen toe op tekst die je zelf
   rechtstreeks in Workflow Builder typt of instelt, nooit op de inhoud van een ingevoegde
   variabele (die wordt altijd letterlijk, ongeïnterpreteerd geplakt — vandaar dat die opmaak
   eerder als kale tekens verscheen). Een knop is de native, betrouwbare manier om dit op te
   lossen zonder de volledige URL te tonen. Omdat die URL nooit wijzigt, hoeft dit maar één keer.

Zonder het `SLACK_WEBHOOK_URL`-secret slaat de workflow de Slack-stap stilzwijgend over
(`continue-on-error`) — de rest van de scrape/site-update blijft gewoon werken.

## De site

Volledig statisch (geen build-stap, geen backend) — vanilla HTML/CSS/JS die `data/*.json`
rechtstreeks met `fetch()` uitleest:

- `index.html` — dashboard met aantallen per register en de meest recente wijzigingen.
- `register.html?type=casps|art|emt|whitepapers|non_compliant` — doorzoekbare/filterbare/
  sorteerbare tabel per register, met een detailpaneel per record en CSV-export van de huidige
  selectie. Voor CASPs toont het detailpaneel bij AFM-gemergde records ("Databron: AFM")
  ook de AFM-specifieke velden.
- `changelog.html` — volledige wijzigingsgeschiedenis, filterbaar op register en type
  (nieuw/gewijzigd/verwijderd).
- `assets/js/app.js` — alle rendering/filter/sort/zoek-logica; `assets/css/style.css` —
  styling.

Werkt direct via GitHub Pages zodra Pages op de repo-root (branch `main`) is ingesteld
(**Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**).

## Lokaal draaien

```bash
cd scraper
pip install -r requirements.txt
python fetch_esma.py
```

Dit vult (of werkt bij) de `data/`-map in de repo-root.

## Setup checklist

1. Maak de GitHub-repo aan (publiek of privé — GitHub Pages werkt met beide op een
   account/organisatie met Pages-toegang) en push deze inhoud.
2. Onder **Settings → Actions → General → Workflow permissions**: zet op
   "Read and write permissions" (nodig zodat de workflow naar `data/` kan pushen).
3. Draai de workflow eenmalig handmatig (Actions-tab → "ESMA MiCAR register scrape" →
   "Run workflow") om de eerste snapshot te vullen.
4. Onder **Settings → Pages**: source op "Deploy from a branch", branch `main`, map `/ (root)`.
   De site (`index.html` e.v.) verschijnt dan op de Pages-URL van de repo.

## Verificatie

De parsing/groepering/diff-logica is getest tegen echte fragmenten van alle 5 ESMA-CSV's
(zie `test_fixtures/`, incl. `run_tests.py`) — o.a. correcte groepering van meerdere
diensten per CASP, meerdere whitepapers per EMT-/ART-uitgever, deduplicatie van een
letterlijk dubbele rij in het non-compliant register, en correcte detectie van
toegevoegde/gewijzigde/verwijderde records tussen twee runs. `normalize_afm()` is apart
getest tegen echte rijen uit het live AFM-register (vergunning, notificatie, cross-border/
incoming passport, ingetrokken vergunning, gemengde hoofdletters in landcodes) om te
verifiëren dat de datums, diensten-codes en EU-paspoortlanden correct worden geparsed.
`merge_esma_and_afm_casps()` is apart getest op: een AFM-only entiteit die eenmalig wordt
toegevoegd (`source: "afm"`), een AFM-entiteit die al in ESMA's export staat (geen dubbele
rij), een AFM-entiteit die later "overstapt" naar ESMA's eigen export met behoud van hetzelfde
id (nooit een verwijderd+toegevoegd-paar, en de interne source-wisseling zelf genereert nooit
een melding), matching op genormaliseerde naam wanneer een LEI ontbreekt, en correcte
gewijzigd-detail bij een dienst-wijziging op een AFM-only record. Alle checks slagen.

De front-end (`assets/js/app.js`) is los daarvan getest met een jsdom-harnas tegen dezelfde
echte ESMA-fragmenten plus een AFM-gemergde CASP-fixture: per register is gecontroleerd dat de
tabel rendert, zoeken de resultaten terecht versmalt, kolomsortering (op/neer) niet crasht, en
het detailpaneel correct opent — voor alle 5 registers, inclusief het lege ART-register. Voor
CASPs is bovendien gecontroleerd dat AFM's "(x) omschrijving"-format voor diensten correct
wordt herkend door dezelfde dienst-iconen als bij ESMA-native CASPs, dat het detailpaneel
"Databron: AFM" plus de AFM-specifieke velden alleen toont bij een AFM-gemergd record (en niet
bij een ESMA-native record), en dat het vergunningstype (vergunning/notificatie/cross-border)
in dat detailpaneel correct wordt vertaald. Alle checks slagen.

`test_fixtures/` is alleen voor lokale verificatie en hoeft niet mee de deploy in —
`data/` staat momenteel op lege placeholders totdat de workflow voor het eerst draait.

## Data-attributie

Bronnen: [ESMA Interim MiCA Register](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica)
en het [AFM-cryptoregister](https://www.afm.nl/en/sector/registers/vergunningenregisters/cryptopartijen).
De whitepapers in dit register zijn niet beoordeeld of goedgekeurd door een toezichthouder;
afwezigheid uit het non-compliant register is geen bewijs van vergunning.
