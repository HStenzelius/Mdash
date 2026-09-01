//! Indexet: en läsning av hela vaulten som håller taggar, länkar och sökbar text.
//!
//! Det bor bara i minnet och byggs om från disken. Det är avsiktligt --
//! en databas kan hamna ur synk med filerna, särskilt när iCloud ändrar dem
//! bakom ryggen på oss. Disken är alltid sanningen.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

use crate::vault::{is_hidden, is_markdown, mtime_of, rel_of};

#[derive(Debug, Clone)]
pub struct Note {
    pub path: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub mtime: u64,
}

#[derive(Debug, Default)]
pub struct Index {
    pub notes: HashMap<String, Note>,
}

#[derive(Debug, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct Hit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

/// Tar bort YAML-frontmatter och returnerar (taggar_fran_frontmatter, brodtext).
fn split_frontmatter(content: &str) -> (Vec<String>, &str) {
    let mut tags = Vec::new();
    if !content.starts_with("---") {
        return (tags, content);
    }
    let rest = &content[3..];
    let rest = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))
        .unwrap_or(rest);
    let Some(end) = rest.find("\n---") else {
        return (tags, content);
    };

    let front = &rest[..end];
    let body_start = (end + 4).min(rest.len());
    let body = rest[body_start..].trim_start_matches(['\r', '\n']);

    // Stoder bade "tags: [a, b]" och en lista med "- a" pa foljande rader.
    let mut in_tag_list = false;
    for line in front.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("tags:").map(str::trim) {
            in_tag_list = value.is_empty();
            for tag in value.trim_matches(['[', ']']).split(',') {
                let tag = tag.trim().trim_matches('"').trim_matches('\'');
                if !tag.is_empty() {
                    tags.push(tag.to_string());
                }
            }
        } else if in_tag_list {
            if let Some(tag) = trimmed.strip_prefix("- ") {
                tags.push(tag.trim().trim_matches('"').to_string());
            } else if !trimmed.is_empty() {
                in_tag_list = false;
            }
        }
    }
    (tags, body)
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '-' || c == '_' || c == '/'
}

/// Plockar ut #taggar och [[lankar]] ur brodtexten.
/// Kodblock hoppas over, annars blir varje `#include` en tagg.
fn scan_body(body: &str) -> (Vec<String>, Vec<String>) {
    let mut tags: Vec<String> = Vec::new();
    let mut links: Vec<String> = Vec::new();
    let mut in_code_fence = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_fence = !in_code_fence;
            continue;
        }
        if in_code_fence {
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        let mut in_inline_code = false;

        while i < chars.len() {
            let c = chars[i];

            if c == '`' {
                in_inline_code = !in_inline_code;
                i += 1;
                continue;
            }
            if in_inline_code {
                i += 1;
                continue;
            }

            // [[Lank till annan anteckning]], eventuellt med |alias eller #rubrik
            if c == '[' && i + 1 < chars.len() && chars[i + 1] == '[' {
                let mut j = i + 2;
                let mut raw = String::new();
                while j + 1 < chars.len() && !(chars[j] == ']' && chars[j + 1] == ']') {
                    raw.push(chars[j]);
                    j += 1;
                }
                if j + 1 < chars.len() {
                    let target = raw
                        .split('|')
                        .next()
                        .unwrap_or("")
                        .split('#')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if !target.is_empty() && !links.contains(&target) {
                        links.push(target);
                    }
                    i = j + 2;
                    continue;
                }
            }

            // #tagg -- maste sta efter blanksteg och borja med en bokstav,
            // vilket samtidigt utesluter "# Rubrik" och "#123".
            if c == '#' {
                let prev_ok = i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '(';
                let next_ok = chars
                    .get(i + 1)
                    .is_some_and(|n| n.is_alphabetic() || *n == '_');
                if prev_ok && next_ok {
                    let mut j = i + 1;
                    let mut tag = String::new();
                    while j < chars.len() && is_tag_char(chars[j]) {
                        tag.push(chars[j]);
                        j += 1;
                    }
                    let tag = tag.trim_end_matches('/').to_string();
                    if !tag.is_empty() && !tags.contains(&tag) {
                        tags.push(tag);
                    }
                    i = j;
                    continue;
                }
            }
            i += 1;
        }
    }
    (tags, links)
}

pub fn parse_note(root: &Path, path: &Path) -> Option<Note> {
    let content = std::fs::read_to_string(path).ok()?;
    let (mut tags, body) = split_frontmatter(&content);
    let (body_tags, links) = scan_body(body);

    for tag in body_tags {
        if !tags.contains(&tag) {
            tags.push(tag);
        }
    }

    let title = path.file_stem()?.to_string_lossy().to_string();
    Some(Note {
        path: rel_of(root, path),
        title,
        mtime: mtime_of(path),
        tags,
        links,
        content,
    })
}

/// Laser om hela vaulten. Vaults i den har storleksordningen (tusentals
/// anteckningar) skannas pa under en sekund, sa inkrementell uppdatering
/// vore mer komplexitet an det ar vart.
pub fn build(root: &Path) -> Index {
    let mut notes = HashMap::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_str().is_some_and(is_hidden))
        .flatten()
    {
        let path = entry.path();
        if path.is_file() && is_markdown(path) {
            if let Some(note) = parse_note(root, path) {
                notes.insert(note.path.clone(), note);
            }
        }
    }
    Index { notes }
}

impl Index {
    pub fn tags(&self) -> Vec<TagCount> {
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for note in self.notes.values() {
            for tag in &note.tags {
                *counts.entry(tag.as_str()).or_insert(0) += 1;
            }
        }
        let mut out: Vec<TagCount> = counts
            .into_iter()
            .map(|(tag, count)| TagCount {
                tag: tag.to_string(),
                count,
            })
            .collect();
        out.sort_by(|a, b| a.tag.to_lowercase().cmp(&b.tag.to_lowercase()));
        out
    }

    pub fn with_tag(&self, tag: &str) -> Vec<Hit> {
        let needle = tag.to_lowercase();
        let mut out: Vec<Hit> = self
            .notes
            .values()
            .filter(|n| {
                n.tags.iter().any(|t| {
                    let t = t.to_lowercase();
                    t == needle || t.starts_with(&format!("{needle}/"))
                })
            })
            .map(|n| Hit {
                path: n.path.clone(),
                title: n.title.clone(),
                snippet: first_line(&n.content),
            })
            .collect();
        out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        out
    }

    /// Fritextsokning. Traffar i titeln rankas fore traffar i brodtexten.
    pub fn search(&self, query: &str) -> Vec<Hit> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }

        let mut scored: Vec<(u8, Hit)> = Vec::new();
        for note in self.notes.values() {
            let title = note.title.to_lowercase();
            if title.contains(&needle) {
                let rank = if title.starts_with(&needle) { 0 } else { 1 };
                scored.push((
                    rank,
                    Hit {
                        path: note.path.clone(),
                        title: note.title.clone(),
                        snippet: first_line(&note.content),
                    },
                ));
            } else if let Some(pos) = note.content.to_lowercase().find(&needle) {
                scored.push((
                    2,
                    Hit {
                        path: note.path.clone(),
                        title: note.title.clone(),
                        snippet: snippet_around(&note.content, pos),
                    },
                ));
            }
        }

        scored.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then(a.1.title.to_lowercase().cmp(&b.1.title.to_lowercase()))
        });
        scored.into_iter().take(60).map(|(_, hit)| hit).collect()
    }

    /// Vilken anteckning pekar [[malet]] pa? Matchar pa filnamn forst,
    /// sedan pa hela sokvagen, bada skiftlagesokansligt.
    pub fn resolve_link(&self, target: &str) -> Option<String> {
        let needle = target.trim().to_lowercase();
        let by_path = format!("{needle}.md");
        self.notes
            .values()
            .find(|n| n.title.to_lowercase() == needle)
            .or_else(|| self.notes.values().find(|n| n.path.to_lowercase() == by_path))
            .map(|n| n.path.clone())
    }

    /// Anteckningar som lankar hit.
    pub fn backlinks(&self, path: &str) -> Vec<Hit> {
        let Some(note) = self.notes.get(path) else {
            return Vec::new();
        };
        let title = note.title.to_lowercase();

        let mut out: Vec<Hit> = self
            .notes
            .values()
            .filter(|other| other.path != path)
            .filter(|other| other.links.iter().any(|l| l.trim().to_lowercase() == title))
            .map(|other| Hit {
                path: other.path.clone(),
                title: other.title.clone(),
                snippet: context_of_link(&other.content, &note.title),
            })
            .collect();
        out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        out
    }
}

fn first_line(content: &str) -> String {
    let (_, body) = split_frontmatter(content);
    body.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .unwrap_or("")
        .chars()
        .take(120)
        .collect()
}

fn snippet_around(content: &str, pos: usize) -> String {
    let start = content[..pos].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let end = content[pos..]
        .find('\n')
        .map(|i| pos + i)
        .unwrap_or(content.len());
    content[start..end].trim().chars().take(140).collect()
}

fn context_of_link(content: &str, title: &str) -> String {
    let needle = format!("[[{}", title.to_lowercase());
    content
        .lines()
        .find(|l| l.to_lowercase().contains(&needle))
        .unwrap_or("")
        .trim()
        .chars()
        .take(140)
        .collect()
}
