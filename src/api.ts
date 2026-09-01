/* Enda bryggan till Rust. Ingen annan fil anropar invoke direkt --
   då finns alla filoperationer och deras typer beskrivna på ett ställe. */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

export interface Snapshot {
  vault: string | null;
  vaultName: string | null;
  lastNote: string | null;
  noteCount: number;
}

export interface NoteContent {
  path: string;
  content: string;
  mtime: number;
}

export interface SaveResult {
  mtime: number;
  conflict: boolean;
}

export interface Hit {
  path: string;
  title: string;
  snippet: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

/* Rust svarar i snake_case; vi arbetar i camelCase på den här sidan. */
type RawTree = { name: string; path: string; is_dir: boolean; children: RawTree[] };
type RawSnapshot = {
  vault: string | null;
  vault_name: string | null;
  last_note: string | null;
  note_count: number;
};

function toTree(node: RawTree): TreeNode {
  return {
    name: node.name,
    path: node.path,
    isDir: node.is_dir,
    children: node.children.map(toTree),
  };
}

function toSnapshot(raw: RawSnapshot): Snapshot {
  return {
    vault: raw.vault,
    vaultName: raw.vault_name,
    lastNote: raw.last_note,
    noteCount: raw.note_count,
  };
}

export const api = {
  async snapshot(): Promise<Snapshot> {
    return toSnapshot(await invoke<RawSnapshot>("get_snapshot"));
  },

  async setVault(path: string): Promise<Snapshot> {
    return toSnapshot(await invoke<RawSnapshot>("set_vault", { path }));
  },

  async tree(): Promise<TreeNode[]> {
    return (await invoke<RawTree[]>("get_tree")).map(toTree);
  },

  readNote(path: string): Promise<NoteContent> {
    return invoke<NoteContent>("read_note", { path });
  },

  writeNote(
    path: string,
    content: string,
    expectedMtime: number | null,
    force = false
  ): Promise<SaveResult> {
    return invoke<SaveResult>("write_note", { path, content, expectedMtime, force });
  },

  createNote(parent: string, name: string): Promise<string> {
    return invoke<string>("create_note", { parent, name });
  },

  createFolder(parent: string, name: string): Promise<string> {
    return invoke<string>("create_folder", { parent, name });
  },

  rename(path: string, newName: string): Promise<string> {
    return invoke<string>("rename_entry", { path, newName });
  },

  move(path: string, newParent: string): Promise<string> {
    return invoke<string>("move_entry", { path, newParent });
  },

  remove(path: string): Promise<void> {
    return invoke<void>("delete_entry", { path });
  },

  search(query: string): Promise<Hit[]> {
    return invoke<Hit[]>("search", { query });
  },

  tags(): Promise<TagCount[]> {
    return invoke<TagCount[]>("list_tags");
  },

  notesWithTag(tag: string): Promise<Hit[]> {
    return invoke<Hit[]>("notes_with_tag", { tag });
  },

  backlinks(path: string): Promise<Hit[]> {
    return invoke<Hit[]>("backlinks", { path });
  },

  resolveLink(target: string): Promise<string | null> {
    return invoke<string | null>("resolve_link", { target });
  },

  createFromLink(target: string): Promise<string> {
    return invoke<string>("create_from_link", { target });
  },

  refresh(): Promise<number> {
    return invoke<number>("refresh");
  },

  /** Disken ändrades utanför appen (iCloud, Utforskaren, en annan dator). */
  onVaultChanged(handler: () => void) {
    return listen("vault-changed", handler);
  },
};
