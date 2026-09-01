/* Sidopanelen: mappträdet och tagglistan.
   Trädet speglar mappen på disk rakt av -- det finns ingen egen struktur i
   appen som kan hamna i otakt med filerna. */

import type { TagCount, TreeNode } from "../api";

export interface SidebarHandlers {
  openNote(path: string): void;
  openTag(tag: string): void;
  createNote(parentDir: string): void;
  createFolder(parentDir: string): void;
  rename(path: string, newName: string): void;
  remove(path: string, isDir: boolean): void;
  move(path: string, newParentDir: string): void;
}

const EXPANDED_KEY = "mdash.expanded";

const ICON_NOTE = `<svg class="row__icon" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>`;

export class Sidebar {
  private expanded = new Set<string>();
  private tree: TreeNode[] = [];
  private tags: TagCount[] = [];
  private activePath: string | null = null;
  private activeTag: string | null = null;
  private renaming: string | null = null;

  constructor(
    private treeHost: HTMLElement,
    private tagHost: HTMLElement,
    private handlers: SidebarHandlers
  ) {
    try {
      const saved = localStorage.getItem(EXPANDED_KEY);
      if (saved) this.expanded = new Set(JSON.parse(saved) as string[]);
    } catch {
      /* Öppna mappar är en bekvämlighet, inte data. Strunt i om det inte går. */
    }
    document.addEventListener("click", () => this.closeMenu());
  }

  setData(tree: TreeNode[], tags: TagCount[]) {
    this.tree = tree;
    this.tags = tags;
    this.render();
  }

  setActive(path: string | null, tag: string | null = null) {
    this.activePath = path;
    this.activeTag = tag;
    if (path) this.revealPath(path);
    this.render();
  }

  /** Fäller ut alla mappar ovanför en anteckning så att den syns. */
  private revealPath(path: string) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.expanded.add(parts.slice(0, i).join("/"));
    }
  }

  private persist() {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded]));
    } catch {
      /* se ovan */
    }
  }

  // ------------------------------------------------------------- ritning

  private render() {
    this.treeHost.replaceChildren(
      this.railHead("Anteckningar", [
        { label: "+", title: "Ny anteckning här", run: () => this.handlers.createNote("") },
      ]),
      this.renderNodes(this.tree)
    );

    const tagList = document.createElement("div");
    if (this.tags.length === 0) {
      const hint = document.createElement("div");
      hint.className = "row";
      hint.style.opacity = "0.45";
      hint.textContent = "Skriv #tagg i en anteckning";
      tagList.append(hint);
    } else {
      for (const { tag, count } of this.tags) {
        tagList.append(this.tagRow(tag, count));
      }
    }
    this.tagHost.replaceChildren(this.railHead("Taggar", []), tagList);
  }

  private railHead(label: string, actions: { label: string; title: string; run: () => void }[]) {
    const head = document.createElement("div");
    head.className = "rail__head";
    const text = document.createElement("span");
    text.textContent = label;
    head.append(text);

    for (const action of actions) {
      const btn = document.createElement("button");
      btn.className = "rail__add";
      btn.textContent = action.label;
      btn.title = action.title;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action.run();
      });
      head.append(btn);
    }
    return head;
  }

  private renderNodes(nodes: TreeNode[]): HTMLElement {
    const list = document.createElement("div");
    for (const node of nodes) {
      list.append(node.isDir ? this.folderRow(node) : this.noteRow(node));
    }
    if (nodes.length === 0) {
      const hint = document.createElement("div");
      hint.className = "row";
      hint.style.opacity = "0.45";
      hint.textContent = "Tomt än så länge";
      list.append(hint);
    }
    return list;
  }

  private folderRow(node: TreeNode): HTMLElement {
    const wrap = document.createElement("div");
    const isOpen = this.expanded.has(node.path);

    const row = this.baseRow(node);
    const caret = document.createElement("span");
    caret.className = `row__caret${isOpen ? " is-open" : ""}`;
    caret.textContent = "▶";
    row.prepend(caret);

    row.addEventListener("click", () => {
      if (isOpen) this.expanded.delete(node.path);
      else this.expanded.add(node.path);
      this.persist();
      this.render();
    });

    // Släpper man en anteckning på en mapp flyttas filen dit.
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("is-drop");
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drop"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("is-drop");
      const from = e.dataTransfer?.getData("text/mdash-path");
      if (from && from !== node.path) this.handlers.move(from, node.path);
    });

    wrap.append(row);

    if (isOpen) {
      const children = this.renderNodes(node.children);
      children.className = "children";
      wrap.append(children);
    }
    return wrap;
  }

  private noteRow(node: TreeNode): HTMLElement {
    const row = this.baseRow(node);
    row.insertAdjacentHTML("afterbegin", ICON_NOTE);
    if (node.path === this.activePath) row.classList.add("is-active");

    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/mdash-path", node.path);
    });
    row.addEventListener("click", () => this.handlers.openNote(node.path));
    return row;
  }

  /** Delad grund: etikett, omdöpning på plats och högerklicksmeny. */
  private baseRow(node: TreeNode): HTMLElement {
    const row = document.createElement("div");
    row.className = "row";
    row.title = node.name;

    if (this.renaming === node.path) {
      const input = document.createElement("input");
      input.className = "row__rename";
      input.value = node.name;
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.renaming = null;
          if (input.value.trim() && input.value !== node.name) {
            this.handlers.rename(node.path, input.value.trim());
          } else {
            this.render();
          }
        } else if (e.key === "Escape") {
          this.renaming = null;
          this.render();
        }
      });
      input.addEventListener("blur", () => {
        this.renaming = null;
        this.render();
      });
      row.append(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return row;
    }

    const label = document.createElement("span");
    label.className = "row__label";
    label.textContent = node.name;
    row.append(label);

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openMenu(e.clientX, e.clientY, node);
    });
    return row;
  }

  private tagRow(tag: string, count: number): HTMLElement {
    const row = document.createElement("div");
    row.className = `row${this.activeTag === tag ? " is-active" : ""}`;

    const label = document.createElement("span");
    label.className = "row__label";
    label.textContent = `#${tag}`;

    const badge = document.createElement("span");
    badge.className = "row__count";
    badge.textContent = String(count);

    row.append(label, badge);
    row.addEventListener("click", () => this.handlers.openTag(tag));
    return row;
  }

  // --------------------------------------------------------------- meny

  private menu: HTMLElement | null = null;

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private openMenu(x: number, y: number, node: TreeNode) {
    this.closeMenu();
    const dir = node.isDir ? node.path : node.path.split("/").slice(0, -1).join("/");

    const items: { label: string; run: () => void; danger?: boolean }[] = [
      { label: "Ny anteckning", run: () => this.handlers.createNote(dir) },
      { label: "Ny mapp", run: () => this.handlers.createFolder(dir) },
      {
        label: "Byt namn",
        run: () => {
          this.renaming = node.path;
          this.render();
        },
      },
      { label: "Radera", danger: true, run: () => this.handlers.remove(node.path, node.isDir) },
    ];

    const menu = document.createElement("div");
    menu.className = "menu";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.textContent = item.label;
      if (item.danger) btn.className = "is-danger";
      btn.addEventListener("click", () => {
        this.closeMenu();
        item.run();
      });
      menu.append(btn);
    }

    document.body.append(menu);
    // Håll menyn innanför fönsterkanten.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
    this.menu = menu;
  }
}
