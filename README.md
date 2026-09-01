# Mdash

En liten Windows-app för att skriva och organisera markdown-anteckningar.

Anteckningarna är vanliga `.md`-filer i en mapp du väljer själv. Pekar du den
mot iCloud Drive sköter iCloud synken, och filerna går att öppna i vilket annat
program som helst — Mdash låser inte in något.

## Vad appen kan

- **Live-preview** — `## Rubrik` blir en rubrik medan du skriver. Ställer du
  markören på raden ser du den råa markdownen igen och kan redigera den.
- **Mappträd** som speglar mappen på disk. Skapa, byt namn, dra mellan mappar.
- **Sökning** över titlar och innehåll med `Ctrl+P`.
- **`#taggar`** — skriv dem var som helst i texten, klicka i sidopanelen för
  att se alla anteckningar med en viss tagg.
- **`[[Länkar]]`** mellan anteckningar, med en lista över vad som länkar hit.
- **Autospar** var 700:e millisekund, och alltid när du byter anteckning.

## Kortkommandon

| Tangent | Gör |
|---|---|
| `Ctrl+P` | Sök |
| `Ctrl+N` | Ny anteckning |
| `Ctrl+S` | Spara nu (behövs sällan — appen sparar själv) |
| `Alt`+klick | Placera markören i en länk istället för att följa den |

## Utveckling

```bash
npm install
npm start          # kör appen med direktuppdatering
npm run bundle     # bygger installeraren
```

Installeraren hamnar i `src-tauri/target/release/bundle/nsis/`.

Ikonen ritas av `tools/gen-icon.mjs`; kör den följt av
`npx tauri icon icons/source.png` om du vill ändra utseendet.

## Hur det hänger ihop

Frontend (TypeScript, CodeMirror) rör aldrig filsystemet direkt — allt går via
`src/api.ts` till kommandona i `src-tauri/src/lib.rs`. Filoperationerna bor i
`vault.rs`, taggar och länkar indexeras i `index.rs`, och `watcher.rs` säger
till när något ändrar filerna utanför appen.

Se [CLAUDE.md](CLAUDE.md) för beslut, fallgropar och loggbok.

## Släppa en ny version

```bash
npm run release -- 0.2.0 "Kort beskrivning av vad som ändrats"
```

Skriptet höjer versionsnumret, bygger och signerar installeraren, skriver
`latest.json` och laddar upp allt till GitHub. Installerade appar upptäcker
uppdateringen nästa gång de startar och frågar om de får installera den.

Utan versionsnummer höjs sista siffran automatiskt: `npm run release`.

**Signeringsnyckeln** ligger i `%USERPROFILE%\.tauri\mdash.key` och ska
säkerhetskopieras. Utan den kan installerade appar inte längre uppdateras.
