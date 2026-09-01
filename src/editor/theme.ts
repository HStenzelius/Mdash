import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/* Papperet: mörk text på ljus yta, generös radhöjd och en textspalt som
   slutar innan raderna blir för långa att läsa bekvämt. */
const paperTheme = EditorView.theme(
  {
    "&": {
      color: "var(--ink)",
      backgroundColor: "transparent",
      height: "100%",
      fontSize: "15.5px",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-read)",
      lineHeight: "1.75",
      padding: "48px 0 0",
      overflow: "visible",
    },
    ".cm-content": {
      maxWidth: "760px",
      margin: "0 auto",
      padding: "0 56px 64px",
      caretColor: "var(--accent-ink)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-line": { padding: "0" },

    ".cm-cursor, .cm-dropCursor": {
      borderLeft: "2px solid var(--accent-ink)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "rgba(126, 166, 207, 0.28)",
      },
    ".cm-activeLine": { backgroundColor: "transparent" },

    /* Rubriker: luft ovanför, ingen under -- brödtexten hör ihop med sin rubrik. */
    ".cm-h1": { fontSize: "1.75em", fontWeight: "650", lineHeight: "1.3", marginTop: "0.4em" },
    ".cm-h2": { fontSize: "1.35em", fontWeight: "620", lineHeight: "1.35", marginTop: "1.1em" },
    ".cm-h3": { fontSize: "1.12em", fontWeight: "620", marginTop: "1em" },
    ".cm-h4, .cm-h5, .cm-h6": { fontWeight: "620", marginTop: "0.9em" },

    ".cm-quote-line": {
      borderLeft: "2.5px solid rgba(126, 166, 207, 0.55)",
      paddingLeft: "16px",
      color: "var(--ink-soft)",
      fontStyle: "italic",
    },

    ".cm-wikilink": {
      color: "var(--accent-ink)",
      cursor: "pointer",
      textDecoration: "none",
      borderBottom: "1px solid rgba(74, 123, 168, 0.3)",
    },
    ".cm-wikilink:hover": { borderBottomColor: "var(--accent-ink)" },
    ".cm-wikilink-missing": {
      color: "#a4736b",
      borderBottomStyle: "dashed",
      borderBottomColor: "rgba(164, 115, 107, 0.5)",
    },

    ".cm-hashtag": {
      color: "var(--accent-ink)",
      backgroundColor: "rgba(126, 166, 207, 0.14)",
      borderRadius: "4px",
      padding: "1px 5px",
      cursor: "pointer",
      fontSize: "0.92em",
    },
    ".cm-hashtag:hover": { backgroundColor: "rgba(126, 166, 207, 0.24)" },

    /* Frontmatter är metadata, inte text. Den ska gå att redigera men aldrig
       konkurrera med rubriken om uppmärksamheten -- därför liten, grå och
       befriad från markdown-parserns färger (den läser YAML som brödtext). */
    ".cm-frontmatter": {
      fontFamily: "var(--font-mono)",
      fontSize: "0.72em",
      lineHeight: "1.5",
    },
    ".cm-frontmatter, .cm-frontmatter *": {
      color: "var(--ink-faint) !important",
      fontWeight: "400 !important",
      background: "none !important",
    },

    ".cm-bullet": { color: "var(--ink-faint)" },
  },
  { dark: false }
);

const paperHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.75em", fontWeight: "650" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "620" },
  { tag: t.heading3, fontSize: "1.12em", fontWeight: "620" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "620" },
  { tag: t.strong, fontWeight: "680" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--ink-faint)" },
  { tag: t.link, color: "var(--accent-ink)" },
  { tag: t.url, color: "var(--ink-faint)" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
    background: "rgba(28, 39, 51, 0.06)",
    borderRadius: "4px",
    padding: "1px 4px",
  },
  { tag: t.quote, color: "var(--ink-soft)" },
  { tag: t.list, color: "var(--ink)" },
  /* Själva markdown-tecknen (#, **, -) när de syns på den aktiva raden. */
  { tag: t.processingInstruction, color: "rgba(126, 166, 207, 0.75)", fontWeight: "400" },
  { tag: t.contentSeparator, color: "var(--ink-faint)" },
]);

export const paperLook = [paperTheme, syntaxHighlighting(paperHighlight)];
