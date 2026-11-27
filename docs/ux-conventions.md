# UX conventions in the shell

Rules 1–7 are written once, in grainatlas:
[`docs/ux-conventions.md`](../../grainatlas/docs/ux-conventions.md) (the
source; read it there). This page says where UPb Lab's shell follows
each one, and which do not apply to it. Rule 8 sets the shell's layering
contract. Module tabs follow the rules in their
own code; the shell's part is to pass them what they need (theme, files,
sign-in) and to give them the whole area under the tab bar.

| Rule | In the shell |
| --- | --- |
| 1. System by default, with light and dark | Settings → Appearance and layout offers System, Light, Dark; nothing explicitly chosen means System (`ui/src/lib/settings.svelte.ts`). System follows the operating system, including live changes. The resolved `light` or `dark` is always written on the shell's `<html data-theme>`. Choices stay in the viewer's settings (`settings.json` on desktop, `localStorage` on the web), never on a server. Older saved defaults migrate to System unless `themeChosen` is true. Every tab changes at once without reloading: modules receive the resolved theme through bridge v3.1, a host-written `data-theme` attribute where accessible, and `?theme=light\|dark` at load. See [bridge-theme.md](bridge-theme.md). |
| 2. One gesture module for image views | Does not apply: the shell draws no image. Review's SEM pane is grainatlas's own viewer, read-only. |
| 3. One click for a good result, Auto, Reset | Does not apply: the shell has no processing controls. |
| 4. Open anything, never ask what it is | A folder or files dropped anywhere on the window (tab bar, Home, a module tab), opened from the Finder or Explorer, or picked with Home's **Open folder…** / **Open files…** go to the tab that reads them, decided by content (`ui/src/lib/drop.ts`, rules at the top): packages, area folders, images, `.grainatlas` folders and `.gaproj` files to standalone grainatlas (`grainatlas_open_paths`; on the web the page asks you to drop them into grainatlas opened in a new browser tab); Qtegra export folders, zips and CSVs to Sessions (`upbdb://ingest?path=` on the desktop). Session files reach UPbDB through `@lab/bridge` `open-files` (protocol v2, `bridge/README.md`); the host lists and reads them (`src-tauri/src/files.rs`), the module never sees a host path it was not given. A `.zag` file stands for its package folder. Nothing the modules cannot read is refused with a line saying what can be opened. File associations: `docs/installing.md`. Home's five action tiles are **Open folder**, **Open files**, **Upload LA-ICP-MS session**, **Upload image set** and **Laser log**, with matching neutral backgrounds, borders and outline icons; an upload tile starts the upload in one click and its card shows handoff progress and Review links; each refuses files for the other module. |
| 5. The scale is known, or asked once | Does not apply to the shell: the scale is grainatlas's question, asked after the files arrive through `open-files`. |
| 6. Server features are additive and say where data comes from | One server setting (Settings → UPbDB: a lab server or "This computer"); the tab bar names the server in the sign-in button's tooltip and dialog; the sign-in is the shell's (`token()` for modules), kept in the OS keychain, never in a URL or file. Home says which part is missing (no server, unreachable, signed out) next to the list it affects. |
| 7. Fit a 14-inch laptop | Checked at 1440 × 900 and 1280 × 800 CSS pixels, and Home, Settings and TIMS at 1024 × 640, in Chromium and WebKit: first-run wizard, Home (also while files are dragged over it), Sessions, Review (including plots and details), Reduce, TIMS (batches, capsule drawers, recipes, capsule sets, spike review and pick-note import), Settings, sign-in dialog; module tabs get the full width and all the height under the 48 px tab bar (`ui/tests/sizes.spec.ts`, `ui/tests/review.spec.ts`, `make e2e`, part of `make test`). Long URLs, paths and ids wrap; pages scroll inside the window, never sideways. The window opens at 1280 × 800 centred, cannot go below 1024 × 640, and reopens where it was left, fitted to the monitor it is on (`src-tauri/src/geometry.rs`, `window.json` in the app config folder). Settings → Appearance and layout → **Reset layout** returns it to 1280 × 800 centred. Review remembers its scope and the Side by side choice; the split with the grainatlas viewer adapts down to the smallest supported window. Review tiles enforce minimum sizes and collapse metadata, then Spots, into header rails when needed (SEM yields next if a vertical stack still cannot fit); a rail temporarily maximises its tile. Balanced resets the current mode’s layout; Plots focus and Image focus offer alternate arrangements, with split and solo layouts stored separately. Tile maximise lasts only for the app session. Each Review column scrolls within the window. Home's card grids show 4 cards across at 1440 px, 3 at 1280 and 2 below 1100 (`ui/tests/home.spec.ts`); the Review geochemistry board shows 3 x 2 panels when its own width is 880 px or more, else 2 x 2, and scrolls vertically for more (`ui/tests/review.spec.ts`). Theme: every tab is checked in light and dark (`ui/tests/theme.spec.ts`). |
| 8. Layers stay within their owner | L0 tiles are dock panels in flow. L1 in-tile drawers are pickers kept open while looking at the result: depth channels, geochemistry axis quantities, session and run pickers. They open inside their own tile or toolbar and take layout space; content beside or below shrinks. They never float. L2 anchored menus are short, one-shot choices (move panel, presets, row actions). They may float, using the shared `containedPopover` / `containRect` helper to stay inside the owning tile, flip above or right-align to the anchor near an edge, and clamp every edge. They never extend over another tile or a module surface; a menu for a native surface takes layout space above it. L3 app dialogs and popups outside a tile use the shared overlay registry (`ui/src/lib/overlays.svelte.ts`): every visible module surface is hidden and replaced by a quiet placeholder of the same size before opening, then restored on close. Future toasts use a reserved strip of shell chrome that no module surface covers. Nothing relies on z-index to paint over a native module surface. |
| 9. Ages read the same everywhere | Shared with GrainAtlas and Studio (sync plan 2026-11-12, Part A). Any age colour scale is oriented so its lighter end is the younger end, whatever colormap is chosen (measure CIELAB L* of both ends; only monotonic-lightness colormaps are offered for ages; no reverse switch that can break this); legends run young to old, light to dark, left to right. Where spots on an image are labelled or coloured by date, the default is the 206Pb/238U date, with 207Pb/206Pb, 207Pb/235U and Preferred (207Pb/206Pb above 1000 Ma) offered and the legend naming the date shown. Review's preferred date and exports are unchanged. Today the shell has no age colour scale (Review colours by sample; the spot tree's date badge is coloured by pass or discordance) and shows image spots' dates only inside the GrainAtlas module, so this rule binds future shell work. |

The desktop quit guard is an L3 dialog. Quitting never depends on the UI: the
Rust shell waits at most 2 s for its answer, and a second Cmd+Q quits at once,
even while the prompt is open or sync is pending. Once the UI answers that
the prompt is open, there is no decision timeout. A forced quit loses at most a drag still
in progress: GrainAtlas persists every committed edit at once (each undo
checkpoint writes the project and its sync draft to the webview's storage; a
spot move, resize or brush stroke commits when the pointer is released), so
unsynced changes stay as drafts and appear again on Home and in GrainAtlas.

## What the modules still adopt

- **grainatlas**: register `onOpenFiles` when hosted and pass the set to its
  Open screen code; in the desktop shell every drop on the window arrives
  that way (`bridge/README.md`, grainatlas section).
- **UPbDB**: the `#/ingest` route (with `?path=`; today the ingest dialog
  lives on the timeline and UPbDB has no such route) and `onOpenFiles`
  there, feeding the ingest dialog (`bridge/README.md`, UPbDB section).
  It already reads `?theme=` (UPbDB 25c69fd).

## Motion and press feedback (2026-11-14)

Tabs, chips and table rows change state instantly: no colour fade on a tab or
chip switch, keyboard switching included, and no fade on table-row hover.
Ordinary buttons keep their short hover fade. Pressing a tab, chip, Home
action tile, card title or Review tree button darkens it while pressed
(`--press`, a background layer, no movement); `.btn` keeps its 1 px press.
All motion uses `--motion`, which is 0 ms under reduced motion.

## Control shapes (2026-11-25)

Use one shape per kind of control: view switch = segmented control, workflow =
stepper, facts = chips, rare actions = icon buttons, primary navigation =
text-link breadcrumb. Pills (`btn` rounded buttons) are no longer the default
for everything. The shared components live in `ui/src/components/ui/`.

| Component | Purpose and props |
| --- | --- |
| `SegmentedControl` | Switch views inside one bordered group with dividers. `options: {value, label, title?, ariaLabel?}[]`, bindable `value: string`, `label: string`, optional `onchange(value)` and `size: 'small' \| 'normal'` (normal by default), `wrap` (bounded, wrapping labels) and `disabled` (all options). The selected radio uses `--accent-soft` and `--accent`. |
| `Stepper` | Navigate a workflow. `steps: {label, fullName, detail, state: 'done' \| 'current' \| 'pending', hint?}[]`, `onselect(index)`, `label`, optional `trailing` snippet for actions. Short labels and counts appear below 22 px circles; full names and details form accessible names. Current hints are exposed in titles and accessible descriptions. Its row is 54 px high. |
| `MetaChip` | Display a quiet neutral fact. `text: string`, optional `icon` (an `IconName` or snippet), `info: string` and `infoLabel: string`. Long text truncates with its complete value in `title`. An info button describes provenance without adding it to the fact. |
| `IconButton` | A rare action with a named icon. `icon: IconName`, `label: string`, optional `title`, `disabled`, and standard button attributes and handlers, including `aria-expanded`, optional `size: 'small' \| 'normal'` (24 px or 30 px) and bindable `element` for popover anchors. The label is its accessible name; the title defaults to that label. |
| `StatusChip` | A short state fact. `text: string`, optional `tone: 'neutral' \| 'warning' \| 'success'` (neutral by default). Warning and success tints mix the existing `--warning` and `--ok` tokens; the text also names the state. |
| `ProgressBar` | A 5 px progress bar and an “n of m noun” caption. `value?: number \| null`, `total: number`, `noun: string`. Missing values show “— of m noun”, omit `aria-valuenow` and leave the bar empty. Zero totals have no fill. Values outside the range are clamped. `hideCaption` hides the visible count when existing status text already describes progress; accessible values stay present. |
| `Icon` | Decorative inline SVG. `kind: 'refresh' \| 'edit' \| 'history' \| 'person' \| 'flask' \| 'building' \| 'info' \| 'check' \| 'chevron-left' \| 'calendar' \| 'rows' \| 'lanes' \| 'chevron-right' \| 'close' \| 'more' \| 'maximize' \| 'restore' \| 'zoom-in' \| 'zoom-out' \| 'fit' \| 'hide' \| 'show' \| 'pin' \| 'settings'`. Uses a 24 × 24 viewBox, currentColor stroke, 1.6 px stroke width and round caps and joins; the default display is 18 × 18 px. |

### Where each shape is used

| Shape | Where |
| --- | --- |
| Segmented control | TIMS batch/list views and capsule chemistry/entry switches; Review plot, diagram, tool and layout choices; Home views and atlas filter; Settings theme and server mode. |
| Stepper | TIMS batch setup workflow. |
| Metadata chip | TIMS batch details and spike origin; Home session mineral, Local copy and access role. Session bylines and run status stay plain text. |
| Status chip | TIMS batch, capsule readiness and spike states; shell upload handoff states. |
| Icon button | Batch/capsule navigation, calendar/lane actions, Review plot/panel actions, Home refresh and pins, top-bar Settings. |
| Text/list navigation | TIMS sections and batch breadcrumb. Main module and mount tabs remain navigation. |
| Button | Primary actions; independent pressed options keep their existing names and states with compact rectangular outlines. |
| Thin progress bar | TIMS batch readiness and shell upload handoff, with existing live status text. |

Spatial capsule wells keep their measured geometry and pressed selection.
Independent sample/legend selections, axis options and preset replacement
commands keep their existing interaction models.

Wrapping segmented groups keep content-sized segments and a rounded border;
they wrap only when the panel runs out of width. Plot actions with counts
keep those counts visible. Ambiguous fit actions keep short text labels.

All colours come from the design tokens, so Light, Dark and System share the
same controls. No new theme tokens are required. View and workflow changes
are instant. Icon buttons use the `--motion` hover feedback and the `--press`
background while pressed, without movement; focus rings use `--accent`.

The segmented control is a labelled `radiogroup`: Tab reaches the selected
radio, Left/Right wrap and select, and Home/End select the first/last radio.
Native buttons in the stepper's ordered list work with Tab, Enter and Space;
only the current step has `aria-current="step"`. The metadata info tooltip
opens on hover or focus and on click/Enter, uses `aria-describedby`, and closes
on Escape. Icon buttons always have an accessible name, even with no text
visible, and disabled buttons retain their native disabled behaviour. Progress
bars expose min, max, current value when known, and the full caption as
`aria-valuetext`.

### Design suite (2026-11-25)

Home, Review and TIMS follow the approved [lab design suite](../../lab-builds/design-suite-2026-11-25/lab-design-suite.html)
(`~/Github/lab-builds/design-suite-2026-11-25/lab-design-suite.html`, `#upb-lab`
and `#language`): quiet bordered groups, compact record rows, fact and state
chips, sentence-case metadata headings and one filled action for the current
task. Home keeps all five action tiles equally styled; Review leads with
Edit in UPbRPy Studio, and the batch list with New batch. The batch editor
emphasises the active save;
Next incomplete leads when no form is active. Background capsule saves stay
outlined while a workspace or batch form is active. Existing tokens supply
both themes; the shared controls and all roles, accessible names, tooltips,
test IDs and keyboard interactions are retained.

Deviations keep real controls and states: Home retains all four scope filters,
inventory totals, pins, local sessions and links in its adaptive three-column
board. Session spot-mix bars are counts, not progress; run status stays plain
text. Atlas symbols keep their accessible descriptions and unknown states;
there is no invented sync progress, greeting or summary data. Review keeps its
resizable dock, collapse rails, layout presets, plot tools and full stored
metadata instead of the mock's proposed fixed inspector. Its secondary edit
links remain available when a panel is collapsed or maximised. TIMS retains
all filters, server-provided state words, unknown-summary fallbacks, views,
weighing fields, source controls and chemistry records. The bench's column
sizes, scroll areas, puck geometry and outside labels are retained. Save and
completion actions remain in their existing panels rather than moving to
shell chrome. No data, calculations, navigation or server reads change.
