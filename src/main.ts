/* Mdash -- ihopkopplingen.
   Håller appens tillstånd (vilken vault, vilken anteckning) och låter
   sidopanelen, editorn och sökpaletten prata med varandra. */

import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open as openDialog } from "@tauri-apps/plugin-dialog";

import { api, type TreeNode } from "./api";
import { EditorPane } from "./ui/editorPane";
import { Palette } from "./ui/palette";
import { Sidebar } from "./ui/sidebar";
import { checkForUpdates } from "./ui/updater";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dom = {
  vaultName: el("vault-name"),
  noteCount: el("note-count"),
  tree: el("rail-tree"),
  tags: el("rail-tags"),
  editorHost: el("editor-host"),
  backlinks: el("backlinks"),
  empty: el("empty"),
  emptyPick: el<HTMLButtonElement>("empty-pick"),
  icloudHint: el("icloud-hint"),
  useIcloud: el<HTMLButtonElement>("use-icloud"),
  pickVault: el<HTMLButtonElement>("pick-vault"),
  openSearch: el<HTMLButtonElement>("open-search"),
  palette: el("palette"),
  paletteInput: el<HTMLInputElement>("palette-input"),
  paletteResults: el("palette-results"),
  toast: el("toast"),
};

/** Titlarna på alla anteckningar, för att avgöra om en [[länk]] är bruten. */
let titles = new Set<string>();
let currentTag: string | null = null;

/** Välkomstvyn ersätter appen helt -- den läggs inte ovanpå den. */
function showWelcome(show: boolean) {
  dom.empty.hidden = !show;
  el("app").classList.toggle("is-empty", show);
}

// ------------------------------------------------------------------ toast

let toastTimer: number | null = null;

function status(message: string, warn = false) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle("is-warn", warn);
  dom.toast.hidden = false;

  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, warn ? 5000 : 2200);
}

// ------------------------------------------------------------------- delar

const editor = new EditorPane(dom.editorHost, dom.backlinks, {
  linkExists: (target) => titles.has(target.trim().toLowerCase()),
  openNote: (path) => void openNote(path),
  openTag: (tag) => void showTag(tag),
  createMissing: (target) => void createFromLink(target),
  status,
  async resolveConflict() {
    const keepMine = await confirm(
      `Filen har ändrats någon annanstans sedan du öppnade den — troligen av iCloud eller en annan dator.\n\n` +
        `Vill du behålla din version och skriva över den på disken?`,
      { title: "Filen har ändrats", kind: "warning", okLabel: "Behåll min", cancelLabel: "Läs om från disk" }
    );
    return keepMine ? "overwrite" : "reload";
  },
});

const sidebar = new Sidebar(dom.tree, dom.tags, {
  openNote: (path) => void openNote(path),
  openTag: (tag) => void showTag(tag),
  createNote: (dir) => void newNote(dir),
  createFolder: (dir) => void newFolder(dir),
  rename: (path, name) => void renameEntry(path, name),
  remove: (path, isDir) => void removeEntry(path, isDir),
  move: (path, dir) => void moveEntry(path, dir),
});

const palette = new Palette(dom.palette, dom.paletteInput, dom.paletteResults, (path) =>
  void openNote(path)
);

// ---------------------------------------------------------------- åtgärder

function collectTitles(nodes: TreeNode[], into: Set<string>) {
  for (const node of nodes) {
    if (node.isDir) collectTitles(node.children, into);
    else into.add(node.name.toLowerCase());
  }
}

async function refreshTree() {
  const [tree, tags] = await Promise.all([api.tree(), api.tags()]);

  const next = new Set<string>();
  collectTitles(tree, next);
  titles = next;

  sidebar.setData(tree, tags);
  sidebar.setActive(editor.currentPath, currentTag);

  const snapshot = await api.snapshot();
  dom.noteCount.textContent = snapshot.noteCount === 1 ? "1 anteckning" : `${snapshot.noteCount} anteckningar`;
}

async function openNote(path: string) {
  try {
    currentTag = null;
    await editor.open(path);
    sidebar.setActive(path, null);
  } catch (err) {
    status(String(err), true);
  }
}

async function newNote(dir: string) {
  try {
    const path = await api.createNote(dir, "Ny anteckning");
    await refreshTree();
    await openNote(path);
  } catch (err) {
    status(String(err), true);
  }
}

async function newFolder(dir: string) {
  try {
    await api.createFolder(dir, "Ny mapp");
    await refreshTree();
  } catch (err) {
    status(String(err), true);
  }
}

async function renameEntry(path: string, name: string) {
  try {
    const wasOpen = editor.currentPath === path;
    if (wasOpen) await editor.flush();

    const next = await api.rename(path, name);
    await refreshTree();
    if (wasOpen) await openNote(next);
  } catch (err) {
    status(String(err), true);
  }
}

async function moveEntry(path: string, dir: string) {
  try {
    const wasOpen = editor.currentPath === path;
    if (wasOpen) await editor.flush();

    const next = await api.move(path, dir);
    await refreshTree();
    if (wasOpen) await openNote(next);
  } catch (err) {
    status(String(err), true);
  }
}

async function removeEntry(path: string, isDir: boolean) {
  const what = isDir ? "mappen och allt i den" : "anteckningen";
  const ok = await confirm(
    `Flytta ${what} till papperskorgen?\n\nDen hamnar i mappen .trash inuti din vault, så du kan hämta tillbaka den.`,
    { title: "Radera", kind: "warning", okLabel: "Radera", cancelLabel: "Avbryt" }
  );
  if (!ok) return;

  try {
    if (editor.currentPath === path || (isDir && editor.currentPath?.startsWith(`${path}/`))) {
      editor.clear();
    }
    await api.remove(path);
    await refreshTree();
    status("Flyttad till .trash");
  } catch (err) {
    status(String(err), true);
  }
}

async function createFromLink(target: string) {
  const ok = await confirm(`Anteckningen "${target}" finns inte. Skapa den?`, {
    title: "Ny anteckning",
    okLabel: "Skapa",
    cancelLabel: "Avbryt",
  });
  if (!ok) return;

  try {
    const path = await api.createFromLink(target);
    await refreshTree();
    await openNote(path);
  } catch (err) {
    status(String(err), true);
  }
}

async function showTag(tag: string) {
  try {
    const hits = await api.notesWithTag(tag);
    currentTag = tag;
    sidebar.setActive(editor.currentPath, tag);
    palette.show(`#${tag}`, hits);
  } catch (err) {
    status(String(err), true);
  }
}

// -------------------------------------------------------------- vault-val

async function chooseVault() {
  const picked = await openDialog({
    directory: true,
    multiple: false,
    title: "Välj mappen där dina anteckningar ska ligga",
  });
  if (typeof picked !== "string") return;
  await useVault(picked);
}

async function useVault(path: string) {
  try {
    await editor.flush();
    editor.clear();

    const snapshot = await api.setVault(path);
    dom.vaultName.textContent = snapshot.vaultName ?? "";
    showWelcome(false);

    await refreshTree();
    status(`Skriver i ${snapshot.vaultName}`);
  } catch (err) {
    status(String(err), true);
  }
}

// ------------------------------------------------------------------ start

async function boot() {
  const win = getCurrentWindow();
  el("win-min").addEventListener("click", () => void win.minimize());
  el("win-max").addEventListener("click", () => void win.toggleMaximize());
  el("win-close").addEventListener("click", () => {
    void editor.flush().then(() => win.close());
  });

  dom.pickVault.addEventListener("click", () => void chooseVault());
  dom.emptyPick.addEventListener("click", () => void chooseVault());
  dom.openSearch.addEventListener("click", () => palette.open());

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "p") {
      e.preventDefault();
      palette.isOpen ? palette.close() : palette.open();
    } else if (mod && e.key.toLowerCase() === "n") {
      e.preventDefault();
      const dir = editor.currentPath?.includes("/")
        ? editor.currentPath.split("/").slice(0, -1).join("/")
        : "";
      void newNote(dir);
    } else if (e.key === "Escape" && palette.isOpen) {
      palette.close();
      editor.focus();
    }
  });

  // Disken kan ändras utan att vi gjorde det -- iCloud, Utforskaren, en annan dator.
  await api.onVaultChanged(() => {
    void refreshTree();
    if (!editor.hasUnsaved) void editor.reload();
  });

  // Utan await: uppdateringskollen får aldrig fördröja att appen ritas upp.
  void checkForUpdates(status);

  const snapshot = await api.snapshot();

  if (!snapshot.vault) {
    showWelcome(true);
    const icloud = await invoke<string | null>("suggest_icloud");
    if (icloud) {
      dom.useIcloud.textContent = icloud;
      dom.useIcloud.addEventListener("click", () => void useVault(icloud));
      dom.icloudHint.hidden = false;
    }
    return;
  }

  dom.vaultName.textContent = snapshot.vaultName ?? "";
  showWelcome(false);
  await refreshTree();

  if (snapshot.lastNote) {
    try {
      await openNote(snapshot.lastNote);
    } catch {
      /* Anteckningen kan ha raderats sedan sist. Strunt i det. */
    }
  }
}

void boot();
