/** Latest input wins; independent producers share one frame commit. */
export function frameQueue(run: () => void, request = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let frame: number | undefined;
  return {
    schedule() { if (frame === undefined) frame = request(() => { frame = undefined; run(); }); },
    flush() { if (frame !== undefined) { cancel(frame); frame = undefined; run(); } },
    cancel() { if (frame !== undefined) cancel(frame); frame = undefined; },
  };
}
