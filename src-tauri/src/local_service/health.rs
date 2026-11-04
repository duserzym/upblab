//! Health check of the local service (contract section 4): a plain HTTP/1.1
//! GET on loopback, so the shell needs no HTTP client library for it.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

pub fn get(port: u16, path: &str, timeout: Duration) -> std::io::Result<Response> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut s = TcpStream::connect_timeout(&addr, timeout)?;
    s.set_read_timeout(Some(timeout))?;
    s.set_write_timeout(Some(timeout))?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json, text/html\r\nUser-Agent: upbstudio-health\r\nConnection: close\r\n\r\n"
    );
    s.write_all(request.as_bytes())?;
    let mut buf = Vec::new();
    // Bodies we care about are tiny; stop at 64 KiB (the docs page is larger).
    let _ = s.take(64 * 1024).read_to_end(&mut buf);
    parse(&buf).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "not an HTTP response"))
}

fn parse(raw: &[u8]) -> Option<Response> {
    let text = String::from_utf8_lossy(raw);
    let status_line = text.lines().next()?;
    let mut parts = status_line.split_whitespace();
    if !parts.next()?.starts_with("HTTP/") {
        return None;
    }
    let status = parts.next()?.parse().ok()?;
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    Some(Response { status, body })
}

/// Is this a healthy answer? The bundle's `/v1/health` must say
/// `"status": "ok"`; the development fallback's `/v1/docs` only needs a 200.
pub fn healthy(resp: &Response, strict: bool) -> bool {
    if resp.status != 200 {
        return false;
    }
    if !strict {
        return true;
    }
    serde_json::from_str::<serde_json::Value>(resp.body.trim())
        .ok()
        .and_then(|v| v.get("status").and_then(|s| s.as_str()).map(|s| s == "ok"))
        .unwrap_or(false)
}

/// The `version` field of a health answer.
pub fn version(resp: &Response) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(resp.body.trim())
        .ok()?
        .get("version")?
        .as_str()
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn serve_once(response: &'static str) -> u16 {
        let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            let mut req = Vec::new();
            let mut byte = [0u8; 1];
            while !req.ends_with(b"\r\n\r\n") && c.read(&mut byte).unwrap() == 1 {
                req.push(byte[0]);
            }
            assert!(String::from_utf8_lossy(&req).starts_with("GET /v1/health HTTP/1.1\r\n"));
            c.write_all(response.as_bytes()).unwrap();
        });
        port
    }

    #[test]
    fn healthy_bundle_answer() {
        let port = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\": \"ok\", \"version\": \"0.4.0\", \"database\": \"ok\"}",
        );
        let r = get(port, "/v1/health", Duration::from_secs(2)).unwrap();
        assert_eq!(r.status, 200);
        assert!(healthy(&r, true));
        assert_eq!(version(&r).as_deref(), Some("0.4.0"));
    }

    #[test]
    fn starting_answer_is_not_healthy() {
        let port = serve_once("HTTP/1.1 503 Service Unavailable\r\n\r\n{\"status\": \"starting\"}");
        let r = get(port, "/v1/health", Duration::from_secs(2)).unwrap();
        assert!(!healthy(&r, true));
        assert!(!healthy(&r, false));
    }

    #[test]
    fn strict_needs_status_ok() {
        let r = Response { status: 200, body: "<html>docs</html>".into() };
        assert!(!healthy(&r, true));
        assert!(healthy(&r, false));
        let r = Response { status: 200, body: "{\"status\":\"error\"}".into() };
        assert!(!healthy(&r, true));
    }

    #[test]
    fn closed_port_is_an_error() {
        let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap().local_addr().unwrap().port();
        assert!(get(port, "/v1/health", Duration::from_millis(300)).is_err());
    }
}
