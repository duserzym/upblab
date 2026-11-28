<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { tims, TimsReadError, type VersionOut } from '../../lib/tims-api';
  import { identity } from '../../lib/identity.svelte';
  import { ReplyScope } from '../../lib/tims-requests';
  import { defaultSpikeVersion } from '../../lib/tims-spike-default';
  import SpikePicker from './SpikePicker.svelte';
  let { value = '', lab, disabled = false, knownVersions = {}, onchange, ondetail, onloading } : {
    value?: string; lab: string; disabled?: boolean; knownVersions?: Record<string, VersionOut>;
    onchange: (id: string, detail: VersionOut) => void; ondetail?: (detail: VersionOut) => void; onloading?: (loading: boolean) => void;
  } = $props();
  let detail = $state.raw<VersionOut | null>(null), error = $state(''), resolving = $state(false);
  const replies = new ReplyScope(() => lab);
  onDestroy(() => { replies.invalidate(); onloading?.(false); });
  $effect(() => {
    void lab; void identity.revision; void identity.target?.server;
    untrack(() => {
      replies.invalidate(); detail = null; error = '';
      resolving = !!lab && !value; onloading?.(resolving);
      if (!resolving) return;
      const current = replies.capture();
      void tims.spikeDefault(lab).then(settings => {
        if (!current()) return;
        const version = defaultSpikeVersion(value, settings);
        if (version) { detail = version; onchange(version.id, version); }
      }).catch(e => { if (current() && !(e instanceof TimsReadError && e.status === 404)) error = String(e); }).finally(() => { if (current()) { resolving = false; onloading?.(false); } });
    });
  });
</script>
<SpikePicker {value} {lab} disabled={disabled || resolving} {resolving} knownVersions={{ ...knownVersions, ...(detail ? { [detail.id]: detail } : {}) }} {onchange} {ondetail} />
{#if error}<p class="small error" role="status">{error}</p>{/if}
