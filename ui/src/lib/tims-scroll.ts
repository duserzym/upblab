/** Restore a panel's scroll after content changes, without browser scroll anchoring. */
const positions = new Map<string, number>();
export function stableScroll(node: HTMLElement, key?: string) {
  let top = key ? positions.get(key) ?? node.scrollTop : node.scrollTop;
  let frame = 0;
  const remember = () => {
    const clamped = Math.min(top, Math.max(0, node.scrollHeight - node.clientHeight));
    if (Math.abs(node.scrollTop - clamped) > 1) { top = node.scrollTop; if (key) positions.set(key, top); }
  };
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { node.scrollTop = top; });
  });
  frame = requestAnimationFrame(() => { node.scrollTop = top; });
  node.addEventListener('scroll', remember, { passive: true });
  observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  return { destroy() { if (key) positions.set(key, top); observer.disconnect(); cancelAnimationFrame(frame); node.removeEventListener('scroll', remember); } };
}
