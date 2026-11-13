import { afterEach, describe, expect, it, vi } from 'vitest';
import { settings } from './settings.svelte';
import { shell } from './shell.svelte';
import { identity } from './identity.svelte';
import { probe } from './platform';

afterEach(() => vi.unstubAllGlobals());

describe('web request routing', () => {
  it.each([
    ['http://127.0.0.1:8765/desk/?server=http://localhost:8000', 'http://127.0.0.1:8765'],
    ['http://localhost:1420/?server=http://localhost:8000', 'http://localhost:8000'],
    ['http://127.0.0.1:1431/desk/open?server=https://dev.example.test', 'https://dev.example.test'],
  ])('routes probes, modules, identity and API reads from %s to %s', async (page, origin) => {
    vi.stubGlobal('location', new URL(page));
    const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ username: 'demo' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('sessionStorage', { getItem: () => 'invented-token' });
    settings.serverUrl = 'https://stored.example.test';
    settings.mode = 'local'; // Even a desktop local-mode setting cannot change the web target.
    expect(shell.local).toBe(false);
    expect(shell.serverUrl).toBe(origin);
    expect(shell.identityTarget).toEqual({ server: origin, key: origin });
    expect(shell.homeUrl('sessions')).toMatch(new RegExp(`^${origin}/app/`));
    expect(shell.homeUrl('people')).toMatch(new RegExp(`^${origin}/app/`));
    shell.load('images', '/atlas/?project=invented-project');
    expect(shell.targets.images?.url).toContain(`server=${encodeURIComponent(origin)}`);
    await probe(shell.homeUrl('sessions'));
    await identity.restore(shell.identityTarget!);
    expect(identity.target?.server).toBe(origin);
    await identity.get('/v1/sessions');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).origin)).toEqual([origin, origin, origin]);
  });

  it.each([
    'http://localhost:1420/', 'http://127.0.0.1:1420/desk/',
    'http://localhost:1431/', 'http://127.0.0.1:1431/desk/open',
    'http://localhost:1431/?server=invalid',
  ])('leaves modules and identity without a server on %s', page => {
    vi.stubGlobal('location', new URL(page));
    settings.serverUrl = 'http://localhost:8000';
    settings.mode = 'local';
    expect(shell.local).toBe(false);
    expect(shell.serverUrl).toBe('');
    expect(shell.bases.server).toBe('');
    expect(shell.identityTarget).toBeNull();
    shell.load('images', '/atlas/?project=invented-project');
    expect(new URL(shell.targets.images!.url).searchParams.has('server')).toBe(false);
  });
});
