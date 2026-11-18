//! Durable, account-scoped copies of JSON reads. No authentication endpoints or tokens.
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::auth::Target;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_BODY: usize = 64 * 1024 * 1024;

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
pub(crate) fn server(target: &Target) -> Result<String, String> {
    let mut url = target.base()?;
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_owned())
}
pub fn allowed(path: &str) -> bool {
    // Encoded path aliases are never persisted, including aliases of auth routes.
    let path = path.split('?').next().unwrap_or(path).to_ascii_lowercase();
    !path.contains('%') && path != "/v1/auth" && !path.starts_with("/v1/auth/")
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Entry {
    #[serde(default)]
    pub offline_copy: Option<String>,
    pub path: String,
    pub etag: Option<String>,
    pub stored_at: String,
    #[serde(default)]
    pub checked_at: Option<String>,
    pub body: Value,
    #[serde(default)]
    pub next_cursor: Option<String>,
}
impl Entry {
    pub fn as_of(&self) -> String {
        self.checked_at.as_ref().unwrap_or(&self.stored_at).clone()
    }
}
#[derive(Default, Deserialize, Serialize)]
struct Info {
    checked_at: Option<String>,
    offline_copy: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct Meta {
    #[serde(default)]
    offline_copy: Option<String>,
    server: String,
    account_id: Value,
    account: Value,
    updated_at: String,
}
#[derive(Default, Debug, Serialize)]
pub struct Status {
    entries: usize,
    bytes: u64,
    newest: Option<String>,
    oldest: Option<String>,
}
#[derive(Default)]
struct Inner {
    root: Option<PathBuf>,
    epoch: u64,
    bytes: Option<u64>,
}
#[derive(Default)]
pub struct ReadCache(Mutex<Inner>);

fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}
fn private_dir(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        if let Some(parent) = path.parent() {
            private_dir(parent)?;
        }
        fs::create_dir(path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(())
}
fn private_file(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}
fn atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    private_dir(path.parent().unwrap())?;
    let temp = path.with_extension("tmp");
    let result = (|| {
        let mut file = private_file(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
// Usage is expendable: no fsync, and at most one touch per minute per entry.
fn touch(path: &Path) {
    if fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age.as_secs() < 60)
    {
        return;
    }
    let _ = private_file(path);
}
// Preserve ordinary account ids; encode every unsafe byte, including dots and slashes.
fn account_folder(id: &str) -> String {
    id.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
fn json(path: &Path, value: &impl Serialize) -> std::io::Result<()> {
    atomic(path, &serde_json::to_vec(value)?)
}
impl Inner {
    fn server_scope(&self, target: &Target) -> Result<PathBuf, String> {
        Ok(self
            .root
            .as_ref()
            .ok_or("saved reads are unavailable")?
            .join(hash(&server(target)?)))
    }
    fn current(&self, target: &Target) -> HashMap<String, String> {
        self.server_scope(target)
            .ok()
            .and_then(|p| read(&p.join("current.json")))
            .unwrap_or_default()
    }
    fn scope(&self, target: &Target) -> Result<PathBuf, String> {
        let id = self
            .current(target)
            .get(&target.key)
            .cloned()
            .ok_or("no confirmed account")?;
        Ok(self.server_scope(target)?.join(account_folder(&id)))
    }
}
impl ReadCache {
    pub fn configure(&self, app_data: PathBuf) {
        let root = app_data.join("read-cache/v1");
        let _ = private_dir(&root);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [app_data.join("read-cache"), root.clone()] {
                let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
            }
        }
        self.0.lock().unwrap().root = Some(root);
    }
    pub fn epoch(&self) -> u64 {
        self.0.lock().unwrap().epoch
    }
    pub fn load(&self, target: &Target, path: &str) -> Option<Entry> {
        if !allowed(path) {
            return None;
        }
        let inner = self.0.lock().ok()?;
        let scope = inner.scope(target).ok()?;
        let file = scope.join("entries").join(format!("{}.json", hash(path)));
        let mut entry: Entry = read(&file)?;
        if let Some(info) = read::<Info>(&file.with_extension("info")) {
            entry.checked_at = info.checked_at;
            entry.offline_copy = info.offline_copy;
        }
        if entry.path != path {
            return None;
        }
        // Tiny usage marker: reading a 64 MB entry never rewrites its body.
        touch(&file.with_extension("used"));
        Some(entry)
    }
    pub fn store(&self, target: &Target, entry: &Entry, epoch: u64) {
        self.store_limited(target, entry, epoch, MAX_BODY, MAX_BYTES);
    }
    fn store_limited(&self, target: &Target, entry: &Entry, epoch: u64, max_body: usize, cap: u64) {
        if !allowed(&entry.path) {
            return;
        }
        let Ok(body) = serde_json::to_vec(&entry.body) else {
            return;
        };
        if body.len() > max_body {
            return;
        }
        let mut inner = self.0.lock().unwrap();
        if epoch != inner.epoch {
            return;
        } // A sign-out/account change won the race.
        let Ok(scope) = inner.scope(target) else {
            return;
        };
        let path = scope
            .join("entries")
            .join(format!("{}.json", hash(&entry.path)));
        let before = entry_bytes(&path);
        if let Err(e) = json(&path, entry) {
            log::warn!("could not save read: {e}");
            return;
        }
        touch(&path.with_extension("used"));
        let _ = json(
            &path.with_extension("info"),
            &Info {
                checked_at: Some(entry.as_of()),
                offline_copy: entry.offline_copy.clone(),
            },
        );
        if let Some(root) = &inner.root {
            let mut bytes = inner
                .bytes
                .map(|bytes| bytes.saturating_sub(before) + entry_bytes(&path))
                .unwrap_or_else(|| disk_bytes(root));
            if bytes > cap {
                evict(root, cap);
                bytes = disk_bytes(root);
            }
            inner.bytes = Some(bytes);
        }
    }
    pub fn account(&self, target: &Target) -> Option<Value> {
        let inner = self.0.lock().ok()?;
        let scope = inner.scope(target).ok()?;
        read::<Meta>(&scope.join("meta.json")).map(|m| m.account)
    }
    #[cfg(test)]
    pub fn adopt(&self, target: &Target, account: &Value) -> Result<(), String> {
        self.adopt_with_copy(target, account, None)
    }
    pub fn account_copy(&self, target: &Target) -> Option<String> {
        let inner = self.0.lock().ok()?;
        read::<Meta>(&inner.scope(target).ok()?.join("meta.json"))?.offline_copy
    }
    pub fn adopt_with_copy(
        &self,
        target: &Target,
        account: &Value,
        offline_copy: Option<String>,
    ) -> Result<(), String> {
        let mut inner = self.0.lock().unwrap();
        if inner.root.is_none() {
            return Ok(());
        }
        let id = account
            .get("id")
            .or_else(|| account.get("username"))
            .and_then(|v| match v {
                Value::String(s) if !s.is_empty() => Some(s.clone()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .ok_or("account has no id")?;
        let server_scope = inner.server_scope(target)?;
        let mut current = inner.current(target);
        if current.get(&target.key) != Some(&id) {
            inner.epoch += 1;
        }
        let scope = server_scope.join(account_folder(&id));
        json(
            &scope.join("meta.json"),
            &Meta {
                offline_copy,
                server: server(target)?,
                account_id: Value::String(id.clone()),
                account: account.clone(),
                updated_at: now(),
            },
        )
        .map_err(|e| e.to_string())?;
        current.insert(target.key.clone(), id);
        json(&server_scope.join("current.json"), &current).map_err(|e| e.to_string())?;
        inner.bytes = None;
        Ok(())
    }
    /// Sign-out/revocation hides copies without removing any account's folder.
    pub fn hide(&self, target: &Target) -> Result<(), String> {
        let mut inner = self.0.lock().unwrap();
        inner.epoch += 1;
        if inner.root.is_none() {
            return Ok(());
        }
        let mut current = inner.current(target);
        current.remove(&target.key);
        let path = inner.server_scope(target)?.join("current.json");
        if current.is_empty() {
            match fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        } else {
            json(&path, &current).map_err(|e| e.to_string())
        }
    }
    pub fn clear(&self, target: &Target) -> Result<(), String> {
        let mut inner = self.0.lock().unwrap();
        inner.epoch += 1;
        inner.bytes = None;
        if let Ok(scope) = inner.scope(target) {
            remove(&scope)?;
        }
        Ok(())
    }
    /// A 304 updates only the small sidecar, never the saved body.
    pub fn revalidate(&self, target: &Target, entry: &Entry, epoch: u64) {
        let inner = self.0.lock().unwrap();
        if inner.epoch != epoch {
            return;
        }
        if let Ok(scope) = inner.scope(target) {
            let path = scope
                .join("entries")
                .join(format!("{}.info", hash(&entry.path)));
            let _ = json(
                &path,
                &Info {
                    checked_at: entry.checked_at.clone(),
                    offline_copy: entry.offline_copy.clone(),
                },
            );
        }
    }
    pub fn status(&self, target: &Target) -> Result<Status, String> {
        let inner = self.0.lock().unwrap();
        let mut status = Status::default();
        let Ok(scope) = inner.scope(target) else {
            return Ok(status);
        };
        status.bytes = files(&scope)
            .iter()
            .map(|p| fs::metadata(p).map(|m| m.len()).unwrap_or(0))
            .sum();
        for file in files(&scope.join("entries")) {
            if file.extension().is_none_or(|e| e != "json") {
                continue;
            }
            status.entries += 1;
            if let Some(as_of) =
                read::<Info>(&file.with_extension("info")).and_then(|i| i.checked_at)
            {
                if status.newest.as_ref().is_none_or(|d| d < &as_of) {
                    status.newest = Some(as_of.clone());
                }
                if status.oldest.as_ref().is_none_or(|d| d > &as_of) {
                    status.oldest = Some(as_of);
                }
            }
        }
        Ok(status)
    }
}
fn remove(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
fn files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for item in entries.flatten() {
            if let Ok(ty) = item.file_type() {
                if ty.is_dir() {
                    out.extend(files(&item.path()));
                } else if ty.is_file() {
                    out.push(item.path());
                }
            }
        }
    }
    out
}
fn disk_bytes(root: &Path) -> u64 {
    files(root)
        .iter()
        .map(|p| fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .sum()
}
fn entry_bytes(path: &Path) -> u64 {
    [
        path.to_path_buf(),
        path.with_extension("info"),
        path.with_extension("used"),
    ]
    .iter()
    .map(|p| fs::metadata(p).map(|m| m.len()).unwrap_or(0))
    .sum()
}
fn evict(root: &Path, cap: u64) {
    let all = files(root);
    let mut bytes: u64 = all
        .iter()
        .map(|p| fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .sum();
    if bytes <= cap {
        return;
    }
    let mut entries: Vec<_> = all
        .into_iter()
        .filter(|p| {
            p.parent().is_some_and(|p| p.ends_with("entries"))
                && p.extension().is_some_and(|e| e == "json")
        })
        .collect();
    entries.sort_by_key(|p| {
        fs::metadata(p.with_extension("used"))
            .or_else(|_| fs::metadata(p))
            .and_then(|m| m.modified())
            .ok()
    });
    for path in entries {
        for p in [
            path.clone(),
            path.with_extension("used"),
            path.with_extension("info"),
        ] {
            let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            if fs::remove_file(p).is_ok() {
                bytes = bytes.saturating_sub(size);
            }
        }
        if bytes <= cap {
            break;
        }
    }
}

#[derive(Default, Debug, Serialize)]
pub struct Prefetched {
    fetched: usize,
    unchanged: usize,
    failed: usize,
}
#[tauri::command]
pub async fn cache_status(
    identity: tauri::State<'_, crate::auth::Identity>,
    target: Target,
) -> Result<Status, String> {
    identity.cache.status(&target)
}
#[tauri::command]
pub async fn cache_clear(
    identity: tauri::State<'_, crate::auth::Identity>,
    target: Target,
) -> Result<(), String> {
    identity.cache.clear(&target)
}
#[tauri::command]
pub async fn cache_prefetch(
    identity: tauri::State<'_, crate::auth::Identity>,
    oversight: tauri::State<'_, crate::bridge::OversightState>,
    target: Target,
    paths: Vec<String>,
) -> Result<Prefetched, String> {
    prefetch_if(&identity, &target, paths, || oversight.writable().is_ok()).await
}
#[cfg(test)]
pub async fn prefetch(
    identity: &crate::auth::Identity,
    target: &Target,
    paths: Vec<String>,
) -> Result<Prefetched, String> {
    prefetch_if(identity, target, paths, || true).await
}
async fn prefetch_if(
    identity: &crate::auth::Identity,
    target: &Target,
    paths: Vec<String>,
    current: impl Fn() -> bool,
) -> Result<Prefetched, String> {
    if paths.len() > 400 {
        return Err("at most 400 saved read paths are allowed".into());
    }
    for path in &paths {
        target.base()?;
        if !crate::auth::valid_api_path(path.split('?').next().unwrap_or(path)) || !allowed(path) {
            return Err(format!("refused API path {path:?}"));
        }
    }
    // Mount results identify the sessions Review reads next. Reuse that reply
    // to enqueue their stored tables, with the same global 400-path bound.
    let seen: std::collections::HashSet<String> = paths.iter().cloned().collect();
    let queue = Mutex::new((std::collections::VecDeque::from(paths), seen));
    let stopped = std::sync::atomic::AtomicBool::new(false);
    let epoch = identity.cache.epoch();
    let worker = || async {
        use std::sync::atomic::Ordering::SeqCst;
        let mut counts = Prefetched::default();
        while current() && !stopped.load(SeqCst) && epoch == identity.cache.epoch() {
            let path = queue.lock().unwrap().0.pop_front();
            let Some(path) = path else {
                break;
            };
            match identity.get(target, &path).await {
                Ok(reply)
                    if reply
                        .cached
                        .as_ref()
                        .is_some_and(|c| c.reason == "unreachable") =>
                {
                    counts.failed += 1;
                    stopped.store(true, SeqCst);
                }
                Err(_) => {
                    counts.failed += 1;
                    stopped.store(true, SeqCst);
                }
                Ok(reply)
                    if reply.cached.is_some() || reply.status != 200 || reply.error.is_some() =>
                {
                    counts.failed += 1
                }
                Ok(reply) => {
                    if reply.revalidated {
                        counts.unchanged += 1;
                    } else {
                        counts.fetched += 1;
                    }
                    if path.starts_with("/v1/mounts/") && path.ends_with("/results") {
                        if let Some(spots) = reply.body.get("spots").and_then(Value::as_array) {
                            let mut queue = queue.lock().unwrap();
                            for id in spots
                                .iter()
                                .filter_map(|s| s.get("session_id").and_then(Value::as_str))
                            {
                                if id.len() > 128
                                    || id.is_empty()
                                    || !id
                                        .chars()
                                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                                {
                                    continue;
                                }
                                for tail in ["results?run=preferred", "acquisitions"] {
                                    let path = format!("/v1/sessions/{id}/{tail}");
                                    if queue.1.len() < 400 && queue.1.insert(path.clone()) {
                                        queue.0.push_back(path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        counts
    };
    let (a, b, c) = tokio::join!(worker(), worker(), worker());
    Ok(Prefetched {
        fetched: a.fetched + b.fetched + c.fetched,
        unchanged: a.unchanged + b.unchanged + c.unchanged,
        failed: a.failed + b.failed + c.failed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{
        tests::{fake_server, raw_server},
        Identity, MemoryVault,
    };
    use std::io::Write;
    fn setup(server: String) -> (tempfile::TempDir, Identity, Target) {
        let dir = tempfile::tempdir().unwrap();
        let identity = Identity::with_vault(Box::new(MemoryVault::default()));
        identity.cache.configure(dir.path().into());
        let target = Target {
            key: "invented-test-account".into(),
            server,
        };
        identity.adopt(&target, serde_json::json!({"token":"invented-token", "account":{"id":"one","username":"invented"}})).unwrap();
        (dir, identity, target)
    }
    fn entry(path: &str) -> Entry {
        Entry {
            offline_copy: None,
            path: path.into(),
            etag: Some("\"first\"".into()),
            stored_at: now(),
            checked_at: None,
            next_cursor: None,
            body: serde_json::json!([{"id":"invented"}]),
        }
    }
    #[tokio::test]
    async fn read_cache_prefetch_stops_before_reading_an_inactive_scope() {
        let (_dir, identity, target) = setup("https://invented.invalid".into());
        let counts = prefetch_if(
            &identity,
            &target,
            vec!["/v1/sessions?limit=500".into()],
            || false,
        )
        .await
        .unwrap();
        assert_eq!(counts.fetched + counts.unchanged + counts.failed, 0);
    }
    #[test]
    fn read_cache_hide_switch_and_forget_isolate_accounts_and_target_keys() {
        let (dir, identity, target) = setup("https://example.invalid/".into());
        let cache = &identity.cache;
        cache
            .adopt_with_copy(
                &target,
                &serde_json::json!({"id":"one"}),
                Some("invented copy".into()),
            )
            .unwrap();
        let reopened = ReadCache::default();
        reopened.configure(dir.path().into());
        assert_eq!(
            reopened.account_copy(&target).as_deref(),
            Some("invented copy")
        );
        let saved = entry("/v1/sessions");
        cache.store(&target, &saved, cache.epoch());
        let first_scope = cache.0.lock().unwrap().scope(&target).unwrap();
        let old_epoch = cache.epoch();
        cache.hide(&target).unwrap();
        assert!(first_scope.exists());
        assert!(cache.load(&target, &saved.path).is_none());
        assert!(cache.account(&target).is_none());
        assert_eq!(cache.status(&target).unwrap().entries, 0);
        cache
            .adopt(&target, &serde_json::json!({"id":"two"}))
            .unwrap();
        cache.store(&target, &saved, old_epoch);
        assert!(cache.load(&target, &saved.path).is_none());
        let mut other = saved.clone();
        other.body = serde_json::json!(["second account"]);
        cache.store(&target, &other, cache.epoch());
        let second_scope = cache.0.lock().unwrap().scope(&target).unwrap();
        let mut alias = target.clone();
        alias.key = "another-key".into();
        assert!(cache.load(&alias, &saved.path).is_none());
        cache
            .adopt(&alias, &serde_json::json!({"id":"one"}))
            .unwrap();
        assert_eq!(cache.load(&alias, &saved.path).unwrap().body, saved.body);
        cache.hide(&alias).unwrap();
        assert_eq!(cache.load(&target, &saved.path).unwrap().body, other.body);
        cache.clear(&target).unwrap();
        assert!(!second_scope.exists());
        assert!(first_scope.exists());
        cache
            .adopt(&target, &serde_json::json!({"id":"one"}))
            .unwrap();
        let fresh = ReadCache::default();
        fresh.configure(dir.path().into());
        assert_eq!(fresh.load(&target, &saved.path).unwrap().body, saved.body);
        // Revalidation/reads must leave both body bytes and mtime untouched.
        let body = first_scope
            .join("entries")
            .join(format!("{}.json", hash(&saved.path)));
        let before = fs::read(&body).unwrap();
        let mtime = fs::metadata(&body).unwrap().modified().unwrap();
        let used = body.with_extension("used");
        let usage = fs::metadata(&used).unwrap().modified().unwrap();
        let mut checked = saved;
        checked.checked_at = Some("2099-01-01T00:00:00Z".into());
        checked.offline_copy = Some("invented read-only copy".into());
        fresh.revalidate(&target, &checked, fresh.epoch());
        let loaded = fresh.load(&target, &checked.path).unwrap();
        assert_eq!(loaded.checked_at, checked.checked_at);
        assert_eq!(loaded.offline_copy, checked.offline_copy);
        assert_eq!(fs::read(&body).unwrap(), before);
        assert_eq!(fs::metadata(body).unwrap().modified().unwrap(), mtime);
        assert_eq!(fs::metadata(used).unwrap().modified().unwrap(), usage);
    }
    #[test]
    #[cfg(unix)]
    fn read_cache_permissions_are_private_and_ids_cannot_escape() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, identity, target) = setup("https://example.invalid".into());
        identity
            .cache
            .adopt(&target, &serde_json::json!({"id":"../../other"}))
            .unwrap();
        identity
            .cache
            .store(&target, &entry("/v1/sessions"), identity.cache.epoch());
        for path in files(dir.path()) {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let inner = identity.cache.0.lock().unwrap();
        let scope = inner.scope(&target).unwrap();
        assert_eq!(
            scope.parent().unwrap(),
            inner.server_scope(&target).unwrap()
        );
        for path in [
            dir.path().join("read-cache"),
            dir.path().join("read-cache/v1"),
            inner.server_scope(&target).unwrap(),
            scope.clone(),
            scope.join("entries"),
        ] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }
    #[tokio::test]
    async fn read_cache_stores_then_serves_unreachable() {
        let server = raw_server(|mut stream, _| {
            let body = "[{\"id\":\"invented\"}]";
            write!(stream, "HTTP/1.1 200 OK\r\nETag: \"first\"\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let (_dir, identity, target) = setup(server);
        let reply = identity.get(&target, "/v1/sessions").await.unwrap();
        assert!(reply.cached.is_none());
        let saved = identity.cache.load(&target, "/v1/sessions").unwrap();
        assert_eq!(saved.etag.as_deref(), Some("\"first\""));
        let reply = identity.get(&target, "/v1/sessions").await.unwrap();
        let serialized = serde_json::to_value(&reply).unwrap();
        assert!(serialized["cached"]["asOf"].is_string());
        assert!(serialized.get("etag").is_none());
        assert_eq!(reply.body, saved.body);
        assert_eq!(reply.cached.unwrap().reason, "unreachable");
        assert!(identity
            .get(&target, "/v1/missing")
            .await
            .unwrap_err()
            .contains("unreachable"));
        let state = identity.restore(&target).await.unwrap();
        let serialized = serde_json::to_value(state).unwrap();
        assert_eq!(serialized["account"]["username"], "invented");
        assert_eq!(serialized["offline"], true);
    }
    #[tokio::test]
    async fn read_cache_revalidates_and_304_is_live() {
        let server = raw_server(|mut stream, request| {
            assert!(request.to_lowercase().contains("if-none-match: \"first\""));
            write!(
                stream,
                "HTTP/1.1 304 Not Modified\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });
        let (_dir, identity, target) = setup(server);
        let saved = entry("/v1/sessions");
        identity
            .cache
            .store(&target, &saved, identity.cache.epoch());
        let body_file = identity
            .cache
            .0
            .lock()
            .unwrap()
            .scope(&target)
            .unwrap()
            .join("entries")
            .join(format!("{}.json", hash(&saved.path)));
        let before = fs::metadata(&body_file).unwrap().modified().unwrap();
        let used = body_file.with_extension("used");
        let used_before = fs::metadata(&used).unwrap().modified().unwrap();
        let reply = identity.get(&target, &saved.path).await.unwrap();
        assert_eq!(
            fs::metadata(&body_file).unwrap().modified().unwrap(),
            before
        );
        assert_eq!(fs::metadata(used).unwrap().modified().unwrap(), used_before);
        assert_eq!(reply.status, 200);
        assert!(reply.cached.is_none());
        assert!(reply.revalidated);
        let updated = identity.cache.load(&target, &saved.path).unwrap();
        assert_eq!(saved.stored_at, updated.stored_at);
        assert!(updated.checked_at.is_some());
    }
    #[tokio::test]
    async fn read_cache_server_errors_and_4xx() {
        let server = fake_server(5, |request, _, _| {
            if request.contains("/503 ") {
                (503, "proxy unavailable".into())
            } else if request.contains("/500 ") {
                (500, "<html>proxy problem</html>".into())
            } else if request.contains("/401 ") {
                (401, "{}".into())
            } else if request.contains("/403 ") {
                (403, "{}".into())
            } else {
                (404, "{}".into())
            }
        });
        let (_dir, identity, target) = setup(server);
        for status in [503, 500, 401, 403, 404] {
            let saved = entry(&format!("/v1/{status}"));
            identity
                .cache
                .store(&target, &saved, identity.cache.epoch());
            let reply = identity.get(&target, &saved.path).await.unwrap();
            if status >= 500 {
                let cached = reply.cached.unwrap();
                assert_eq!(cached.reason, "server_error");
                assert!(cached.detail.contains(&status.to_string()));
            } else {
                assert_eq!(reply.status, status);
                assert!(reply.cached.is_none());
            }
        }
    }
    #[tokio::test]
    async fn read_cache_logout_revocation_and_account_switch_keep_hidden_copies() {
        let server = fake_server(1, |_, _, _| (401, "{}".into()));
        let (_dir, identity, target) = setup(server);
        let saved = entry("/v1/sessions");
        identity
            .cache
            .store(&target, &saved, identity.cache.epoch());
        let first_scope = identity.cache.0.lock().unwrap().scope(&target).unwrap();
        identity.restore(&target).await.unwrap();
        assert!(first_scope.exists());
        assert_eq!(identity.cache.status(&target).unwrap().entries, 0);
        assert!(identity.cache.account(&target).is_none());
        identity
            .adopt(
                &target,
                serde_json::json!({"token":"invented-token", "account":{"id":"one"}}),
            )
            .unwrap();
        let old_epoch = identity.cache.epoch();
        identity.cache.store(&target, &saved, old_epoch);
        identity
            .adopt(
                &target,
                serde_json::json!({"token":"another-invented-token", "account":{"id":"two"}}),
            )
            .unwrap();
        assert!(identity.cache.load(&target, &saved.path).is_none());
        identity.cache.store(&target, &saved, old_epoch);
        assert!(identity.cache.load(&target, &saved.path).is_none());
        identity
            .cache
            .store(&target, &saved, identity.cache.epoch());
        let second_scope = identity.cache.0.lock().unwrap().scope(&target).unwrap();
        identity.logout(&target).await.unwrap();
        assert!(second_scope.exists());
        assert_eq!(identity.cache.status(&target).unwrap().entries, 0);
        assert!(identity.cache.load(&target, &saved.path).is_none());
        identity
            .cache
            .adopt(&target, &serde_json::json!({"id":"one"}))
            .unwrap();
        assert!(identity.cache.load(&target, &saved.path).is_some());
        identity.cache.clear(&target).unwrap();
        assert!(!first_scope.exists());
        assert!(second_scope.exists());
        identity
            .cache
            .adopt(&target, &serde_json::json!({"id":"two"}))
            .unwrap();
        assert!(identity.cache.load(&target, &saved.path).is_some());
    }
    #[test]
    fn read_cache_atomic_auth_exclusion_scope_and_eviction() {
        let (dir, identity, target) = setup("https://example.invalid/".into());
        for path in [
            "/v1/auth/login",
            "/v1/auth/providers",
            "/v1/auth",
            "/v1/%61uth/login",
        ] {
            identity
                .cache
                .store(&target, &entry(path), identity.cache.epoch());
            assert!(identity.cache.load(&target, path).is_none());
        }
        let old = entry("/v1/old");
        identity.cache.store(&target, &old, identity.cache.epoch());
        std::thread::sleep(std::time::Duration::from_millis(10));
        identity
            .cache
            .store(&target, &entry("/v1/new"), identity.cache.epoch());
        std::thread::sleep(std::time::Duration::from_millis(10));
        let old_file = identity
            .cache
            .0
            .lock()
            .unwrap()
            .scope(&target)
            .unwrap()
            .join("entries")
            .join(format!("{}.used", hash(&old.path)));
        fs::remove_file(old_file).unwrap();
        identity.cache.load(&target, &old.path); // oldest stored body was most recently used
        let scope = identity.cache.0.lock().unwrap().scope(&target).unwrap();
        let newest_size = fs::metadata(
            scope
                .join("entries")
                .join(format!("{}.json", hash("/v1/new"))),
        )
        .unwrap()
        .len();
        evict(
            &dir.path().join("read-cache/v1"),
            disk_bytes(&dir.path().join("read-cache/v1")) - newest_size,
        );
        assert!(identity.cache.load(&target, "/v1/new").is_none());
        assert!(identity.cache.load(&target, &old.path).is_some());
        assert!(files(dir.path())
            .iter()
            .all(|p| p.extension().is_none_or(|e| e != "tmp")));
        let mut alias = target.clone();
        alias.server = "https://example.invalid".into();
        assert!(identity.cache.load(&alias, &old.path).is_some());
        alias.key = "different-entry".into();
        assert!(identity.cache.load(&alias, &old.path).is_none());
        let text = String::from_utf8(fs::read(scope.join("meta.json")).unwrap()).unwrap();
        assert!(!text.contains("invented-token"));
    }
    #[test]
    fn read_cache_reopens_durably_and_changes_accounts_without_old_entries() {
        let (dir, identity, target) = setup("https://example.invalid".into());
        let saved = entry("/v1/sessions");
        identity
            .cache
            .store(&target, &saved, identity.cache.epoch());
        let reopened = ReadCache::default();
        reopened.configure(dir.path().into());
        assert_eq!(
            reopened.load(&target, &saved.path).unwrap().body,
            saved.body
        );
        reopened
            .adopt(&target, &serde_json::json!({"id":"different"}))
            .unwrap();
        assert!(reopened.load(&target, &saved.path).is_none());
        assert_eq!(reopened.account(&target).unwrap()["id"], "different");
        reopened.clear(&target).unwrap();
        assert!(reopened.account(&target).is_none());
    }
    #[test]
    fn read_cache_body_limit_and_global_cap_use_the_same_store_path() {
        let (_dir, identity, target) = setup("https://example.invalid".into());
        let saved = entry("/v1/too-large");
        identity
            .cache
            .store_limited(&target, &saved, identity.cache.epoch(), 4, MAX_BYTES);
        assert!(identity.cache.load(&target, &saved.path).is_none());
        let first = entry("/v1/first");
        identity
            .cache
            .store_limited(&target, &first, identity.cache.epoch(), MAX_BODY, MAX_BYTES);
        let first_size = identity.cache.status(&target).unwrap().bytes;
        std::thread::sleep(std::time::Duration::from_millis(10));
        identity.cache.store_limited(
            &target,
            &entry("/v1/later"),
            identity.cache.epoch(),
            MAX_BODY,
            first_size + 10,
        );
        assert!(identity.cache.load(&target, &first.path).is_none());
        assert!(identity.cache.status(&target).unwrap().bytes <= first_size + 10);
    }
    #[tokio::test]
    async fn read_cache_prefetch_includes_sessions_referenced_by_mounts() {
        let server = fake_server(3, |request, _, _| {
            if request.contains("/v1/mounts/invented/results") {
                (200, "{\"spots\":[{\"session_id\":\"older-session\"},{\"session_id\":\"older-session\"}]}".into())
            } else {
                (200, "[]".into())
            }
        });
        let (_dir, identity, target) = setup(server);
        let counts = prefetch(
            &identity,
            &target,
            vec!["/v1/mounts/invented/results".into()],
        )
        .await
        .unwrap();
        assert_eq!(counts.fetched, 3);
        assert!(identity
            .cache
            .load(&target, "/v1/sessions/older-session/results?run=preferred")
            .is_some());
        assert!(identity
            .cache
            .load(&target, "/v1/sessions/older-session/acquisitions")
            .is_some());
    }
    #[tokio::test]
    async fn read_cache_prefetch_bounds_and_stops_on_transport_failure() {
        let (_dir, identity, target) = setup("http://127.0.0.1:1".into());
        assert!(prefetch(&identity, &target, vec!["/v1/test".into(); 401])
            .await
            .is_err());
        assert!(prefetch(&identity, &target, vec!["/v1/auth/login".into()])
            .await
            .is_err());
        let counts = prefetch(
            &identity,
            &target,
            (0..100).map(|n| format!("/v1/{n}")).collect(),
        )
        .await
        .unwrap();
        assert!(counts.failed <= 3);
        assert_eq!(counts.fetched, 0);
    }
    #[test]
    fn read_cache_isolates_view_as_paths_under_the_viewers_account() {
        let (_dir, identity, target) = setup("https://example.invalid".into());
        let cache = &identity.cache;
        cache
            .adopt(&target, &serde_json::json!({"id":"viewer"}))
            .unwrap();
        for (path, name) in [
            ("/v1/sessions?limit=500", "viewer"),
            ("/v1/sessions?limit=500&as=cedar", "cedar"),
        ] {
            let mut row = entry(path);
            row.body = serde_json::json!([{"id":name}]);
            cache.store(&target, &row, cache.epoch());
        }
        assert_eq!(
            cache.load(&target, "/v1/sessions?limit=500").unwrap().body[0]["id"],
            "viewer"
        );
        assert_eq!(
            cache
                .load(&target, "/v1/sessions?limit=500&as=cedar")
                .unwrap()
                .body[0]["id"],
            "cedar"
        );
        assert!(cache
            .load(&target, "/v1/sessions?limit=500&as=moss")
            .is_none());
    }
}
