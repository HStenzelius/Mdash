//! Bevakar vaulten pa disken.
//!
//! iCloud, Utforskaren och andra datorer andrar filerna bakom ryggen pa oss --
//! det ar normalfallet, inte ett undantag. Vi bygger om indexet och sager till
//! granssnittet, som i sin tur avgor om den oppna anteckningen behover laddas om.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::{index, AppState};

/// Filsystemhandelser kommer i skurar -- ett sparande kan ge tre notiser.
/// Vi vantar tills det varit tyst en stund innan vi gor nagot.
const SETTLE: Duration = Duration::from_millis(350);

pub fn start(app: &AppHandle, root: PathBuf) -> Option<RecommendedWatcher> {
    let (tx, rx) = channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let relevant = event.paths.iter().any(|p| {
                // Vara egna temporarfiler och papperskorgen ska inte trigga omlasning.
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                !name.ends_with(".mdash-tmp")
                    && !p.components().any(|c| c.as_os_str() == ".trash")
            });
            if relevant {
                let _ = tx.send(());
            }
        }
    })
    .ok()?;

    watcher.watch(&root, RecursiveMode::Recursive).ok()?;

    let app = app.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // Tomma kon tills det varit tyst i SETTLE millisekunder.
            loop {
                match rx.recv_timeout(SETTLE) {
                    Ok(()) => continue,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }

            let state = app.state::<AppState>();
            let root = state.settings.lock().ok().and_then(|s| s.vault.clone());
            let Some(root) = root else { continue };

            let fresh = index::build(std::path::Path::new(&root));
            if let Ok(mut guard) = state.index.write() {
                *guard = fresh;
            }
            let _ = app.emit("vault-changed", ());
        }
    });

    Some(watcher)
}
