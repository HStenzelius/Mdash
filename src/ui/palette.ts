/* Ctrl+P: sök på titel och innehåll i hela vaulten.
   Sökningen görs i Rust mot indexet i minnet, så den känns omedelbar. */

import { api, type Hit } from "../api";

export class Palette {
  private hits: Hit[] = [];
  private selected = 0;
  private seq = 0;

  constructor(
    private root: HTMLElement,
    private input: HTMLInputElement,
    private list: HTMLElement,
    private onPick: (path: string) => void
  ) {
    this.input.addEventListener("input", () => void this.run());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.root.addEventListener("mousedown", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(prefill = "") {
    this.root.hidden = false;
    this.input.value = prefill;
    this.input.focus();
    this.input.select();
    void this.run();
  }

  close() {
    this.root.hidden = true;
    this.hits = [];
    this.list.replaceChildren();
  }

  /** Visar ett färdigt resultat, t.ex. alla anteckningar med en viss tagg. */
  show(title: string, hits: Hit[]) {
    this.root.hidden = false;
    this.input.value = title;
    this.hits = hits;
    this.selected = 0;
    this.render();
    this.input.focus();
  }

  private async run() {
    const query = this.input.value.trim();
    const mine = ++this.seq;

    if (!query) {
      this.hits = [];
      this.render();
      return;
    }

    const hits = await api.search(query);
    // Ett långsammare svar på en äldre sökning får inte skriva över ett nyare.
    if (mine !== this.seq) return;

    this.hits = hits;
    this.selected = 0;
    this.render();
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      this.move(1);
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      this.move(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = this.hits[this.selected];
      if (hit) {
        this.close();
        this.onPick(hit.path);
      }
    }
  }

  private move(delta: number) {
    if (this.hits.length === 0) return;
    this.selected = (this.selected + delta + this.hits.length) % this.hits.length;
    this.render();
    this.list.children[this.selected]?.scrollIntoView({ block: "nearest" });
  }

  private render() {
    if (this.hits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "palette__empty";
      empty.textContent = this.input.value.trim() ? "Inga träffar" : "Börja skriv för att söka";
      this.list.replaceChildren(empty);
      return;
    }

    const items = this.hits.map((hit, i) => {
      const li = document.createElement("li");
      if (i === this.selected) li.className = "is-sel";

      const title = document.createElement("strong");
      title.textContent = hit.title;
      const snippet = document.createElement("span");
      snippet.textContent = hit.snippet || hit.path;

      li.append(title, snippet);
      li.addEventListener("mouseenter", () => {
        this.selected = i;
        this.render();
      });
      li.addEventListener("click", () => {
        this.close();
        this.onPick(hit.path);
      });
      return li;
    });

    this.list.replaceChildren(...items);
  }
}
