//! Free loopback ports for PostgreSQL and the UPbDB service.
//!
//! A port counts as free when nothing answers a connect on 127.0.0.1 *and* we
//! can bind it. Both checks are needed: std sets SO_REUSEADDR on Unix, so on
//! macOS a bind to 127.0.0.1:8000 succeeds while another server listens on
//! 0.0.0.0:8000, and a connect alone misses a port held by a socket that is
//! bound but not yet listening.

use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

/// Preferred PostgreSQL port: not 5432, so a developer's own cluster (and
/// UPbDB's `make db-start`) is never touched.
pub const PG_PREFERRED: u16 = 55432;
pub const PG_LAST: u16 = 55499;
/// Preferred service port (ADR-0003: 8000 when free, else the next free one).
pub const SERVICE_PREFERRED: u16 = 8000;
pub const SERVICE_LAST: u16 = 8099;

pub fn is_free(port: u16) -> bool {
    if port == 0 {
        return false;
    }
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok() {
        return false;
    }
    TcpListener::bind(addr).is_ok()
}

/// Any port the OS hands out on loopback.
fn ephemeral() -> Option<u16> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).ok()?.local_addr().ok().map(|a| a.port())
}

/// The first free port in `first..=last` according to `free`, else an
/// ephemeral one. `free` is injected so the order can be tested.
pub fn pick_with(first: u16, last: u16, free: impl Fn(u16) -> bool) -> Option<u16> {
    (first..=last).find(|p| free(*p)).or_else(ephemeral)
}

pub fn pick(first: u16, last: u16) -> Option<u16> {
    pick_with(first, last, is_free)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listening_port_is_not_free() {
        let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        assert!(!is_free(port));
        drop(l);
        assert!(is_free(port), "port {port} should be free once released");
    }

    #[test]
    fn wildcard_listener_is_detected() {
        // The macOS SO_REUSEADDR case: someone listens on 0.0.0.0:p.
        let l = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        assert!(!is_free(port));
    }

    #[test]
    fn port_zero_is_never_free() {
        assert!(!is_free(0));
    }

    #[test]
    fn preferred_port_first_then_the_next_free_one() {
        assert_eq!(pick_with(8000, 8099, |_| true), Some(8000));
        assert_eq!(pick_with(8000, 8099, |p| p != 8000), Some(8001));
        assert_eq!(pick_with(8000, 8099, |p| p >= 8042), Some(8042));
    }

    #[test]
    fn falls_back_to_an_ephemeral_port_when_the_range_is_taken() {
        let p = pick_with(8000, 8003, |_| false).expect("ephemeral port");
        assert!(!(8000..=8003).contains(&p));
        assert!(p > 0);
    }

    #[test]
    fn skips_a_port_that_is_really_in_use() {
        let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let busy = l.local_addr().unwrap().port();
        if busy < u16::MAX {
            let got = pick(busy, busy.saturating_add(20)).unwrap();
            assert_ne!(got, busy);
        }
    }
}
