<!--
  The area a module occupies. Desktop: a placeholder whose rectangle is sent to
  Rust, which lays a native child webview over it (ADR-0002). Web: an iframe
  named `lab-shell:<module>` so @lab/bridge inside it picks the postMessage
  transport.
-->
<script lang="ts">
  import { oversight } from '../lib/oversight.svelte';
  import { withOversight } from '../lib/links';
  import { onDestroy, untrack } from 'svelte';
  import { frameName, pushTheme } from '@lab/bridge/host';
  import { withTheme, withoutTheme, type ModuleTab } from '../lib/links';
  import { settings } from '../lib/settings.svelte';
  import { desktopModules, isDesktop, type Bounds } from '../lib/platform';
  import { shell, type ModuleTarget } from '../lib/shell.svelte';
  import { registerFrame, unregisterFrame, moduleSurfaces } from '../lib/incoming';
  import { identity } from '../lib/identity.svelte';

  interface Props {
    module: ModuleTab;
    /** Entry URL when nothing particular is requested. */
    home: string;
    /** Latest navigation request from a link, if any. */
    target: ModuleTarget | null;
    /** Whether the surface should be visible now. */
    active: boolean;
    title: string;
    layoutKey?: string;
  }
  let { module, home, target, active, title, layoutKey }: Props = $props();

  $effect(() => {
    const id = module;
    moduleSurfaces.add(id);
    return () => { moduleSurfaces.delete(id); };
  });

  let el = $state<HTMLDivElement>();
  let iframe = $state<HTMLIFrameElement>();

  // Desktop: serialise IPC per surface so show/hide/bounds arrive in order.
  let chain: Promise<unknown> = Promise.resolve();
  function queue(fn: () => Promise<unknown>) {
    chain = chain.then(fn).catch((err) => console.warn(`[module ${module}]`, err));
  }
  function rect(): Bounds {
    const r = el!.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), viewportHeight: window.innerHeight };
  }

  // UPbDB renders the Timeline filters. Pass in the initial scope from Home.
  const scopedHome = $derived(module === 'sessions' || module === 'people' ? withOversight(home, oversight, module === 'sessions') : home);
  const scopedTarget = $derived(target && (module === 'sessions' || module === 'people') ? { ...target, url: withOversight(target.url, oversight) } : target);
  let lastScope = '';
  let lastSeq = -1;
  let lastHome = '';
  let shown = false;

  $effect(() => {
    if (!isDesktop || !el) return;
    const visible = active && !shell.overlay;
    const t = scopedTarget;
    const h = scopedHome;
    const scope = `${identity.target?.server ?? ''}:${identity.revision}:${oversight.viewAs?.username ?? ''}`;
    const scopeChanged = scope !== lastScope;
    lastScope = scope;
    if (!visible) {
      if (shown) queue(() => desktopModules.hide(module));
      shown = false;
      return;
    }
    // A new link wins; a changed home (server URL edited) goes home; otherwise
    // Rust just re-shows the existing webview where the user left it.
    const newTarget = t !== null && t.seq !== lastSeq;
    const navigate = newTarget || scopeChanged || withoutTheme(h) !== lastHome;
    const url = withTheme(newTarget || scopeChanged && t ? t!.url : h, untrack(() => settings.effectiveTheme));
    if (t) lastSeq = t.seq;
    lastHome = withoutTheme(h);
    shown = true;
    const bounds = rect();
    queue(() => desktopModules.open(module, url, bounds, navigate, scope));
  });

  $effect(() => {
    if (!isDesktop || !el) return;
    const ro = new ResizeObserver(() => {
      if (shown) {
        const bounds = rect();
        queue(() => desktopModules.bounds(module, bounds));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (!isDesktop || !layoutKey || !active || !el || shell.overlay) return;
    const bounds = rect();
    if (shown) queue(() => desktopModules.bounds(module, bounds));
  });

  onDestroy(() => {
    // Hide after any queued open, including when permission removes this surface.
    if (isDesktop) queue(() => desktopModules.hide(module));
    unregisterFrame(module);
  });

  // Keep navigation separate from live theme delivery. Read the latest theme
  // for each new load, including a previously queued target.
  let src = $state(untrack(() => withTheme(scopedTarget?.url ?? scopedHome, settings.effectiveTheme)));
  let webHome = '';
  let webSeq = -1;
  $effect.pre(() => {
    if (isDesktop) return;
    const h = withoutTheme(scopedHome);
    const t = scopedTarget;
    if (h === webHome && (t?.seq ?? -1) === webSeq) return;
    const newTarget = t !== null && t.seq !== webSeq;
    webHome = h;
    webSeq = t?.seq ?? -1;
    src = withTheme(newTarget ? t.url : scopedHome, untrack(() => settings.effectiveTheme));
  });

  function publishTheme() {
    if (!iframe?.contentWindow || !src) return;
    const theme = settings.effectiveTheme;
    // Older same-origin modules watch this attribute; cross-origin ones use
    // the bridge push (and the query parameter on their first load).
    try {
      iframe.contentDocument?.documentElement?.setAttribute('data-theme', theme);
    } catch { /* cross-origin iframe */ }
    pushTheme(iframe.contentWindow, theme, new URL(src, location.href).origin);
  }
  $effect(() => { publishTheme(); });
  function frameLoaded() {
    if (iframe?.contentWindow) registerFrame(module, iframe.contentWindow);
    publishTheme();
  }
  $effect(() => {
    if (iframe?.contentWindow) registerFrame(module, iframe.contentWindow, false);
  });
</script>

{#if isDesktop}
  <div class="surface" bind:this={el} aria-label={title} data-module={module}>
    <!-- The native webview paints here; its placeholder keeps the same bounds. -->
    {#if active && shell.overlay}
      <p class="faint small" role="status">Hidden while a dialog is open</p>
    {:else}<p class="faint small">Loading {title}…</p>{/if}
  </div>
{:else}
  {#key module === 'images' ? `${identity.revision}:${shell.atlasViewerReload}` : identity.revision}
  <iframe
    class="surface"
    bind:this={iframe}
    name={frameName(module === 'people' ? 'upbdb' : module)}
    {src}
    {title}
    style:visibility={shell.overlay ? 'hidden' : undefined}
    referrerpolicy="same-origin"
    onload={frameLoaded}
  ></iframe>
  {/key}
{/if}

<style>
  .surface {
    flex: 1;
    min-height: 0;
    min-width: 0;
    width: 100%;
    border: 0;
    display: grid;
    place-items: center;
    background: var(--bg);
  }
</style>
