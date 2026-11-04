# laicpmsdb service bundle (generated)

`scripts/fetch-modules.mjs` unpacks the laicpmsdb service bundle pinned in
`modules.lock.json` (entry `laicpmsdb-service`) into this folder, and
`tauri.conf.json` ships the folder as the app resource
`laicpmsdb-service/`. Its layout and the commands the shell runs are in
`docs/service-bundle-contract.md`.

While the lockfile has no release URL for the build platform, only this
README is here: the build has no bundled service, says so in its log at
start-up, and offers "This computer" mode only with a laicpmsdb checkout set
in Settings (development builds default to `../laicpmsdb`).

Everything here except this README is ignored by Git.
