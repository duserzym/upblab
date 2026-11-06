<!--
  The area a module occupies. Desktop: a placeholder whose rectangle is sent to
  Rust, which lays a native child webview over it (ADR-0002). Web: an iframe
  named `lab-shell:<module>` so @lab/bridge inside it picks the postMessage
  transport.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { frameName } from '@lab/bridge/host';
  import type { ModuleTab } from '../lib/links';
  import { desktopModules, isDesktop, type Bounds } from '../lib/platform';
  import { shell, type ModuleTarget } from '../lib/shell.svelte';
  import { registerFrame, unregisterFrame } from '../lib/incoming';
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
  }
  let { module, home, target, active, title }: Props = $props();

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

  let lastSeq = -1;
  let lastHome = '';
  let shown = false;

  $effect(() => {
    if (!isDesktop || !el) return;
    const visible = active && !shell.overlay;
    const t = target;
    const h = home;
    if (!visible) {
      if (shown) queue(() => desktopModules.hide(module));
      shown = false;
      return;
    }
    // A new link wins; a changed home (server URL edited) goes home; otherwise
    // Rust just re-shows the existing webview where the user left it.
    const newTarget = t !== null && t.seq !== lastSeq;
    const navigate = newTarget || h !== lastHome;
    const url = newTarget ? t.url : h;
    if (t) lastSeq = t.seq;
    lastHome = h;
    shown = true;
    const bounds = rect();
    queue(() => desktopModules.open(module, url, bounds, navigate));
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

  onDestroy(() => {
    if (isDesktop && shown) void desktopModules.hide(module);
    unregisterFrame(module);
  });

  // Signed in or out in the shell: reload, so the module asks token() again.
  let seenRevision = identity.revision;
  $effect(() => {
    const r = identity.revision;
    if (r === seenRevision) return;
    seenRevision = r;
    if (isDesktop) queue(() => desktopModules.reload(module));
    else if (iframe) {
      try {
        iframe.contentWindow?.location.reload();
      } catch {
        iframe.src = iframe.src; // cross-origin frame
      }
    }
  });

  // Web: the iframe follows the latest target, else home.
  const src = $derived(target?.url ?? home);
  $effect(() => {
    if (iframe?.contentWindow) registerFrame(module, iframe.contentWindow, false);
  });
</script>

{#if isDesktop}
  <div class="surface" bind:this={el} aria-label={title} data-module={module}>
    <!-- The native webview paints over this element. Visible only while it loads. -->
    <p class="faint small">Loading {title}…</p>
  </div>
{:else}
  <iframe
    class="surface"
    bind:this={iframe}
    name={frameName(module)}
    {src}
    {title}
    referrerpolicy="same-origin"
    onload={() => iframe?.contentWindow && registerFrame(module, iframe.contentWindow)}
  ></iframe>
{/if}

<style>
  .surface {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
    display: grid;
    place-items: center;
    background: var(--bg);
  }
</style>
