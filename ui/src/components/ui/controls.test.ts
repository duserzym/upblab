import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SegmentedControl from './SegmentedControl.svelte';
import IconButton from './IconButton.svelte';
import Icon, { type IconName } from './Icon.svelte';
import ProgressBar from './ProgressBar.svelte';

describe('compact control variants', () => {
  it('keeps full radio names, titles and the selected tab stop when wrapping', () => {
    const { body } = render(SegmentedControl, { props: {
      label: 'Capsule navigation', value: 'chemistry', wrap: true, size: 'small',
      options: [{ value: '', label: 'Sources' }, { value: 'chemistry', label: 'Chemistry', ariaLabel: 'Full chemistry step name' }],
    } });
    expect(body).toContain('role="radiogroup" aria-label="Capsule navigation"');
    expect(body).toMatch(/value="chemistry"[^>]*aria-checked="true"[^>]*aria-label="Full chemistry step name"[^>]*title="Full chemistry step name"[^>]*tabindex="0"/);
    expect(body).toMatch(/value=""[^>]*aria-checked="false"[^>]*tabindex="-1"/);
    expect(body).toMatch(/class="[^"]*small[^"]*wrap/);
  });
  it('disables every entry while saving without losing its checked state', () => {
    const { body } = render(SegmentedControl, { props: { label: 'Entries', value: '1', disabled: true,
      options: [{value: '1', label: 'Entry 1'}, {value: '2', label: 'Entry 2'}] } });
    expect(body.match(/ disabled/g)).toHaveLength(2);
    expect(body.match(/aria-checked="true"/g)).toHaveLength(1);
  });
  it('keeps action names, disabled state, popover wiring and test ids in a small icon button', () => {
    const { body } = render(IconButton, { props: { icon: 'more', label: 'Presets', size: 'small', disabled: true,
      popovertarget: 'presets', 'aria-expanded': false, 'data-testid': 'action' } });
    for (const attribute of ['aria-label="Presets"', 'title="Presets"', 'popovertarget="presets"',
      'aria-expanded="false"', 'data-testid="action"', 'disabled', 'type="button"', 'aria-hidden="true"']) expect(body).toContain(attribute);
    expect(body).toMatch(/class="[^"]*small/);
    expect(body).not.toContain('element=');
  });
  it('can hide a progress caption without losing the accessible progress value', () => {
    const props = { value: 2, total: 5, noun: 'Session upload progress' };
    const hidden = render(ProgressBar, { props: { ...props, hideCaption: true } }).body;
    expect(hidden).toContain('role="progressbar"');
    expect(hidden).toContain('aria-valuenow="2"');
    expect(hidden).toContain('aria-valuetext="2 of 5 Session upload progress"');
    expect(hidden).not.toContain('class="caption');
    expect(render(ProgressBar, { props }).body).toContain('class="caption');
  });
  it.each<IconName>(['chevron-right', 'close', 'more', 'maximize', 'restore', 'zoom-in', 'zoom-out', 'fit', 'hide', 'show', 'pin', 'settings'])('renders the decorative %s glyph', kind => {
    const { body } = render(Icon, { props: { kind } });
    expect(body).toContain('aria-hidden="true"');
    expect(body).toContain('<path');
    expect(body).toContain('stroke="currentColor"');
  });
});
