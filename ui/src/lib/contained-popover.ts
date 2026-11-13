import { containRect } from './contain';

/** Top-layer menus must stay within their owning dock panel, even after resizing. */
export function containedPopover(node: HTMLElement, options: { anchor: () => HTMLElement | undefined; w: number; h: number }) {
  let observing = false;
  const panel = node.closest<HTMLElement>('[data-review-panel]');
  function place() {
    const anchor = options.anchor();
    if (!anchor || !panel) return;
    const rect = containRect(options, anchor.getBoundingClientRect(), panel.getBoundingClientRect());
    Object.assign(node.style, {
      position: 'fixed', inset: 'auto', margin: '0', boxSizing: 'border-box',
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.maxWidth}px`,
      maxWidth: `${rect.maxWidth}px`, maxHeight: `${rect.maxHeight}px`, minWidth: '0',
      overflow: 'auto', overflowWrap: 'anywhere', overscrollBehavior: 'contain', boxShadow: 'none',
    });
  }
  const resize = new ResizeObserver(() => { if (node.matches(':popover-open')) place(); });
  function beforeToggle(event: Event) {
    if ((event as ToggleEvent).newState === 'open') {
      place();
      if (panel && !observing) { resize.observe(panel); observing = true; }
    }
  }
  const close = () => { if (node.matches(':popover-open')) node.hidePopover(); };
  // A dock move, scroll or window resize can move a native surface before observers run.
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  const scroll = (event: Event) => { if (!node.contains(event.target as Node)) close(); };
  document.addEventListener('scroll', scroll, true);
  node.addEventListener('beforetoggle', beforeToggle);
  return { destroy() {
    resize.disconnect();
    node.removeEventListener('beforetoggle', beforeToggle);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
    document.removeEventListener('scroll', scroll, true);
  } };
}
