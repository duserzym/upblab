import { commandResult, type AtlasCommandName, type AtlasSyncConfirmation, type BridgeCommand, type CommandResult } from '@lab/bridge';

export type AtlasRequest = Extract<BridgeCommand, { type: AtlasCommandName }>;
export type RequestResult = CommandResult | { timeout: true };
export const CONFLICT_NOTE = 'Both changed: review the differences in GrainAtlas';
export function confirmationSummary(confirm: AtlasSyncConfirmation, separator = ' and '): string {
  return [
    confirm.retireGrains ? `retires ${confirm.retireGrains} of ${confirm.grainsTotal} grain${confirm.grainsTotal === 1 ? '' : 's'}` : '',
    confirm.deleteSpots ? `deletes ${confirm.deleteSpots} spot${confirm.deleteSpots === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(separator);
}
export function requestTimeout(command: AtlasRequest): number {
  return command.type === 'sync-draft' || command.type === 'leave-edit' && command.decision === 'sync' ? 60_000 : 10_000;
}
export function resultReason(result: RequestResult, seconds: number): string {
  return 'timeout' in result ? `no reply in ${seconds} s` : result.error || result.code || 'unknown failure';
}
/** User-facing failure sentences; result codes take precedence over module wording. */
export function resultMessage(result: RequestResult, seconds: number, action = 'Sync'): string {
  if ('timeout' in result) return `No reply from GrainAtlas in ${seconds} s. Your draft is kept.`;
  switch (result.code) {
    case 'offline': return 'The database server could not be reached. Your draft is kept.';
    case 'unauthorized': return 'Sign in again to sync. Your draft is kept.';
    case 'not-found': return 'This project is not in the database. Your draft is kept.';
    default: return `${action} did not finish: ${resultReason(result, seconds).replace(/\.+$/, '')}. Your draft is kept.`;
  }
}

/** One identified command in flight, above the transport's one waiting slot. */
export function createAtlasRequests(send: (command: AtlasRequest) => Promise<unknown>, enabled: () => boolean) {
  let queue: Promise<unknown> = Promise.resolve();
  let pending: { id: string; command: AtlasCommandName; finish: (result: RequestResult) => void } | null = null;
  let sequence = 0;
  const session = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    request(command: AtlasRequest, timeoutMs = requestTimeout(command)): Promise<RequestResult> {
      const id = `${session}-${++sequence}`;
      const run = () => new Promise<RequestResult>(resolve => {
        if (!enabled()) {
          resolve({ type: 'lab.command.result', id, command: command.type, ok: false, code: 'failed', error: 'GrainAtlas has not reported v4 support' });
          return;
        }
        const finish = (result: RequestResult) => {
          clearTimeout(timer);
          pending = null;
          resolve(result);
        };
        const timer = setTimeout(() => finish({ timeout: true }), timeoutMs);
        pending = { id, command: command.type, finish };
        // false means the command is queued for a loading module, not a failure.
        void Promise.resolve().then(() => send({ ...command, id })).catch(() => {
          if (pending?.id === id) finish({ type: 'lab.command.result', id, command: command.type, ok: false, code: 'failed', error: 'Could not send the command to GrainAtlas' });
        });
      });
      const result = queue.then(run);
      queue = result;
      return result;
    },
    receive(event: unknown) {
      const result = commandResult(event);
      if (result && pending?.id === result.id && pending.command === result.command) pending.finish(result);
    },
  };
}
