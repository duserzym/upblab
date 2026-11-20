import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: false, desktopAuth: {}, logInfo: vi.fn(), logWarn: vi.fn() }));
const { identity } = await import('./identity.svelte');
const { connectivity } = await import('./connectivity.svelte');
afterEach(() => { connectivity.reset(); vi.unstubAllGlobals(); });
it('shares the web token with the embedded Images viewer on a copy, while Studio handoff remains available', async () => {
  const offlineCopy = 'offline copy as of 2026-11-17 21:49 UTC, read-only';
  vi.stubGlobal('sessionStorage', { getItem: () => 'invented-token' });
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/auth/handoff') ? { code: 'studio-code' } : { username: 'invented' }), {
    status: 200, headers: { 'X-UPbDB-Offline-Copy': offlineCopy },
  }));
  vi.stubGlobal('fetch', fetch);
  await identity.restore({ server: 'https://copy.invalid', key: 'copy' });
  expect(connectivity.offlineCopy).toBe(offlineCopy);
  expect(identity.frameToken('images')).toBe('invented-token');
  expect(identity.frameToken('grainatlas')).toBe('invented-token');
  expect(identity.frameToken('sessions')).toBe('invented-token');
  expect(await identity.handoff()).toBe('studio-code');
  fetch.mockImplementationOnce(async () => new Response('{}', { status: 200 }));
  await identity.get('/v1/mounts');
  expect(connectivity.offlineCopy).toBeNull();
  expect(identity.frameToken('images')).toBe('invented-token');
  identity.state = { signedIn: false, account: null, offline: false };
  expect(identity.frameToken('images')).toBeNull();
});
it('uses only the viewer token, scopes every read, preserves the caller profile and rejects stale responses', async () => {
  const { oversight } = await import('./oversight.svelte');
  vi.stubGlobal('sessionStorage', { getItem: () => 'viewer-token' });
  const fetch = vi.fn(async () => new Response(JSON.stringify({ username: 'viewer', can_view_as: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  await identity.restore({ server: 'https://scope.invalid', key: 'scope' });
  oversight.select({ username: 'cedar', name: 'Cedar Analyst' });
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ username: 'cedar', can_view_as: false }), { status: 200 }));
  await identity.get('/v1/accounts/me'); expect(identity.account?.username).toBe('viewer'); expect(identity.account?.can_view_as).toBe(true);
  expect(fetch).toHaveBeenLastCalledWith('https://scope.invalid/v1/accounts/me?as=cedar', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer viewer-token' }) }));
  let finish!: (response: Response) => void;
  fetch.mockImplementationOnce(() => new Promise(resolve => finish = resolve)); const pending = identity.get('/v1/sessions?limit=500');
  oversight.select(null); finish(new Response('[]')); await expect(pending).rejects.toThrow('view changed');
});
it('revalidates per-scope ETags and clears caches and all write paths on view-as changes', async () => {
  const { oversight } = await import('./oversight.svelte'); oversight.reset();
  vi.stubGlobal('sessionStorage', { getItem: () => 'viewer-token' });
  const fetch = vi.fn<(url: string, init: { headers: Record<string, string> }) => Promise<Response>>(async () => new Response('[]', { headers: { ETag: 'invented-tag' } })); vi.stubGlobal('fetch', fetch);
  identity.target = { server: 'https://etag.invalid', key: 'etag' }; identity.state = { signedIn: true, account: { username: 'viewer' }, offline: false };
  await identity.get('/v1/samples?limit=500'); fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
  expect((await identity.get('/v1/samples?limit=500')).body).toEqual([]);
  expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ 'If-None-Match': 'invented-tag' });
  oversight.select({ username: 'cedar', name: 'Cedar' });
  const before = fetch.mock.calls.length;
  await expect(identity.write('/v1/samples/demo', 'PATCH', {})).rejects.toThrow('read-only'); await expect(identity.handoff()).rejects.toThrow('read-only'); expect(fetch).toHaveBeenCalledTimes(before);
  await identity.get('/v1/samples?limit=500'); expect(fetch.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty('If-None-Match');
  oversight.reset();
});
it('keeps directory pages fresh for 60 seconds, then revalidates their ETag and cursor', async () => {
  const { RecordList } = await import('./records.svelte');
  const { oversight } = await import('./oversight.svelte'); oversight.reset();
  vi.stubGlobal('sessionStorage', { getItem: () => 'viewer-token' });
  identity.target = { server: 'https://directory.invalid', key: 'directory' };
  identity.state = { signedIn: true, account: { username: 'viewer' }, offline: false };
  const fetch = vi.fn().mockResolvedValueOnce(new Response('[{"id":"cedar"}]', {
    headers: { ETag: 'directory-tag', 'X-Next-Cursor': 'opaque/next' },
  })).mockResolvedValueOnce(new Response(null, { status: 304 }));
  vi.stubGlobal('fetch', fetch); vi.useFakeTimers();
  try {
    const list = new RecordList('/v1/accounts', false, { view_as: 'true' });
    await list.load(); await list.load();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000); await list.load();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('https://directory.invalid/v1/accounts?limit=500&view_as=true');
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ 'If-None-Match': 'directory-tag', Authorization: 'Bearer viewer-token' });
    expect(list.rows).toEqual([{ id: 'cedar' }]); expect(list.cursor).toBe('opaque/next');
  } finally { vi.useRealTimers(); }
});
it('resends exactly the rejected write with the header and an unchanged body after confirmation', async () => {
  const { oversight } = await import('./oversight.svelte'); oversight.reset();
  vi.stubGlobal('sessionStorage', { getItem: () => 'viewer-token' });
  identity.target = { server: 'https://write.invalid', key: 'write' }; identity.state = { signedIn: true, account: { username: 'viewer' }, offline: false };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'oversight_confirm', owner: 'Cedar', detail: 'Confirm Cedar change' }), { status: 403 })).mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const body = { description: 'Invented note' }, options = { idempotencyKey: 'synthetic-key' }; const write = identity.write('/v1/samples/demo', 'PATCH', body, options);
  await vi.waitFor(() => expect(oversight.pending?.owner).toBe('Cedar')); body.description = 'Changed after request'; options.idempotencyKey = 'changed-key'; oversight.confirm(true); await write;
  expect(fetch.mock.calls.map(([path]) => path)).toEqual(['https://write.invalid/v1/samples/demo', 'https://write.invalid/v1/samples/demo']);
  expect(fetch.mock.calls.map(([, init]) => init.body)).toEqual([JSON.stringify({ description: 'Invented note' }), JSON.stringify({ description: 'Invented note' })]);
  expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('X-UPbDB-Oversight'); expect(fetch.mock.calls[1][1].headers['X-UPbDB-Oversight']).toBe('on-behalf');
  expect(fetch.mock.calls.map(([, init]) => init.headers['Idempotency-Key'])).toEqual(['synthetic-key', 'synthetic-key']);
});
it('allows a progressing transfer longer than 30 seconds and reports non-JSON excerpts', async () => {
  const { oversight } = await import('./oversight.svelte'); oversight.reset();
  identity.target = { server: 'https://progress.invalid', key: 'progress' };
  vi.stubGlobal('sessionStorage', { getItem: () => 'viewer-token' });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
  const fetch = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(new Response('<html>Invented gateway error</html>', { status: 502 }));
  vi.stubGlobal('fetch', fetch); vi.useFakeTimers();
  try {
    const read = identity.get('/v1/sessions?limit=500');
    await vi.advanceTimersByTimeAsync(0);
    const encoder = new TextEncoder(); stream.enqueue(encoder.encode('['));
    await vi.advanceTimersByTimeAsync(20_000); stream.enqueue(encoder.encode('{"id":"invented"}'));
    await vi.advanceTimersByTimeAsync(20_000); stream.enqueue(encoder.encode(']')); stream.close();
    expect((await read).body).toEqual([{ id: 'invented' }]);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await expect(identity.get('/v1/mounts')).rejects.toThrow('Server returned 502: <html>Invented gateway error</html>');
  } finally { vi.useRealTimers(); }
});
it.each([404, 405, 503, 200])('preserves HTTP %i on non-JSON read errors', async status => {
  const { ApiReadError } = await import('./server-error');
  identity.target = { server: 'https://legacy.invalid', key: 'legacy' };
  vi.stubGlobal('sessionStorage', { getItem: () => 'invented-token' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Invented legacy reply</html>', { status })));
  const failure = await identity.get('/v1/fractions?limit=500&mount=synthetic').catch(error => error);
  expect(failure).toBeInstanceOf(ApiReadError);
  expect(failure).toMatchObject({ status, body: null, message: `Server returned ${status}: <html>Invented legacy reply</html>` });
});
it('sends optional idempotency headers, validates before fetching, and preserves structured write errors and Retry-After', async () => {
  const { oversight, WriteError } = await import('./oversight.svelte'); oversight.reset();
  identity.target = { server: 'https://synthetic.invalid', key: 'synthetic' };
  identity.state = { signedIn: true, account: { username: 'synthetic' }, offline: false };
  vi.stubGlobal('sessionStorage', { getItem: () => 'synthetic-token' });
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'idempotency_in_progress', detail: 'Synthetic write still running.' }), { status: 409, headers: { 'Retry-After': '2' } }));
  vi.stubGlobal('fetch', fetch);
  await identity.write('/v1/fractions/f', 'PATCH', { notes: 'Synthetic' });
  await identity.write('/v1/fractions/f', 'PATCH', {}, { idempotencyKey: 'synthetic-key' });
  expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key'); expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe('synthetic-key');
  for (const key of ['', 'a b', 'a\t', 'a\n', 'é', 'x'.repeat(256)]) await expect(identity.write('/v1/fractions/f', 'PATCH', {}, { idempotencyKey: key })).rejects.toThrow('Idempotency-Key');
  expect(fetch).toHaveBeenCalledTimes(2);
  const error = await identity.write('/v1/fractions/f', 'PATCH', {}, { idempotencyKey: 'synthetic-key' }).catch(e => e);
  expect(error).toBeInstanceOf(WriteError); expect(error).toMatchObject({ status: 409, code: 'idempotency_in_progress', detail: 'Synthetic write still running.', retryAfter: '2' });
});

it('announces a fresh authentication when the same signed-in account renews its token', async () => {
  const { oversight } = await import('./oversight.svelte'); oversight.reset();
  vi.stubGlobal('sessionStorage', { getItem: () => 'old-invented-token', setItem: vi.fn() });
  identity.target = { server: 'https://renew.invalid', key: 'renew' };
  identity.state = { signedIn: true, account: { id: 'invented', username: 'invented' }, offline: false };
  const fetch = vi.fn(async () => new Response(JSON.stringify({ token: 'new-invented-token', account: { id: 'invented', username: 'invented' } }), { status: 200 })); vi.stubGlobal('fetch', fetch);
  const before = identity.authentication;
  expect(await identity.login('invented', 'invented-password')).toBe(true);
  expect(identity.authentication).toBe(before + 1);
});
