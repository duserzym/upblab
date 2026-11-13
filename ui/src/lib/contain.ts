export interface Bounds { left: number; top: number; width: number; height: number }
/** Place a border-box popup below its anchor, keeping every edge within bounds. */
export function containRect(popup: { w: number; h: number }, anchor: Bounds, bounds: Bounds) {
  const maxWidth = Math.max(0, Math.min(popup.w, bounds.width));
  const maxHeight = Math.max(0, Math.min(popup.h, bounds.height));
  return {
    left: Math.max(bounds.left, Math.min(anchor.left, bounds.left + bounds.width - maxWidth)),
    top: Math.max(bounds.top, Math.min(anchor.top + anchor.height + 4, bounds.top + bounds.height - maxHeight)),
    maxWidth, maxHeight,
  };
}
