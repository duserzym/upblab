# UPb Studio developer tasks. On Windows run them from Git Bash with GNU make,
# or run the commands under each target directly in PowerShell.

TAURI ?= cargo tauri
PNPM  ?= pnpm

.DEFAULT_GOAL := help

.PHONY: help
help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-15s %s\n", $$1, $$2}'

.PHONY: check-tools
check-tools:
	@command -v node  >/dev/null || { echo "node not found (need Node 20+)"; exit 1; }
	@command -v $(PNPM) >/dev/null || { echo "pnpm not found: corepack enable  (or npm i -g pnpm)"; exit 1; }
	@command -v cargo >/dev/null || { echo "Rust not found: https://rustup.rs"; exit 1; }
	@cargo tauri --version >/dev/null 2>&1 || { echo "Tauri CLI not found: cargo install tauri-cli --version '^2.11' --locked"; exit 1; }

.PHONY: setup
setup: check-tools ## Install JS dependencies, build @lab/bridge, fetch pinned module builds
	$(PNPM) install --frozen-lockfile
	$(PNPM) --filter @lab/bridge build
	node scripts/fetch-modules.mjs

.PHONY: fetch-modules
fetch-modules: ## Install the module builds pinned in modules.lock.json into ui/public/modules/
	node scripts/fetch-modules.mjs

.PHONY: dev
dev: ## Run the desktop shell with hot reload (Vite on :1420)
	$(TAURI) dev

.PHONY: ui-dev
ui-dev: ## Run only the shell page in a browser at http://localhost:1420 (web delivery)
	$(PNPM) --filter upbstudio-ui dev

.PHONY: build
build: ## Build the release app and installers (.app/.dmg on macOS, .msi/.exe on Windows)
	$(TAURI) build
	@echo "Installers: src-tauri/target/release/bundle/"

.PHONY: test
test: ## Run bridge, UI, module-pinning and Rust tests
	$(PNPM) test
	@test -f ui/dist/index.html || $(PNPM) --filter upbstudio-ui build
	cargo test --manifest-path src-tauri/Cargo.toml

.PHONY: clean
clean: ## Remove build outputs (keeps node_modules)
	rm -rf ui/dist bridge/dist ui/public/modules
	cargo clean --manifest-path src-tauri/Cargo.toml
