import type { Page } from '@playwright/test';

/** Problems on the current screen: page scroll, sideways overflow, panels outside the window, unreachable controls. */
export function problems(page: Page, label: string) {
  return page.evaluate((label) => {
    const W = innerWidth;
    const H = innerHeight;
    const out: string[] = [];
    const name = (e: Element) =>
      `${e.tagName.toLowerCase()}.${[...e.classList].filter((c) => !c.startsWith('svelte-')).join('.')} "${(e.textContent || '').trim().slice(0, 30)}"`;
    const scrolls = (a: Element, axis: 'x' | 'y') => {
      const o = getComputedStyle(a)[axis === 'x' ? 'overflowX' : 'overflowY'];
      return (o === 'auto' || o === 'scroll') && (axis === 'x' ? a.scrollWidth > a.clientWidth + 1 : a.scrollHeight > a.clientHeight + 1);
    };
    const inScroller = (e: Element) => {
      for (let a = e.parentElement; a; a = a.parentElement) if (scrolls(a, 'y')) return true;
      return false;
    };
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    };
    const de = document.documentElement;
    if (de.scrollWidth > W + 1 || de.scrollHeight > H + 1) out.push(`${label}: page scrolls (${de.scrollWidth} x ${de.scrollHeight})`);
    // Nothing may be wider than its scrolling view: sideways scrolling is a failure everywhere.
    for (const e of document.querySelectorAll('.view, .bar, .page, .panel, .dialog, table')) {
      if (!visible(e)) continue;
      if (e.scrollWidth > e.clientWidth + 1) out.push(`${label}: wider than its box (${e.scrollWidth} > ${e.clientWidth}): ${name(e)}`);
      const r = e.getBoundingClientRect();
      if (r.right > W + 1 || r.left < -1) out.push(`${label}: sticks out sideways: ${name(e)}`);
      if (!inScroller(e) && (r.bottom > H + 1 || r.top < -1)) out.push(`${label}: outside the window: ${name(e)}`);
    }
    for (const e of document.querySelectorAll('button, input, select, textarea, a[href]')) {
      if (!visible(e) || (e as HTMLInputElement).type === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (r.right > W + 1 || (!inScroller(e) && r.bottom > H + 1)) out.push(`${label}: control out of reach: ${name(e)}`);
    }
    return out;
  }, label);
}

