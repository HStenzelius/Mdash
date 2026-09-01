# Mdash

En liten Windows-app för att skriva och organisera markdown-anteckningar.
Filerna är vanliga `.md` på disk i en mapp användaren väljer (t.ex. iCloud Drive),
så att synk sköts av molntjänsten och anteckningarna aldrig låses in i Mdash.

> Den här filen är projektets minne. Claude uppdaterar den löpande: beslut som
> fattats, fallgropar som hittats, och sådant som inte syns i koden.
> Läs den först, skriv till den sist.

---

## Beslut (och varför)

| Val | Beslut | Varför |
|---|---|---|
| Skal | **Tauri v2** | ~10 MB installer och låg minnesanvändning. Användaren valde detta framför Electron och accepterade MSVC-installationen. |
| Frontend | **Vite + TypeScript, ingen ramverk** | Appen är liten; vanilla håller bundlen minimal, vilket är hela poängen med Tauri. |
| Editor | **CodeMirror 6 med live-preview** | Rubriker/fetstil renderas medan man skriver. Ramverksoberoende och byggt för just detta. |
| Lagring | **Vanliga .md-filer, ingen databas** | Utbytbart mot Obsidian/iA Writer. Gör molnsynk trivial. Metadata i YAML-frontmatter. |
| Taggar/länkar | **Indexeras i Rust vid start + vid filändring** | Snabbt nog att skanna hela vaulten; slipper en databas som kan hamna ur synk med disken. |
| Design | **Akryl-frostat glas, dov gråblå** | Windows 11-native backdrop via DWM, inte fejkad CSS-blur. Layouten följer användarens inspirationsbild. |

## Arkitektur

```
src/                  frontend (TypeScript)
  api.ts              enda stället som anropar Rust (invoke)
  state.ts            appens tillstånd + enkel prenumeration
  editor/             CodeMirror: live-preview-dekorationer, tema
  ui/                 titelrad, sidopanel, sökpalett
src-tauri/src/
  vault.rs            filoperationer (läs/skriv/skapa/döp om/radera)
  index.rs            skannar vaulten -> taggar, länkar, backlinks, sökning
  watcher.rs          bevakar disken, meddelar frontend vid extern ändring
```

**Regel:** frontend rör aldrig filsystemet direkt. Allt går via `api.ts` -> `invoke` -> Rust.
Det håller behörigheterna på ett ställe och gör iCloud-hanteringen möjlig att resonera om.

## Fallgropar vi känner till

- **iCloud på Windows är Files On-Demand.** Filer kan vara platshållare som laddas ned
  vid första läsning. Läsningar kan därför hänga en stund — aldrig blockera UI-tråden.
- **Skriv alltid atomiskt** (temp-fil i samma mapp + rename). Annars kan iCloud synka
  en halvskriven fil till andra enheter.
- **Extern ändring är normalfallet**, inte ett undantag. Filbevakaren måste kunna säga
  "filen ändrades under dig" istället för att tyst skriva över.
- **Vår egen skrivning triggar bevakaren.** Ignorera händelser vi själva orsakat,
  annars uppstår en loop av omladdningar.

## Loggbok

### 2026-09-01 — Projektstart
- Miljö: Node 24.18, npm 11.16, git 2.55, WebView2 151 fanns redan. Rust och MSVC saknades.
- iCloud Drive ligger på `C:\Users\stenz\iCloudDrive`.
- Användarens val: Tauri, live-preview, alla organisationsfunktioner
  (mappträd, sökning, `#taggar`, `[[länkar]]` med backlinks), frostat glas i dov gråblå.

### 2026-09-01 — Version 0.1 byggd
Hela appen skriven i ett svep: Rust-kommandolager, index, filbevakare,
CodeMirror-editor med live-preview, sidopanel, sökpalett, design.

Vägval som inte syns i koden:
- **Radering flyttar till `.trash` i vaulten** istället för att ta bort. Enklare
  att lita på, och iCloud synkar papperskorgen som vilken mapp som helst.
- **Konflikthantering via mtime.** Frontend skickar med filens mtime från när den
  lästes; stämmer den inte skriver Rust ingenting utan svarar `conflict: true`,
  och användaren får välja "behåll min" eller "läs om".
- **Live-preview döljer syntax på alla rader utom den aktiva.** Därför räknas
  markörflytt som en anledning att rita om dekorationerna, inte bara textändring.
- **`[[länkar]]` och `#taggar` hittas med regex, inte av markdown-parsern**,
  som inte känner till dem. Indexeringen i Rust hoppar över kodblock; dekorationen
  i editorn gör en enklare koll (bara utseende, inget som påverkar data).
- **Ikonen ritas av ett skript** (`tools/gen-icon.mjs`) som skriver PNG för hand
  med Nodes zlib, så projektet slipper ett bildbibliotek som beroende.

Miljönoteringar:
- Rust 1.98 + MSVC Build Tools 2022 installerade via winget. Bygget kräver att
  `~/.cargo/bin` finns i PATH (nya terminaler får det automatiskt).
- npm varnar för att esbuilds postinstall är blockerad — den fungerar ändå,
  binären kommer via optional dependency.

### 2026-09-01 — Verifierat i körning
Appen testkördes mot en testvault med fyra anteckningar, undermapp, taggar
och korslänkar. Träd, taggräkning, live-preview, citatblock, inline-kod och
`[[länkar]]` fungerar som avsett.

Rättat efter att ha sett appen köra:
- **Välkomstvyn låg ovanpå appen** istället för att ersätta den, så det vita
  papperet skymtade igenom. Löst med `.shell.is-empty .body { display: none }`.
- **Frontmattern dominerade sidan.** Markdown-parsern läser YAML som brödtext
  och färgade den. Nu tvingas den till liten grå monospace med `!important`.
- **Punktlistor visade råa bindestreck.** Byts nu mot • med en widget-dekoration
  när markören står någon annanstans.

Fallgropar i verktygen (inte i koden):
- **Bash-heredocs på den här maskinen äter enkla omvända snedstreck.**
  `'\'` i Rust blev `'\'` och gav "unterminated character literal". Skriv
  Rust- och JSON-filer med filverktyget eller ett Node-skript istället.
- `app.state::<AppState>()` i `setup` lånar från `&mut App` och lever inte
  tillräckligt länge -- använd den klonade `AppHandle`:n. En `if let`-sats som
  låser ett mutex behöver dessutom avslutande semikolon där, annars dröjer
  temporärvärdet kvar till slutet av blocket.
- **Konfigurationen delas mellan utvecklingsläge och installerad app**
  (`%APPDATA%\se.stenz.mdash\settings.json`). Rensa den efter testkörningar,
  annars öppnar den installerade appen testmappen.

**Version 0.1 paketerad:** `Mdash_0.1.0_x64-setup.exe`, 1,4 MB
(appen själv 3,5 MB). Installeraren körs per användare, så den kräver ingen
administratör. Bygget tar knappt 5 minuter från rent tillstånd.

### Nästa steg (inte gjort än)
- Fritextsökningen läser hela innehållet i minnet. Bra upp till några tusen
  anteckningar; därefter behövs ett riktigt index.
- Ingen mörk variant av papperet än — bara det ljusa.
- Bilder i anteckningar visas inte inline.
- Ingen inbyggd uppdateringsfunktion; nya versioner installeras över den gamla.

### 2026-09-01 — Automatiska uppdateringar
Appen kollar GitHub vid start och frågar innan den installerar något.

- **Endpoint:** `https://github.com/HStenzelius/Mdash/releases/latest/download/latest.json`
- **Signeringsnyckel:** `%USERPROFILE%\.tauri\mdash.key` (utan lösenord, ligger
  utanför repot). **Den måste säkerhetskopieras.** Förloras den kan redan
  installerade appar aldrig uppdateras igen — de vägrar allt som inte är signerat
  med just den nyckeln, och enda vägen tillbaka är att installera om för hand.
- **Släpp en version:** `npm run release -- 0.2.0 "Vad som ändrats"`.
  Skriptet höjer versionsnumret på alla tre ställen (package.json,
  tauri.conf.json, Cargo.toml), bygger, signerar, skriver `latest.json`,
  taggar i git och laddar upp till GitHub.
- **Publikt repo** valdes så att appen slipper bära en åtkomsttoken. En token
  inbäddad i en exe-fil går att plocka ut av vem som helst som har filen.
- Uppdateringskollen körs **utan `await`** i `boot()`, före vault-kontrollen.
  Den ligger medvetet inte i `refreshTree()` — den anropas ofta.

**Viktigt:** version 0.1.0 saknar uppdateraren. Den första versionen med
uppdateringsstöd måste installeras för hand en gång; därefter sköter appen sig.
