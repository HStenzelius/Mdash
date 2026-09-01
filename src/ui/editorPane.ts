/* Redigeringsytan: CodeMirror, autospar och listan över inlänkningar.
 *
 * Sparandet är avsiktligt försiktigt. Vi håller reda på filens mtime från när
 * vi läste den; ändras den under oss (iCloud, en annan dator) sparar Rust
 * ingenting utan svarar "konflikt", och då får användaren avgöra. */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";

import { api, type Hit } from "../api";
import {
  insertExternalLink,
  insertWikiLink,
  setHeading,
  toggleWrap,
} from "../editor/commands";
import { livePreview } from "../editor/livePreview";
import { buildEditorMenu } from "./editorMenu";
import { showMenu } from "./menu";
import { paperLook } from "../editor/theme";

const AUTOSAVE_MS = 700;

export type ConflictChoice = "overwrite" | "reload";

export interface EditorPaneOptions {
  linkExists(target: string): boolean;
  openNote(path: string): void;
  openTag(tag: string): void;
  /** Länk till en anteckning som inte finns -- ska den skapas? */
  createMissing(target: string): void;
  resolveConflict(): Promise<ConflictChoice>;
  status(message: string, warn?: boolean): void;
}

export class EditorPane {
  private view: EditorView;
  private path: string | null = null;
  private mtime = 0;
  private dirty = false;
  private timer: number | null = null;
  /** Sant medan vi själva byter innehåll, så autosparet inte triggas av det. */
  private loading = false;

  constructor(
    host: HTMLElement,
    private backlinksHost: HTMLElement,
    private opts: EditorPaneOptions
  ) {
    this.view = new EditorView({
      parent: host,
      state: this.freshState(""),
    });

    // Sista chansen att få ned ändringar innan fönstret försvinner.
    window.addEventListener("beforeunload", () => void this.flush());
    window.addEventListener("blur", () => void this.flush());
  }

  private freshState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void this.flush();
              return true;
            },
          },
          { key: "Mod-b", preventDefault: true, run: (v) => (toggleWrap(v, "**"), true) },
          { key: "Mod-i", preventDefault: true, run: (v) => (toggleWrap(v, "*"), true) },
          { key: "Mod-k", preventDefault: true, run: (v) => (insertWikiLink(v), true) },
          {
            key: "Mod-Shift-k",
            preventDefault: true,
            run: (v) => (insertExternalLink(v), true),
          },
          { key: "Mod-0", preventDefault: true, run: (v) => (setHeading(v, 0), true) },
          { key: "Mod-1", preventDefault: true, run: (v) => (setHeading(v, 1), true) },
          { key: "Mod-2", preventDefault: true, run: (v) => (setHeading(v, 2), true) },
          { key: "Mod-3", preventDefault: true, run: (v) => (setHeading(v, 3), true) },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        markdown({ base: markdownLanguage, addKeymap: true }),
        paperLook,
        livePreview({
          linkExists: this.opts.linkExists,
          onOpenLink: (target) => this.followLink(target),
          onOpenTag: (tag) => this.opts.openTag(tag),
        }),
        EditorView.domEventHandlers({
          contextmenu: (event, view) => {
            event.preventDefault();

            // Högerklick utanför markeringen flyttar markören dit först,
            // precis som man är van vid. Klick inuti behåller markeringen.
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            const selection = view.state.selection.main;
            if (pos !== null && (pos < selection.from || pos > selection.to)) {
              view.dispatch({ selection: { anchor: pos } });
            }

            showMenu(event.clientX, event.clientY, buildEditorMenu(view));
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.loading) this.touch();
        }),
      ],
    });
  }

  private async followLink(target: string) {
    const path = await api.resolveLink(target);
    if (path) this.opts.openNote(path);
    else this.opts.createMissing(target);
  }

  private touch() {
    this.dirty = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), AUTOSAVE_MS);
  }

  get currentPath() {
    return this.path;
  }

  get hasUnsaved() {
    return this.dirty;
  }

  async open(path: string) {
    await this.flush();

    const note = await api.readNote(path);
    this.loading = true;
    this.view.setState(this.freshState(note.content));
    this.loading = false;

    this.path = note.path;
    this.mtime = note.mtime;
    this.dirty = false;
    this.view.focus();

    void this.renderBacklinks();
  }

  /** Laddar om från disk utan att fråga -- används när filen ändrats utanför
   *  appen och vi inte har några egna osparade ändringar. */
  async reload() {
    if (!this.path) return;
    const note = await api.readNote(this.path);
    if (note.content === this.view.state.doc.toString()) {
      this.mtime = note.mtime;
      return;
    }

    // Behåll markörens plats så gott det går efter omladdningen.
    const cursor = Math.min(note.content.length, this.view.state.selection.main.head);
    this.loading = true;
    this.view.setState(this.freshState(note.content));
    this.view.dispatch({ selection: { anchor: cursor } });
    this.loading = false;

    this.mtime = note.mtime;
    this.dirty = false;
    this.opts.status("Uppdaterad från disken");
    void this.renderBacklinks();
  }

  /** Skriver ned allt som väntar. Säker att anropa när som helst. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.path || !this.dirty) return;

    const path = this.path;
    const content = this.view.state.doc.toString();

    try {
      let result = await api.writeNote(path, content, this.mtime);

      if (result.conflict) {
        const choice = await this.opts.resolveConflict();
        if (choice === "reload") {
          this.dirty = false;
          await this.reload();
          return;
        }
        result = await api.writeNote(path, content, null, true);
      }

      this.mtime = result.mtime;
      this.dirty = false;
      void this.renderBacklinks();
    } catch (err) {
      this.opts.status(String(err), true);
    }
  }

  clear() {
    this.path = null;
    this.dirty = false;
    this.loading = true;
    this.view.setState(this.freshState(""));
    this.loading = false;
    this.backlinksHost.hidden = true;
  }

  focus() {
    this.view.focus();
  }

  private async renderBacklinks() {
    if (!this.path) return;
    let hits: Hit[] = [];
    try {
      hits = await api.backlinks(this.path);
    } catch {
      hits = [];
    }

    if (hits.length === 0) {
      this.backlinksHost.hidden = true;
      this.backlinksHost.replaceChildren();
      return;
    }

    const heading = document.createElement("h2");
    heading.textContent = `Länkat hit (${hits.length})`;

    const items = hits.map((hit) => {
      const btn = document.createElement("button");
      btn.className = "backlink";

      const title = document.createElement("strong");
      title.textContent = hit.title;
      const snippet = document.createElement("span");
      snippet.textContent = hit.snippet;

      btn.append(title, snippet);
      btn.addEventListener("click", () => this.opts.openNote(hit.path));
      return btn;
    });

    this.backlinksHost.replaceChildren(heading, ...items);
    this.backlinksHost.hidden = false;
  }
}
