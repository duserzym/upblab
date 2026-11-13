export interface Bounds { left: number; top: number; width: number; height: number }
/** Prefer below/left alignment, flip at an edge, then keep every edge within bounds. */
export function containRect(popup: { w: number; h: number }, anchor: Bounds, bounds: Bounds) {
  const maxWidth = Math.max(0, Math.min(popup.w, bounds.width));
  const maxHeight = Math.max(0, Math.min(popup.h, bounds.height));
  const left = anchor.left + maxWidth <= bounds.left + bounds.width
    ? anchor.left : anchor.left + anchor.width - maxWidth;
  const below = anchor.top + anchor.height + 4;
  const top = below + maxHeight <= bounds.top + bounds.height
    ? below : anchor.top - maxHeight - 4;
  return {
    left: Math.max(bounds.left, Math.min(left, bounds.left + bounds.width - maxWidth)),
    top: Math.max(bounds.top, Math.min(top, bounds.top + bounds.height - maxHeight)),
    maxWidth, maxHeight,
  };
}
