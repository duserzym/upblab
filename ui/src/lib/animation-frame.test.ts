import { expect, it, vi } from 'vitest';
import { frameQueue } from './animation-frame';
it('commits the latest input only once per frame and can flush or cancel pending work', () => {
  let callback: FrameRequestCallback = () => {}, latest = 0;
  const request = vi.fn((fn: FrameRequestCallback) => { callback = fn; return 42; }), cancel = vi.fn(), commit = vi.fn(() => latest);
  const queue = frameQueue(commit, request, cancel);
  for (let i = 0; i < 100; i++) { latest = i; queue.schedule(); }
  expect(request).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
  callback(0); expect(commit).toHaveReturnedWith(99);
  queue.schedule(); queue.flush(); expect(cancel).toHaveBeenCalledWith(42); expect(commit).toHaveBeenCalledTimes(2);
  queue.flush(); expect(commit).toHaveBeenCalledTimes(2);
  queue.schedule(); queue.cancel(); expect(commit).toHaveBeenCalledTimes(2);
});
