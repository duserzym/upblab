//! Is the UPbDB server accepting connections? A TCP connect to the URL's
//! host and port, tried on every resolved address (`localhost` resolves to
//! both ::1 and 127.0.0.1, and Django's dev server binds only one of them).
//! Done in Rust so mixed content and CORS rules of the shell page do not apply.

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::Serialize;
use tauri::Url;

#[derive(Debug, Serialize, PartialEq)]
pub struct ProbeResult {
    reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn probe_blocking(url: &str, timeout: Duration) -> ProbeResult {
    let fail = |error: String| ProbeResult { reachable: false, error: Some(error) };
    let parsed: Url = match url.parse() {
        Ok(u) => u,
        Err(e) => return fail(format!("invalid URL: {e}")),
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return fail(format!("unsupported scheme {}", parsed.scheme()));
    }
    let (Some(host), Some(port)) = (parsed.host_str(), parsed.port_or_known_default()) else {
        return fail("URL has no host".into());
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let addrs = match (host, port).to_socket_addrs() {
        Ok(a) => a.collect::<Vec<_>>(),
        Err(e) => return fail(format!("cannot resolve {host}: {e}")),
    };
    let mut last = String::from("no addresses");
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(_) => return ProbeResult { reachable: true, error: None },
            Err(e) => last = format!("{addr}: {e}"),
        }
    }
    fail(last)
}

#[tauri::command]
pub async fn probe(url: String) -> ProbeResult {
    tauri::async_runtime::spawn_blocking(move || probe_blocking(&url, Duration::from_secs(2)))
        .await
        .unwrap_or_else(|e| ProbeResult { reachable: false, error: Some(e.to_string()) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn reachable_when_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let r = probe_blocking(&format!("http://localhost:{port}/app/"), Duration::from_secs(1));
        assert!(r.reachable, "{r:?}");
    }

    #[test]
    fn unreachable_when_closed() {
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let r = probe_blocking(&format!("http://127.0.0.1:{port}/"), Duration::from_millis(300));
        assert!(!r.reachable);
        assert!(r.error.is_some());
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(!probe_blocking("file:///etc/passwd", Duration::from_millis(10)).reachable);
        assert!(!probe_blocking("not a url", Duration::from_millis(10)).reachable);
    }
}
