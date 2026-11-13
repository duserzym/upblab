import { SvelteSet } from 'svelte/reactivity';

// App-wide overlays share this registry; closing one must not reveal modules
// while another is still open. Each mounted overlay owns a distinct id.
const open = new SvelteSet<string>();
export const overlays = { get active() { return open.size > 0; } };
export function openOverlay(id: string) { open.add(id); }
export function closeOverlay(id: string) { open.delete(id); }
