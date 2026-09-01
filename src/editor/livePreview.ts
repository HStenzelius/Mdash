/* Live-preview: markdown formateras medan man skriver.
 *
 * Idén är enkel: syntaxen (#, **, [[ ]]) döljs på alla rader UTOM den man
 * står på. Så länge markören är i en rad ser man dess råa markdown och kan
 * redigera den; så fort man flyttar sig faller den på plats som formaterad text.
 * Filen på disken är hela tiden vanlig markdown -- vi ändrar bara vad som ritas.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/** Byter ut "-" mot en riktig punkt i punktlistor. Bara utseende --
 *  filen på disken innehåller fortfarande ett bindestreck. */
class BulletWidget extends WidgetType {
  override toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
  }
  override eq() {
    return true;
  }
}

export interface LivePreviewOptions {
  /** Finns anteckningen som [[länken]] pekar på? Styr om den ritas som bruten. */
  linkExists: (target: string) => boolean;
  onOpenLink: (target: string) => void;
  onOpenTag: (tag: string) => void;
}

const HIDDEN_MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "QuoteMark",
  "StrikethroughMark",
]);

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: "cm-h1",
  ATXHeading2: "cm-h2",
  ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h4",
  ATXHeading5: "cm-h5",
  ATXHeading6: "cm-h6",
  SetextHeading1: "cm-h1",
  SetextHeading2: "cm-h2",
};

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const quoteLine = Decoration.line({ class: "cm-quote-line" });
const frontmatterLine = Decoration.line({ class: "cm-frontmatter" });
const wikilink = Decoration.mark({ class: "cm-wikilink" });
const wikilinkMissing = Decoration.mark({ class: "cm-wikilink cm-wikilink-missing" });
const hashtag = Decoration.mark({ class: "cm-hashtag" });

const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;
const HASHTAG = /(^|[\s(])(#[\p{L}_][\p{L}\p{N}_/-]*)/gu;

/** Radnummer som markören eller markeringen rör vid -- där visas rå markdown. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** Raderna som YAML-frontmattern upptar, om filen har någon. */
function frontmatterEnd(state: EditorState): number {
  if (!state.doc.length || state.doc.line(1).text.trim() !== "---") return 0;
  for (let n = 2; n <= state.doc.lines; n++) {
    if (state.doc.line(n).text.trim() === "---") return n;
  }
  return 0;
}

function build(view: EditorView, opts: LivePreviewOptions): DecorationSet {
  const { state } = view;
  const deco: Range<Decoration>[] = [];
  const active = activeLines(state);
  const fmEnd = frontmatterEnd(state);

  for (let n = 1; n <= fmEnd; n++) {
    deco.push(frontmatterLine.range(state.doc.line(n).from));
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const headingClass = HEADING_CLASS[node.name];
        if (headingClass) {
          deco.push(Decoration.line({ class: headingClass }).range(state.doc.lineAt(node.from).from));
          return;
        }

        if (node.name === "Blockquote") {
          const first = state.doc.lineAt(node.from).number;
          const last = state.doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            deco.push(quoteLine.range(state.doc.line(n).from));
          }
          return;
        }

        if (node.name === "ListMark") {
          const line = state.doc.lineAt(node.from);
          const mark = state.doc.sliceString(node.from, node.to);
          // Numrerade listor ("1.") behåller sin siffra; punktlistor får en punkt.
          if (!active.has(line.number) && ["-", "*", "+"].includes(mark)) {
            deco.push(bullet.range(node.from, node.to));
          }
          return;
        }

        if (!HIDDEN_MARKS.has(node.name)) return;

        const line = state.doc.lineAt(node.from);
        if (line.number <= fmEnd || active.has(line.number)) return;

        // ``` och ~~~ är kodstaket -- de får stå kvar, de bär betydelse.
        if (node.name === "CodeMark" && node.to - node.from >= 3) return;

        let end = node.to;
        if (node.name === "HeaderMark" || node.name === "QuoteMark") {
          while (end < line.to && state.doc.sliceString(end, end + 1) === " ") end++;
        }
        if (end > node.from) deco.push(hide.range(node.from, end));
      },
    });

    // [[länkar]] och #taggar känner markdown-parsern inte till -- vi hittar dem själva.
    const text = state.doc.sliceString(from, to);

    WIKILINK.lastIndex = 0;
    for (let m = WIKILINK.exec(text); m; m = WIKILINK.exec(text)) {
      const start = from + m.index;
      const stop = start + m[0].length;
      const target = m[1].split("|")[0].split("#")[0].trim();
      deco.push((opts.linkExists(target) ? wikilink : wikilinkMissing).range(start, stop));

      if (!active.has(state.doc.lineAt(start).number)) {
        deco.push(hide.range(start, start + 2));
        deco.push(hide.range(stop - 2, stop));
      }
    }

    HASHTAG.lastIndex = 0;
    for (let m = HASHTAG.exec(text); m; m = HASHTAG.exec(text)) {
      const start = from + m.index + m[1].length;
      deco.push(hashtag.range(start, start + m[2].length));
    }
  }

  return Decoration.set(deco, true);
}

/** Vilken [[länk]] eller #tagg står på den här positionen, om någon? */
function tokenAt(state: EditorState, pos: number): { kind: "link" | "tag"; value: string } | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;

  WIKILINK.lastIndex = 0;
  for (let m = WIKILINK.exec(line.text); m; m = WIKILINK.exec(line.text)) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { kind: "link", value: m[1].split("|")[0].split("#")[0].trim() };
    }
  }

  HASHTAG.lastIndex = 0;
  for (let m = HASHTAG.exec(line.text); m; m = HASHTAG.exec(line.text)) {
    const start = m.index + m[1].length;
    if (offset >= start && offset <= start + m[2].length) {
      return { kind: "tag", value: m[2].slice(1) };
    }
  }
  return null;
}

export function livePreview(opts: LivePreviewOptions) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view, opts);
      }

      update(update: ViewUpdate) {
        // Markörflytt räknas: det är den som avgör vilken rad som visar syntax.
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = build(update.view, opts);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(event, view) {
      // Alt-klick lämnas åt vanlig markörplacering, så man kan redigera länktexten.
      if (event.altKey || event.button !== 0) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      const token = tokenAt(view.state, pos);
      if (!token) return false;

      event.preventDefault();
      if (token.kind === "link") opts.onOpenLink(token.value);
      else opts.onOpenTag(token.value);
      return true;
    },
  });

  return [plugin, clicks];
}
