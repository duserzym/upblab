import type { Presentation } from '@lab/bridge';
import type { View } from './shell.svelte';
import type { ModuleTab } from './links';

/** Review's hosted images module is always read-only, including reloads while hidden. */
export function presentationFor(_view: View, _split: boolean, activeTab: ModuleTab): Presentation | null {
  return activeTab === 'images' ? 'viewer' : null;
}
