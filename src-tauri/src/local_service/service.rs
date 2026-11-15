//! The UPbDB service: where it is and how to run it
//! (docs/service-bundle-contract.md sections 1 to 3 and 7).

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    /// `<resources>/upbdb-service/` from the release asset.
    Bundle { root: PathBuf, python: PathBuf, version: String },
    /// A UPbDB checkout with its `.venv` (development fallback).
    Dev { checkout: PathBuf, python: PathBuf, manage: PathBuf },
}

impl Source {
    pub fn kind(&self) -> &'static str {
        match self {
            Source::Bundle { .. } => "bundle",
            Source::Dev { .. } => "dev",
        }
    }
    pub fn path(&self) -> &Path {
        match self {
            Source::Bundle { root, .. } => root,
            Source::Dev { checkout, .. } => checkout,
        }
    }
    pub fn version(&self) -> Option<&str> {
        match self {
            Source::Bundle { version, .. } => Some(version),
            Source::Dev { .. } => None,
        }
    }
    /// Health endpoint and whether its body must say `"status": "ok"`.
    pub fn health(&self) -> (&'static str, bool) {
        match self {
            Source::Bundle { .. } => ("/v1/health", true),
            Source::Dev { .. } => ("/v1/docs", false),
        }
    }
}

pub fn bundle_python(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("python").join("python.exe")
    } else {
        root.join("python").join("bin").join("python3")
    }
}

pub fn venv_python(checkout: &Path) -> PathBuf {
    if cfg!(windows) {
        checkout.join(".venv").join("Scripts").join("python.exe")
    } else {
        checkout.join(".venv").join("bin").join("python")
    }
}

/// The bundle in the resources folder, if this build carries one.
pub fn bundled(resource_dir: Option<&Path>) -> Option<Source> {
    let root = resource_dir?.join("upbdb-service");
    let version = std::fs::read_to_string(root.join("VERSION")).ok()?.trim().to_string();
    let python = bundle_python(&root);
    (python.is_file() && !version.is_empty()).then_some(Source::Bundle { root, python, version })
}

/// A development checkout at `path`, if it has a virtualenv and manage.py.
pub fn dev_checkout(path: &Path) -> Result<Source, String> {
    let python = venv_python(path);
    let manage = path.join("service").join("manage.py");
    if !manage.is_file() {
        return Err(format!("{} is not a UPbDB checkout (no service/manage.py)", path.display()));
    }
    if !python.is_file() {
        return Err(format!("{} has no virtualenv: run `make venv` there first", path.display()));
    }
    Ok(Source::Dev { checkout: path.to_path_buf(), python, manage })
}

/// The bundle wins; otherwise the configured checkout.
pub fn locate(resource_dir: Option<&Path>, dev_path: Option<&Path>) -> Result<Source, String> {
    if let Some(b) = bundled(resource_dir) {
        return Ok(b);
    }
    match dev_path {
        Some(p) => dev_checkout(p),
        None => Err("This build of UPb Lab does not include the UPbDB service yet, and no UPbDB \
                     checkout is set in Settings. Use a Lab server, or set Settings → UPbDB checkout."
            .into()),
    }
}

/// What to run: program, arguments, working directory, extra environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
}

fn contract(python: &Path, data_root: &Path, args: &[&str]) -> Invocation {
    let mut a = vec!["-m".to_string(), "upbdb_service".to_string()];
    a.extend(args.iter().map(|s| s.to_string()));
    Invocation { program: python.to_path_buf(), args: a, cwd: data_root.to_path_buf(), env: vec![] }
}

fn manage(checkout: &Path, python: &Path, manage: &Path, args: &[&str]) -> Invocation {
    let mut a = vec![manage.to_string_lossy().into_owned()];
    a.extend(args.iter().map(|s| s.to_string()));
    Invocation { program: python.to_path_buf(), args: a, cwd: checkout.join("service"), env: vec![] }
}

/// Steps before `serve` (the dev fallback migrates separately), then serve.
pub fn serve(source: &Source, data_root: &Path, port: u16) -> (Vec<Invocation>, Invocation) {
    let port_s = port.to_string();
    match source {
        Source::Bundle { python, .. } => {
            (vec![], contract(python, data_root, &["serve", "--host", "127.0.0.1", "--port", &port_s]))
        }
        Source::Dev { checkout, python, manage: m } => (
            vec![manage(checkout, python, m, &["migrate", "--no-input"])],
            manage(checkout, python, m, &["runserver", &format!("127.0.0.1:{port}"), "--noreload"]),
        ),
    }
}

/// `bootstrap`. The password travels in the file `password_file`; the dev
/// fallback reads it back and hands it over in `DJANGO_SUPERUSER_PASSWORD`.
pub fn bootstrap(
    source: &Source,
    data_root: &Path,
    username: &str,
    email: &str,
    password_file: &Path,
) -> Result<Invocation, String> {
    match source {
        Source::Bundle { python, .. } => {
            let f = password_file.to_string_lossy();
            Ok(contract(python, data_root, &["bootstrap", "--username", username, "--password-file", &f, "--email", email]))
        }
        Source::Dev { checkout, python, manage: m } => {
            let password = std::fs::read_to_string(password_file).map_err(|e| e.to_string())?;
            let mut inv = manage(checkout, python, m, &["createsuperuser", "--no-input"]);
            inv.env = vec![
                ("DJANGO_SUPERUSER_USERNAME".into(), username.into()),
                ("DJANGO_SUPERUSER_EMAIL".into(), email.into()),
                ("DJANGO_SUPERUSER_PASSWORD".into(), password.trim_end_matches(['\r', '\n']).into()),
            ];
            Ok(inv)
        }
    }
}

/// The dev fallback's createsuperuser fails when the name exists; the
/// contract's bootstrap exits 0 then. Treat both as success.
pub fn bootstrap_output_ok(source: &Source, success: bool, output: &str) -> bool {
    success || (matches!(source, Source::Dev { .. }) && output.contains("already taken"))
}

pub fn load_demo(source: &Source, data_root: &Path) -> Invocation {
    match source {
        Source::Bundle { python, .. } => contract(python, data_root, &["load-demo"]),
        Source::Dev { checkout, python, manage: m } => manage(checkout, python, m, &["load_demo"]),
    }
}

/// Settings handed to every service command (contract section 3).
pub struct Environment<'a> {
    pub database_url: &'a str,
    pub data_root: &'a Path,
    pub secret_key: &'a str,
}

pub fn environment(e: &Environment) -> Vec<(String, String)> {
    let data_root = e.data_root.to_string_lossy().replace('\\', "/");
    vec![
        ("DATABASE_URL".into(), e.database_url.into()),
        ("UPBDB_DATA_ROOT".into(), data_root),
        ("DJANGO_SECRET_KEY".into(), e.secret_key.into()),
        ("DJANGO_DEBUG".into(), "0".into()),
        ("DJANGO_ALLOWED_HOSTS".into(), "127.0.0.1,localhost".into()),
        ("UPBDB_CORS_ORIGINS".into(), "tauri://localhost,http://tauri.localhost".into()),
        ("UPBDB_REGISTRATION".into(), "closed".into()),
        ("PYTHONDONTWRITEBYTECODE".into(), "1".into()),
        ("PYTHONUNBUFFERED".into(), "1".into()),
        ("PYTHONUTF8".into(), "1".into()),
    ]
}

/// Variables from the user's own shell that would leak into the service and
/// override the contract (a developer's `.env` exports, a virtualenv).
pub const SCRUB: &[&str] = &["PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "DJANGO_SETTINGS_MODULE", "PGPASSWORD", "PGHOST", "PGPORT"];

pub fn database_url(password: &str, port: u16) -> String {
    format!("postgres://upbdb:{password}@127.0.0.1:{port}/upbdb")
}

/// The NAS layout under the data root (UPbDB `make data-root`).
pub const DATA_ROOT_DIRS: [&str; 8] = ["raw", "attachments", "derived", "inbox", "quarantine", "backups", "exports", "releases"];

/// Expand a leading `~` and use the platform's separators.
pub fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
    let p = path.trim();
    let rest = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")).or(if p == "~" { Some("") } else { None });
    match (rest, home) {
        (Some(rest), Some(home)) => rest.split(['/', '\\']).filter(|s| !s.is_empty()).fold(home.to_path_buf(), |acc, s| acc.join(s)),
        _ => PathBuf::from(p),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("upbstudio-svc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn bundle_needs_version_and_interpreter() {
        let res = tmp("bundle");
        assert!(bundled(Some(&res)).is_none());
        let root = res.join("upbdb-service");
        let py = bundle_python(&root);
        std::fs::create_dir_all(py.parent().unwrap()).unwrap();
        std::fs::write(&py, "").unwrap();
        assert!(bundled(Some(&res)).is_none(), "no VERSION yet");
        std::fs::write(root.join("VERSION"), "0.4.0\n").unwrap();
        let s = bundled(Some(&res)).unwrap();
        assert_eq!(s.version(), Some("0.4.0"));
        assert_eq!(s.health(), ("/v1/health", true));
        // The bundle wins over a checkout.
        assert_eq!(locate(Some(&res), Some(Path::new("/nope"))).unwrap().kind(), "bundle");
        std::fs::remove_dir_all(&res).unwrap();
    }

    #[test]
    fn checkout_needs_manage_py_and_venv() {
        let co = tmp("checkout");
        assert!(dev_checkout(&co).unwrap_err().contains("not a UPbDB checkout"));
        std::fs::create_dir_all(co.join("service")).unwrap();
        std::fs::write(co.join("service/manage.py"), "").unwrap();
        assert!(dev_checkout(&co).unwrap_err().contains("make venv"));
        let py = venv_python(&co);
        std::fs::create_dir_all(py.parent().unwrap()).unwrap();
        std::fs::write(&py, "").unwrap();
        let s = locate(None, Some(&co)).unwrap();
        assert_eq!(s.kind(), "dev");
        assert_eq!(s.health(), ("/v1/docs", false));
        assert!(locate(None, None).unwrap_err().contains("Lab server"));
        std::fs::remove_dir_all(&co).unwrap();
    }

    fn bundle() -> Source {
        Source::Bundle { root: "/R".into(), python: "/R/python/bin/python3".into(), version: "1".into() }
    }
    fn dev() -> Source {
        Source::Dev { checkout: "/co".into(), python: "/co/.venv/bin/python".into(), manage: "/co/service/manage.py".into() }
    }

    #[test]
    fn contract_commands() {
        let (pre, serve_) = serve(&bundle(), Path::new("/data"), 8001);
        assert!(pre.is_empty(), "serve migrates by itself");
        assert_eq!(serve_.args, ["-m", "upbdb_service", "serve", "--host", "127.0.0.1", "--port", "8001"]);
        assert_eq!(serve_.cwd, PathBuf::from("/data"));
        let b = bootstrap(&bundle(), Path::new("/data"), "ada", "ada@example.org", Path::new("/tmp/pw")).unwrap();
        assert_eq!(b.args, ["-m", "upbdb_service", "bootstrap", "--username", "ada", "--password-file", "/tmp/pw", "--email", "ada@example.org"]);
        assert!(b.env.is_empty());
        assert_eq!(load_demo(&bundle(), Path::new("/data")).args, ["-m", "upbdb_service", "load-demo"]);
    }

    #[test]
    fn dev_fallback_commands() {
        let (pre, serve_) = serve(&dev(), Path::new("/data"), 8000);
        assert_eq!(pre[0].args, ["/co/service/manage.py", "migrate", "--no-input"]);
        assert_eq!(serve_.args, ["/co/service/manage.py", "runserver", "127.0.0.1:8000", "--noreload"]);
        assert_eq!(serve_.cwd, PathBuf::from("/co/service"));
        assert_eq!(load_demo(&dev(), Path::new("/data")).args, ["/co/service/manage.py", "load_demo"]);
    }

    #[test]
    fn dev_bootstrap_keeps_the_password_out_of_argv() {
        let d = tmp("pw");
        let f = d.join("pw");
        std::fs::write(&f, "correct horse\n").unwrap();
        let b = bootstrap(&dev(), Path::new("/data"), "ada", "ada@example.org", &f).unwrap();
        assert_eq!(b.args, ["/co/service/manage.py", "createsuperuser", "--no-input"]);
        assert!(b.args.iter().all(|a| !a.contains("horse")));
        assert!(b.env.contains(&("DJANGO_SUPERUSER_PASSWORD".into(), "correct horse".into())));
        assert!(bootstrap_output_ok(&dev(), false, "CommandError: Error: That username is already taken."));
        assert!(!bootstrap_output_ok(&dev(), false, "Traceback"));
        assert!(!bootstrap_output_ok(&bundle(), false, "already taken"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn environment_follows_the_contract() {
        let env = environment(&Environment {
            database_url: &database_url("pw", 55432),
            data_root: Path::new("C:\\Users\\Zoë\\upbdb"),
            secret_key: "k",
        });
        let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        assert_eq!(get("DATABASE_URL"), Some("postgres://upbdb:pw@127.0.0.1:55432/upbdb"));
        assert_eq!(get("UPBDB_DATA_ROOT"), Some("C:/Users/Zoë/upbdb"));
        assert_eq!(get("DJANGO_DEBUG"), Some("0"));
        assert_eq!(get("DJANGO_ALLOWED_HOSTS"), Some("127.0.0.1,localhost"));
        assert_eq!(get("UPBDB_CORS_ORIGINS"), Some("tauri://localhost,http://tauri.localhost"));
        assert!(get("UPBDB_REGISTRATION").is_some());
    }

    #[test]
    fn home_expansion() {
        let home = Path::new("/Users/z");
        assert_eq!(expand_home("~/upbdb", Some(home)), PathBuf::from("/Users/z").join("upbdb"));
        assert_eq!(expand_home("~", Some(home)), PathBuf::from("/Users/z"));
        assert_eq!(expand_home("/srv/data", Some(home)), PathBuf::from("/srv/data"));
        assert_eq!(expand_home("~/a/b", None), PathBuf::from("~/a/b"));
    }
}
