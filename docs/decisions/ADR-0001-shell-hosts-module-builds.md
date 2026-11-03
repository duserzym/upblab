# ADR-0001: the shell hosts pinned module web builds and launches native Studio

Date: 2026-11-03. Status: accepted.

Context: grainatlas ships a static web build, laicpmsdb a Django-served web
build, UPbRPy Studio a native PySide6 application. The lab wants one app on
macOS and Windows.

Decision: a Tauri 2 shell with one webview per web module (bundled grainatlas
build; configured laicpmsdb server) and an external launch for Studio.
Module versions are pinned in `modules.lock.json`. Cross-module navigation is
by URL scheme through a small bridge package; the link graph itself lives in
laicpmsdb.

Consequences: no module code is forked; the shell can be released on its own
cadence; Studio embedding waits for a web front end that is not planned.
