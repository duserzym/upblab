import type { Presentation } from '@lab/bridge';
import type { View } from './shell.svelte';
import type { ModuleTab } from './links';

/** Only the Images surface changes presentation; hidden surfaces keep their state. */
export function presentationFor(view: View, split: boolean, activeTab: ModuleTab): Presentation | null {
  if (activeTab !== 'images') return null;
  if (view === 'images') return 'editor';
  return view === 'review' && split ? 'viewer' : null;
}
