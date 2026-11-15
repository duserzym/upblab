# ADR-0001: the shell hosts pinned module web builds and launches native Studio

Date: 2026-11-03. Status: accepted.

Context: grainatlas ships a static web build, UPbDB a Django-served web
build, UPbRPy Studio a native PySide6 application. The lab wants one app on
macOS and Windows.

Decision: a Tauri 2 shell with one webview per web module (bundled grainatlas
build; configured UPbDB server) and an external launch for Studio.
Module versions are pinned in `modules.lock.json`. Cross-module navigation is
by URL scheme through a small bridge package; the link graph itself lives in
UPbDB.

Consequences: no module code is forked; the shell can be released on its own
cadence; Studio embedding waits for a web front end that is not planned.

## Update 2026-11-14

The bundled grainatlas build no longer has a tab of its own. It stays pinned
and bundled as Review's read-only SEM viewer (bridge `set-presentation`
`viewer`, always). Image uploads and edits go to the standalone grainatlas
app, launched with arguments (`docs/deep-links.md`); on the web, to the hosted
build in a new browser tab. The shell never asks the bundled build for the
editor presentation, and refuses editor commands to it.
