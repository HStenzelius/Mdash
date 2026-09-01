//! Mdash -- appens kommandolager.
//!
//! Frontend ror aldrig filsystemet direkt. Allt gar genom kommandona harunder,
//! vilket haller behorigheter och sokvagskontroller pa ett enda stalle.

mod index;
mod vault;
mod watcher;

use index::{Hit, Index, TagCount};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};
use tauri::{AppHandle, Manager, State};
use vault::{NoteContent, Settings, TreeNode};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub index: RwLock<Index>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[derive(Serialize)]
pub struct Snapshot {
    vault: Option<String>,
    vault_name: Option<String>,
    last_note: Option<String>,
    note_count: usize,
}

#[derive(Serialize)]
pub struct SaveResult {
    mtime: u64,
    /// Sant nar filen andrats pa disken sedan vi laste den -- da har vi INTE
    /// skrivit nagot, och granssnittet far fraga anvandaren vad som ska galla.
    conflict: bool,
}

// ---------------------------------------------------------------- hjalpare

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Hittar ingen konfigurationsmapp: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Kunde inte skapa konfigmapp: {e}"))?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_file(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) {
    if let Ok(path) = settings_file(app) {
        if let Ok(json) = serde_json::to_string_pretty(settings) {
            let _ = std::fs::write(path, json);
        }
    }
}

/// Vault-roten, eller ett fel om ingen mapp valts an.
fn root_of(state: &State<AppState>) -> Result<PathBuf, String> {
    state
        .settings
        .lock()
        .map_err(|_| "Internt lasfel".to_string())?
        .vault
        .clone()
        .map(PathBuf::from)
        .ok_or_else(|| "Ingen mapp vald".to_string())
}

fn reindex(state: &State<AppState>, root: &Path) {
    let fresh = index::build(root);
    if let Ok(mut guard) = state.index.write() {
        *guard = fresh;
    }
}

fn read_index<T>(state: &State<AppState>, f: impl FnOnce(&Index) -> T) -> Result<T, String> {
    let guard = state.index.read().map_err(|_| "Internt lasfel".to_string())?;
    Ok(f(&guard))
}

// ---------------------------------------------------------------- kommandon

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Result<Snapshot, String> {
    let settings = state.settings.lock().map_err(|_| "Internt lasfel")?.clone();
    let note_count = state.index.read().map(|i| i.notes.len()).unwrap_or(0);
    let vault_name = settings.vault.as_ref().and_then(|v| {
        Path::new(v)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
    });
    Ok(Snapshot {
        vault: settings.vault,
        vault_name,
        last_note: settings.last_note,
        note_count,
    })
}

/// Pekar om appen till en ny mapp. Anropas efter att anvandaren valt mapp i
/// systemets mappdialog (som frontend oppnar via dialog-pluginet).
#[tauri::command]
fn set_vault(app: AppHandle, state: State<AppState>, path: String) -> Result<Snapshot, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Mappen finns inte: {path}"));
    }

    {
        let mut settings = state.settings.lock().map_err(|_| "Internt lasfel")?;
        settings.vault = Some(root.to_string_lossy().to_string());
        settings.last_note = None;
        save_settings(&app, &settings);
    }

    reindex(&state, &root);

    // Starta om bevakaren mot den nya mappen. Den gamla stangs nar den slapps.
    if let Ok(mut guard) = state.watcher.lock() {
        *guard = watcher::start(&app, root);
    }

    get_snapshot(state)
}

#[tauri::command]
fn get_tree(state: State<AppState>) -> Result<Vec<TreeNode>, String> {
    let root = root_of(&state)?;
    Ok(vault::read_tree(&root, &root))
}

#[tauri::command]
fn read_note(app: AppHandle, state: State<AppState>, path: String) -> Result<NoteContent, String> {
    let root = root_of(&state)?;
    let full = vault::safe_join(&root, &path)?;

    // Kan ta en stund om iCloud maste hamta hem filen fran molnet forst.
    let content =
        std::fs::read_to_string(&full).map_err(|e| format!("Kunde inte lasa filen: {e}"))?;

    if let Ok(mut settings) = state.settings.lock() {
        settings.last_note = Some(path.clone());
        save_settings(&app, &settings);
    }

    Ok(NoteContent {
        mtime: vault::mtime_of(&full),
        path,
        content,
    })
}

/// Sparar en anteckning. `expected_mtime` ar vad frontend tror star pa disken;
/// stammer det inte har nagon annan hunnit fore och vi skriver ingenting.
#[tauri::command]
fn write_note(
    state: State<AppState>,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
    force: bool,
) -> Result<SaveResult, String> {
    let root = root_of(&state)?;
    let full = vault::safe_join(&root, &path)?;

    if !force {
        if let Some(expected) = expected_mtime {
            let actual = vault::mtime_of(&full);
            // mtime 0 betyder att filen inte finns an -- det ar ingen konflikt.
            if actual != 0 && expected != 0 && actual != expected {
                return Ok(SaveResult {
                    mtime: actual,
                    conflict: true,
                });
            }
        }
    }

    vault::write_atomic(&full, &content)?;

    if let Some(note) = index::parse_note(&root, &full) {
        if let Ok(mut guard) = state.index.write() {
            guard.notes.insert(note.path.clone(), note);
        }
    }

    Ok(SaveResult {
        mtime: vault::mtime_of(&full),
        conflict: false,
    })
}

#[tauri::command]
fn create_note(state: State<AppState>, parent: String, name: String) -> Result<String, String> {
    let root = root_of(&state)?;
    let dir = vault::safe_join(&root, &parent)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Kunde inte skapa mappen: {e}"))?;

    let base = sanitize(&name);
    let base = if base.is_empty() { "Ny anteckning" } else { base.as_str() };
    let target = vault::unique_path(&dir, base, ".md");

    let title = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    vault::write_atomic(&target, &format!("# {title}\n\n"))?;

    reindex(&state, &root);
    Ok(vault::rel_of(&root, &target))
}

#[tauri::command]
fn create_folder(state: State<AppState>, parent: String, name: String) -> Result<String, String> {
    let root = root_of(&state)?;
    let dir = vault::safe_join(&root, &parent)?;
    let base = sanitize(&name);
    let base = if base.is_empty() { "Ny mapp" } else { base.as_str() };

    let target = vault::unique_path(&dir, base, "");
    std::fs::create_dir_all(&target).map_err(|e| format!("Kunde inte skapa mappen: {e}"))?;
    Ok(vault::rel_of(&root, &target))
}

#[tauri::command]
fn rename_entry(state: State<AppState>, path: String, new_name: String) -> Result<String, String> {
    let root = root_of(&state)?;
    let full = vault::safe_join(&root, &path)?;
    let dir = full.parent().ok_or("Saknar mapp")?.to_path_buf();

    let base = sanitize(&new_name);
    if base.is_empty() {
        return Err("Namnet far inte vara tomt".into());
    }

    let is_dir = full.is_dir();
    let ext = if is_dir { "" } else { ".md" };
    let target = dir.join(format!("{base}{ext}"));

    if target != full && target.exists() {
        return Err(format!("{base} finns redan"));
    }
    std::fs::rename(&full, &target).map_err(|e| format!("Kunde inte byta namn: {e}"))?;

    reindex(&state, &root);
    Ok(vault::rel_of(&root, &target))
}

#[tauri::command]
fn move_entry(state: State<AppState>, path: String, new_parent: String) -> Result<String, String> {
    let root = root_of(&state)?;
    let full = vault::safe_join(&root, &path)?;
    let dir = vault::safe_join(&root, &new_parent)?;

    if dir.starts_with(&full) {
        return Err("Kan inte flytta en mapp in i sig sjalv".into());
    }
    let name = full.file_name().ok_or("Saknar namn")?;
    let target = dir.join(name);
    if target == full {
        return Ok(path);
    }
    if target.exists() {
        return Err("Det finns redan nagot med det namnet dar".into());
    }

    std::fs::rename(&full, &target).map_err(|e| format!("Kunde inte flytta: {e}"))?;
    reindex(&state, &root);
    Ok(vault::rel_of(&root, &target))
}

#[tauri::command]
fn delete_entry(state: State<AppState>, path: String) -> Result<(), String> {
    let root = root_of(&state)?;
    let full = vault::safe_join(&root, &path)?;
    vault::move_to_trash(&root, &full)?;
    reindex(&state, &root);
    Ok(())
}

#[tauri::command]
fn search(state: State<AppState>, query: String) -> Result<Vec<Hit>, String> {
    read_index(&state, |i| i.search(&query))
}

#[tauri::command]
fn list_tags(state: State<AppState>) -> Result<Vec<TagCount>, String> {
    read_index(&state, |i| i.tags())
}

#[tauri::command]
fn notes_with_tag(state: State<AppState>, tag: String) -> Result<Vec<Hit>, String> {
    read_index(&state, |i| i.with_tag(&tag))
}

#[tauri::command]
fn backlinks(state: State<AppState>, path: String) -> Result<Vec<Hit>, String> {
    read_index(&state, |i| i.backlinks(&path))
}

#[tauri::command]
fn resolve_link(state: State<AppState>, target: String) -> Result<Option<String>, String> {
    read_index(&state, |i| i.resolve_link(&target))
}

/// Skapar den anteckning en [[lank]] pekar pa nar den annu inte finns.
#[tauri::command]
fn create_from_link(state: State<AppState>, target: String) -> Result<String, String> {
    let root = root_of(&state)?;
    let base = sanitize(&target);
    if base.is_empty() {
        return Err("Ogiltigt namn".into());
    }
    let path = vault::unique_path(&root, &base, ".md");
    vault::write_atomic(&path, &format!("# {base}\n\n"))?;
    reindex(&state, &root);
    Ok(vault::rel_of(&root, &path))
}

#[tauri::command]
fn refresh(state: State<AppState>) -> Result<usize, String> {
    let root = root_of(&state)?;
    reindex(&state, &root);
    Ok(state.index.read().map(|i| i.notes.len()).unwrap_or(0))
}

/// Hittar iCloud Drive om den ar installerad, sa att forsta uppstarten
/// kan foresla ratt mapp direkt.
#[tauri::command]
fn suggest_icloud() -> Option<String> {
    let home = std::env::var("USERPROFILE").ok()?;
    let candidate = PathBuf::from(home).join("iCloudDrive");
    if candidate.is_dir() {
        Some(candidate.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Tar bort tecken som Windows inte tillater i filnamn.
fn sanitize(name: &str) -> String {
    name.chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            settings: Mutex::new(Settings::default()),
            index: RwLock::new(Index::default()),
            watcher: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = load_settings(&handle);

            // Aterstall forra mappen och bygg indexet innan fonstret visas.
            if let Some(vault) = settings.vault.clone() {
                let root = PathBuf::from(&vault);
                if root.is_dir() {
                    let state = handle.state::<AppState>();
                    if let Ok(mut guard) = state.index.write() {
                        *guard = index::build(&root);
                    }
                    // Semikolonet slapper if-let-satsens temporara varden innan
                    // state gar ur scope i slutet av blocket.
                    if let Ok(mut guard) = state.watcher.lock() {
                        *guard = watcher::start(&handle, root);
                    };
                }
            }

            let state = handle.state::<AppState>();
            if let Ok(mut guard) = state.settings.lock() {
                *guard = settings;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            set_vault,
            get_tree,
            read_note,
            write_note,
            create_note,
            create_folder,
            rename_entry,
            move_entry,
            delete_entry,
            search,
            list_tags,
            notes_with_tag,
            backlinks,
            resolve_link,
            create_from_link,
            refresh,
            suggest_icloud,
        ])
        .run(tauri::generate_context!())
        .expect("Kunde inte starta Mdash");
}
