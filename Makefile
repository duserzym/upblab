# UPb Lab developer tasks. On Windows run them from Git Bash with GNU make,
# or run the commands under each target directly in PowerShell.

TAURI ?= cargo tauri
PNPM  ?= pnpm

# Local macOS release builds share one Cargo target outside the checkout, so a
# fresh build checkout reuses the compiled dependencies (about 65 s saved per
# build, about 3 GB of disk; docs/testing.md). `make clean-build` keeps it;
# `make clean-release-cache` removes it; `make build RELEASE_TARGET=` builds
# into src-tauri/target as before. GitHub Actions always uses src-tauri/target.
ifeq ($(shell uname -s),Darwin)
ifndef GITHUB_ACTIONS
RELEASE_TARGET ?= $(HOME)/Library/Caches/lab-builds/upblab-target
endif
endif
BUNDLE_DIR = $(if $(RELEASE_TARGET),$(RELEASE_TARGET),src-tauri/target)/release/bundle

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
setup: check-tools ## Install JS dependencies, build @lab/bridge, fetch pinned module builds, install test browsers
	$(PNPM) install --frozen-lockfile
	$(PNPM) --filter @lab/bridge build
	node scripts/fetch-modules.mjs
	$(PNPM) --filter upbstudio-ui exec playwright install chromium webkit

.PHONY: fetch-modules
fetch-modules: ## Install the module builds pinned in modules.lock.json into ui/public/modules/
	node scripts/fetch-modules.mjs

.PHONY: dev
dev: ## Run the desktop shell with hot reload (Vite on :1420)
	$(TAURI) dev

.PHONY: ui-dev
ui-dev: ## Run only the shell page in a browser at http://localhost:1420 (web delivery)
	$(PNPM) --filter upbstudio-ui dev

# Sign macOS builds with the lab's code-signing certificate when this Mac has it
# ("UPb Lab Code Signing" in the login keychain; ~/Github/lab-builds/SIGNING.md), so
# keychain permissions survive rebuilds and updates. Elsewhere builds stay ad hoc.
LAB_SIGNING_IDENTITY ?= $(shell security find-identity -p codesigning 2>/dev/null | grep -q '"UPb Lab Code Signing"' && echo 'UPb Lab Code Signing')
SIGN_ENV = $(if $(LAB_SIGNING_IDENTITY),APPLE_SIGNING_IDENTITY="$(LAB_SIGNING_IDENTITY)")

.PHONY: build
# CI=true makes the bundler skip the Finder AppleScript that arranges the .dmg
# window: it needs Automation permission for Finder and times out without it.
# GitHub Actions sets CI too, so local and CI disk images are the same.
build: ## Build the release app and installers (.app/.dmg on macOS, .msi/.exe on Windows)
	CI=true $(SIGN_ENV) $(if $(RELEASE_TARGET),CARGO_TARGET_DIR="$(RELEASE_TARGET)") $(TAURI) build
	@echo "Installers: $(BUNDLE_DIR)/ (copy the .app out, then delete it there)"

.PHONY: quick
quick: ## Quick check: only the tests the changed files affect (Chromium), in parallel; see docs/testing.md
	node scripts/quick-check.mjs

.PHONY: check
check: test ## Full check: everything; before a build or install, and after bridge, hosting, storage or database-writing changes

.PHONY: test
test: ## Run bridge, UI, module-pinning, screen-size and Rust tests (the full check)
	$(PNPM) test
	@test -f ui/dist/index.html || $(PNPM) --filter upbstudio-ui build
	cargo test --manifest-path src-tauri/Cargo.toml
	$(MAKE) e2e

.PHONY: e2e
e2e: ## Walk every shell screen at 1440x900 and 1280x800 in Chromium and WebKit (ux-conventions rule 7)
	$(PNPM) --filter upbstudio-ui e2e

.PHONY: clean
clean: ## Remove build outputs (keeps node_modules)
	rm -rf ui/dist bridge/dist ui/public/modules
	cargo clean --manifest-path src-tauri/Cargo.toml

.PHONY: clean-build
clean-build: ## After a major update: remove src-tauri/target only (keeps bridge/dist, ui/dist, modules, node_modules)
	@if pgrep -f "$(CURDIR)/src-tauri/target/" >/dev/null; then echo "A build is writing to $(CURDIR)/src-tauri/target; not cleaning."; exit 1; fi
	@df -h / | awk 'NR==2 {print "Free on /: " $$4 " (before)"}'
	rm -rf ./src-tauri/target
	@df -h / | awk 'NR==2 {print "Free on /: " $$4 " (after)"}'
	@$(if $(RELEASE_TARGET),test -d "$(RELEASE_TARGET)" && du -sh "$(RELEASE_TARGET)" | awk '{print "Kept shared release target: " $$1 " in " $$2}' || true,true)

.PHONY: clean-release-cache
clean-release-cache: ## Remove the shared release target (only when asked; the next build is cold again)
	@test -n "$(RELEASE_TARGET)" || { echo "No shared release target on this machine."; exit 0; }
	@if pgrep -f "cargo.*$(RELEASE_TARGET)|$(RELEASE_TARGET)/" >/dev/null; then echo "A build is writing to $(RELEASE_TARGET); not cleaning."; exit 1; fi
	@df -h / | awk 'NR==2 {print "Free on /: " $$4 " (before)"}'
	rm -rf "$(RELEASE_TARGET)"
	@df -h / | awk 'NR==2 {print "Free on /: " $$4 " (after)"}'

.PHONY: updater-setup
updater-setup: ## Generate the updater signing key and configure the repository (owner only)
	$(PNPM) updater:setup

.PHONY: check-version
check-version: ## Check that all four shell version copies agree
	@node scripts/check-version.mjs
