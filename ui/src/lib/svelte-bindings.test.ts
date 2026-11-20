import { compile } from 'svelte/compiler';
import { expect, it } from 'vitest';

const components = import.meta.glob('../**/*.svelte', { query: '?raw', import: 'default', eager: true });
it('compiles every component in dev mode without a bind accessor shadowing its state', () => {
  const collisions: string[] = [];
  for (const [filename, source] of Object.entries(components)) {
    const { js } = compile(source as string, { filename, dev: true, generate: 'client' });
    // Svelte names bind accessors get/set. A state with that same name would
    // resolve to the accessor itself, e.g. $.set(set, $$value), at runtime.
    if (/function (get|set)\([^)]*\)\s*\{[^{}]*\$\.(?:get|set)\(\1\b/.test(js.code)) collisions.push(filename);
  }
  expect(collisions).toEqual([]);
});
it('recognises the original New batch setter collision', () => {
  const { js } = compile('<script>let set = $state("")</script><select bind:value={set}><option>a</option></select>', { dev: true, generate: 'client' });
  expect(js.code).toMatch(/function (get|set)\([^)]*\)\s*\{[^{}]*\$\.(?:get|set)\(\1\b/);
});
