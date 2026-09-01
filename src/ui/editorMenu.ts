/* Snabbmenyn i skrivytan.
 *
 * Innehållet speglar bilden användaren utgick från, med en avvikelse:
 * "klistra in som oformaterad text" finns inte, eftersom markdown redan ÄR
 * oformaterad text och raden hade gjort exakt samma sak som "klistra in".
 * I stället finns "klistra in som länk", som är det man faktiskt saknar
 * när man har en URL i urklipp. */

import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { EditorView } from "@codemirror/view";

import {
  BLOCKS,
  deleteSelection,
  hasSelection,
  insertBlock,
  insertExternalLink,
  insertWikiLink,
  looksLikeUrl,
  replaceSelection,
  selectAll,
  selectedText,
  setHeading,
  toggleLinePrefix,
  toggleOrderedList,
  toggleWrap,
} from "../editor/commands";
import type { MenuItem } from "./menu";

async function copy(view: EditorView) {
  const text = selectedText(view);
  if (text) await writeText(text);
}

async function cut(view: EditorView) {
  await copy(view);
  deleteSelection(view);
}

async function paste(view: EditorView) {
  const text = await readText();
  if (text) replaceSelection(view, text);
}

/** Har man en URL i urklipp blir markeringen länktext, annars klistras den in rå. */
async function pasteAsLink(view: EditorView) {
  const text = (await readText())?.trim();
  if (!text) return;

  if (looksLikeUrl(text)) insertExternalLink(view, text);
  else replaceSelection(view, text);
}

export function buildEditorMenu(view: EditorView): MenuItem[] {
  const selection = hasSelection(view);

  return [
    { label: "Lägg till länk", icon: "link", shortcut: "Ctrl K", run: () => insertWikiLink(view) },
    {
      label: "Lägg till extern länk",
      icon: "external",
      shortcut: "Ctrl Shift K",
      run: () => insertExternalLink(view),
    },
    { kind: "separator" },
    {
      label: "Formatering",
      icon: "format",
      submenu: [
        { label: "Fet", shortcut: "Ctrl B", run: () => toggleWrap(view, "**") },
        { label: "Kursiv", shortcut: "Ctrl I", run: () => toggleWrap(view, "*") },
        { label: "Genomstruken", run: () => toggleWrap(view, "~~") },
        { label: "Kod", icon: "code", run: () => toggleWrap(view, "`") },
      ],
    },
    {
      label: "Stycke",
      icon: "paragraph",
      submenu: [
        { label: "Brödtext", shortcut: "Ctrl 0", run: () => setHeading(view, 0) },
        { label: "Rubrik 1", icon: "heading", shortcut: "Ctrl 1", run: () => setHeading(view, 1) },
        { label: "Rubrik 2", icon: "heading", shortcut: "Ctrl 2", run: () => setHeading(view, 2) },
        { label: "Rubrik 3", icon: "heading", shortcut: "Ctrl 3", run: () => setHeading(view, 3) },
        { kind: "separator" },
        { label: "Punktlista", icon: "list", run: () => toggleLinePrefix(view, "- ") },
        { label: "Numrerad lista", icon: "list", run: () => toggleOrderedList(view) },
        { label: "Att göra-lista", icon: "check", run: () => toggleLinePrefix(view, "- [ ] ") },
        { label: "Citat", icon: "quote", run: () => toggleLinePrefix(view, "> ") },
      ],
    },
    {
      label: "Infoga",
      icon: "insert",
      submenu: [
        { label: "Kodblock", icon: "code", run: () => insertBlock(view, BLOCKS.code, 4) },
        { label: "Tabell", run: () => insertBlock(view, BLOCKS.table) },
        { label: "Avdelare", icon: "rule", run: () => insertBlock(view, BLOCKS.rule) },
      ],
    },
    { kind: "separator" },
    {
      label: "Klipp ut",
      icon: "cut",
      shortcut: "Ctrl X",
      disabled: !selection,
      run: () => void cut(view),
    },
    {
      label: "Kopiera",
      icon: "copy",
      shortcut: "Ctrl C",
      disabled: !selection,
      run: () => void copy(view),
    },
    { label: "Klistra in", icon: "paste", shortcut: "Ctrl V", run: () => void paste(view) },
    { label: "Klistra in som länk", icon: "link", run: () => void pasteAsLink(view) },
    { kind: "separator" },
    { label: "Markera allt", icon: "selectAll", shortcut: "Ctrl A", run: () => selectAll(view) },
  ];
}
