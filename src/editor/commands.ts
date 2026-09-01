/* Textoperationerna bakom snabbmenyn och kortkommandona.
 *
 * Alla arbetar på markdown som text -- det finns ingen dold modell vid sidan
 * av filen. "Fet" betyder att sätta ** runt markeringen, varken mer eller
 * mindre, och att ta bort dem igen om de redan står där. */

import type { EditorView } from "@codemirror/view";

export function hasSelection(view: EditorView) {
  return !view.state.selection.main.empty;
}

export function selectedText(view: EditorView) {
  const { from, to } = view.state.selection.main;
  return view.state.sliceDoc(from, to);
}

/** Sätter (eller tar bort) tecken runt markeringen, t.ex. ** för fetstil. */
export function toggleWrap(view: EditorView, marker: string) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const width = marker.length;

  const alreadyWrapped =
    state.sliceDoc(Math.max(0, from - width), from) === marker &&
    state.sliceDoc(to, Math.min(state.doc.length, to + width)) === marker;

  if (alreadyWrapped) {
    view.dispatch({
      changes: [
        { from: from - width, to: from },
        { from: to, to: to + width },
      ],
      selection: { anchor: from - width, head: to - width },
    });
  } else {
    const text = state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: `${marker}${text}${marker}` },
      // Utan markering hamnar markören mellan tecknen, redo att skriva.
      selection: text
        ? { anchor: from + width, head: to + width }
        : { anchor: from + width },
    });
  }
  view.focus();
}

/** Raderna som markeringen rör vid. */
function selectedLines(view: EditorView) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;

  const lines = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n));
  return lines;
}

/** Nivå 0 betyder brödtext, alltså ta bort rubriken. */
export function setHeading(view: EditorView, level: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
  const changes = selectedLines(view).map((line) => {
    const bare = line.text.replace(/^\s*#{1,6}\s+/, "");
    const prefix = level === 0 ? "" : `${"#".repeat(level)} `;
    return { from: line.from, to: line.to, insert: prefix + bare };
  });

  view.dispatch({ changes });
  view.focus();
}

/** Lägger till prefixet på alla rader, eller tar bort det om alla redan har det. */
export function toggleLinePrefix(view: EditorView, prefix: string) {
  const lines = selectedLines(view);
  const pattern = new RegExp(`^\\s*${prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s?`);
  const allHave = lines.every((line) => pattern.test(line.text));

  const changes = lines.map((line) => ({
    from: line.from,
    to: line.to,
    insert: allHave
      ? line.text.replace(pattern, "")
      : prefix + line.text.replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, ""),
  }));

  view.dispatch({ changes });
  view.focus();
}

/** Numrerad lista -- varje rad får sitt eget nummer. */
export function toggleOrderedList(view: EditorView) {
  const lines = selectedLines(view);
  const allNumbered = lines.every((line) => /^\s*\d+\.\s/.test(line.text));

  const changes = lines.map((line, i) => ({
    from: line.from,
    to: line.to,
    insert: allNumbered
      ? line.text.replace(/^\s*\d+\.\s?/, "")
      : `${i + 1}. ${line.text.replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, "")}`,
  }));

  view.dispatch({ changes });
  view.focus();
}

/** [[Länk till en annan anteckning]]. Markerad text blir länkens mål. */
export function insertWikiLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);

  view.dispatch({
    changes: { from, to, insert: `[[${text}]]` },
    selection: { anchor: from + 2, head: from + 2 + text.length },
  });
  view.focus();
}

/** [text](adress). Markören hamnar i adressen, som är det man vill fylla i. */
export function insertExternalLink(view: EditorView, url = "") {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to) || "text";
  const insert = `[${text}](${url})`;

  const urlStart = from + text.length + 3;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: urlStart, head: urlStart + url.length },
  });
  view.focus();
}

/** Lägger ett block på egen rad efter den markören står på. */
export function insertBlock(view: EditorView, block: string, cursorOffset = block.length) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);

  // En tom rad före blocket, om det inte redan finns en.
  const needsGap = line.text.trim() !== "";
  const insert = `${needsGap ? "\n" : ""}${block}`;
  const at = line.to;

  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + (needsGap ? 1 : 0) + cursorOffset },
  });
  view.focus();
}

export const BLOCKS = {
  code: "```\n\n```",
  rule: "---\n",
  table: "| Rubrik | Rubrik |\n| --- | --- |\n|  |  |",
} as const;

/** Ersätter markeringen med text från urklipp eller liknande. */
export function replaceSelection(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

export function deleteSelection(view: EditorView) {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: "" }, selection: { anchor: from } });
  view.focus();
}

export function selectAll(view: EditorView) {
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
}

export function looksLikeUrl(text: string) {
  return /^(https?:\/\/|www\.)\S+$/i.test(text.trim());
}
