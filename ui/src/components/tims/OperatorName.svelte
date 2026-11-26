<script lang="ts">
  import { untrack } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { operatorAccounts, ReplyScope } from '../../lib/tims-requests';
  import { operatorName } from '../../lib/tims-display';
  import type { BatchOut } from '../../lib/tims-api';
  import type { Account } from '../../lib/platform';
  import MetaChip from '../ui/MetaChip.svelte';
  let { batch, chip = false }: { batch: Pick<BatchOut, 'operator_name' | 'operator_id'>; chip?: boolean } = $props();
  let accounts = $state.raw<Account[]>([]);
  $effect(() => {
    const id = batch.operator_id; void batch.operator_name; void identity.revision; void identity.target?.server;
    let current = true;
    untrack(() => {
      accounts = [];
      const ownsReply = new ReplyScope(() => batch.operator_id).capture();
      if (id && !batch.operator_name && id !== identity.account?.id) void operatorAccounts().then(rows => { if (current && ownsReply()) accounts = rows; });
    });
    return () => { current = false; };
  });
</script>
{#if chip}<MetaChip text={operatorName(batch, identity.account, accounts)} icon="person" />
{:else}<span title={batch.operator_id ?? undefined}>{operatorName(batch, identity.account, accounts)}</span>{/if}
