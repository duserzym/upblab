import { capInventory } from './home';
import { localSessions, openLocalSession, type LocalSession } from './platform';
import { shell } from './shell.svelte';

export class LocalSessions {
  rows = $state<LocalSession[]>([]);
  error = $state('');
  loading = $state(false);
  opening = $state('');
  private loaded = false;
  async load(force = false) {
    if (this.loading || (this.loaded && !force)) return;
    this.loading = true;
    try { this.rows = capInventory(await localSessions()); this.error = ''; this.loaded = true; }
    catch (err) { this.error = String(err); }
    finally { this.loading = false; }
  }
  async open(row: LocalSession) {
    if (row.openable === false) return;
    this.opening = row.path; this.error = '';
    try { await openLocalSession(row.path, shell.studioConfig); }
    catch (err) { this.error = `Could not open ${row.key}: ${String(err)}`; }
    finally { this.opening = ''; }
  }
}
export const localInventory = new LocalSessions();
