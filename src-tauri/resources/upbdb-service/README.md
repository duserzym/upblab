# UPbDB service bundle (generated)

`scripts/fetch-modules.mjs` unpacks the UPbDB service bundle pinned in
`modules.lock.json` (entry `upbdb-service`) into this folder, and
`tauri.conf.json` ships the folder as the app resource
`upbdb-service/`. Its layout and the commands the shell runs are in
`docs/service-bundle-contract.md`.

While the lockfile has no release URL for the build platform, only this
README is here: the build has no bundled service, says so in its log at
start-up, and offers "This computer" mode only with a UPbDB checkout set
in Settings (development builds default to `../upbdb`).

Everything here except this README is ignored by Git.
