//! Filoperationer mot användarens vault (mappen med .md-filer).
//!
//! Allt som rör disken bor här. Två saker är viktiga och gäller överallt:
//!   1. Sökvägar från frontend är alltid relativa och får aldrig peka utanför vaulten.
//!   2. Skrivningar är atomiska, annars kan iCloud synka en halvskriven fil.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub vault: Option<String>,
    #[serde(default)]
    pub last_note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteContent {
    pub path: String,
    pub content: String,
    pub mtime: u64,
}

/// Slår ihop vault-roten med en relativ sökväg och vägrar allt som försöker
/// ta sig utanför (".." eller absoluta sökvägar).
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let normalized = rel.replace('\\', "/");
    let mut out = root.to_path_buf();
    for comp in Path::new(&normalized).components() {
        match comp {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err(format!("Ogiltig sökväg: {rel}")),
        }
    }
    Ok(out)
}

pub fn rel_of(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn mtime_of(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Dolda mappar och vår egen papperskorg ska aldrig visas i trädet.
pub fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("node_modules")
}

pub fn is_markdown(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_ascii_lowercase();
            ext == "md" || ext == "markdown" || ext == "mdx"
        }
        None => false,
    }
}

/// Läser mappträdet. Mappar först, sedan filer, båda i bokstavsordning.
pub fn read_tree(root: &Path, dir: &Path) -> Vec<TreeNode> {
    let mut dirs: Vec<TreeNode> = Vec::new();
    let mut files: Vec<TreeNode> = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }
        let is_dir = path.is_dir();
        if is_dir {
            dirs.push(TreeNode {
                name,
                path: rel_of(root, &path),
                is_dir: true,
                children: read_tree(root, &path),
            });
        } else if is_markdown(&path) {
            files.push(TreeNode {
                name: name.trim_end_matches(".md").to_string(),
                path: rel_of(root, &path),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    dirs.sort_by_key(|n| n.name.to_lowercase());
    files.sort_by_key(|n| n.name.to_lowercase());
    dirs.extend(files);
    dirs
}

/// Skriver via en temporär fil i samma mapp och byter namn över originalet.
/// Rename är atomiskt på NTFS, så filen är antingen den gamla eller den nya --
/// aldrig en halv fil som iCloud hinner synka.
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("Filen saknar mapp")?;
    fs::create_dir_all(dir).map_err(|e| format!("Kunde inte skapa mappen: {e}"))?;

    let stem = path.file_name().and_then(|n| n.to_str()).unwrap_or("note");
    let tmp = dir.join(format!(".{stem}.mdash-tmp"));

    if let Err(e) = fs::write(&tmp, content) {
        // Vissa molnmappar tillåter inte temporära filer. Skriv direkt istället.
        return fs::write(path, content).map_err(|_| format!("Kunde inte spara: {e}"));
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return fs::write(path, content).map_err(|_| format!("Kunde inte spara: {e}"));
    }
    Ok(())
}

/// Hittar ett ledigt namn genom att lägga på " 2", " 3" ... vid krock.
pub fn unique_path(dir: &Path, base: &str, ext: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{base}{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base} {n}{ext}"));
        n += 1;
    }
    candidate
}

/// Radering flyttar till .trash inuti vaulten istället för att ta bort.
/// Papperskorgen är dold i trädet, och användaren kan alltid ångra sig i Utforskaren.
pub fn move_to_trash(root: &Path, path: &Path) -> Result<(), String> {
    let trash = root.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| format!("Kunde inte skapa papperskorgen: {e}"))?;

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("borttagen")
        .to_string();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let target = trash.join(format!("{stamp}-{name}"));
    fs::rename(path, &target).map_err(|e| format!("Kunde inte flytta till papperskorgen: {e}"))
}
