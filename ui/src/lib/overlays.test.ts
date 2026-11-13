import { afterEach, describe, expect, it } from 'vitest';
import { closeOverlay, openOverlay, overlays } from './overlays.svelte';

afterEach(() => { closeOverlay('sign-in'); closeOverlay('updates'); });
describe('app overlays', () => {
  it('keeps surfaces hidden until the last overlay closes', () => {
    expect(overlays.active).toBe(false);
    openOverlay('sign-in');
    openOverlay('updates');
    closeOverlay('sign-in');
    expect(overlays.active).toBe(true);
    closeOverlay('updates');
    expect(overlays.active).toBe(false);
  });
  it('tolerates repeated open and close notifications', () => {
    openOverlay('updates'); openOverlay('updates');
    expect(overlays.active).toBe(true);
    closeOverlay('updates'); closeOverlay('updates'); closeOverlay('unknown');
    expect(overlays.active).toBe(false);
  });
});
