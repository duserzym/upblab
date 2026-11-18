import { describe, expect, it } from 'vitest';
import { hasHomePin, MAX_HOME_PINS, pinAccountKey, readHomePins, toggleHomePin, type HomePin } from './home-pins';
const account = 'https://lab.example|demo';
const at = '2026-11-18T10:00:00Z';
const session = { kind: 'session' as const, id: 's1', label: 'Demo session' };
const mount = { kind: 'mount' as const, id: 'm1', label: 'Demo mount' };
const pin = { ...session, pinned_at: at };

describe('Home pins', () => {
  it('adds immediately, preserves pin order, removes and appends a re-pinned item without mutating inputs', () => {
    const first = toggleHomePin({}, account, session, at);
    const second = toggleHomePin(first, account, mount, at);
    expect(second[account]).toEqual([pin, { ...mount, pinned_at: at }]);
    expect(first[account]).toEqual([pin]);
    expect(hasHomePin(second[account], 'session', 's1')).toBe(true);
    const removed = toggleHomePin(second, account, session, at);
    expect(removed[account]).toEqual([{ ...mount, pinned_at: at }]);
    expect(toggleHomePin(removed, account, session, at)[account].map(p => p.id)).toEqual(['m1', 's1']);
  });
  it('isolates accounts, servers and item kinds with matching IDs', () => {
    let all = toggleHomePin({}, account, session, at);
    const other = pinAccountKey('https://lab.example', 'other')!;
    const otherServer = pinAccountKey('https://other.example', 'demo')!;
    all = toggleHomePin(all, other, mount, at);
    all = toggleHomePin(all, otherServer, { ...mount, id: 's1' }, at);
    all = toggleHomePin(all, account, { ...mount, id: 's1' }, at);
    expect(all[account]).toHaveLength(2);
    expect(all[other]).toEqual([{ ...mount, pinned_at: at }]);
    expect(all[otherServer][0].kind).toBe('mount');
    expect(pinAccountKey(undefined, 'demo')).toBeNull();
    expect(pinAccountKey('this-computer', undefined)).toBeNull();
    expect(pinAccountKey('this-computer', 'local')).toBe('this-computer|local');
  });
  it('caps each account at 50 without dropping earlier pins, and allows removal at the cap', () => {
    let all = {};
    for (let i = 0; i < 60; i++) all = toggleHomePin(all, account, { ...session, id: `s${i}` }, at);
    const checked = readHomePins(all);
    expect(checked[account]).toHaveLength(MAX_HOME_PINS);
    expect(checked[account][0].id).toBe('s0');
    expect(checked[account].at(-1)?.id).toBe('s49');
    expect(toggleHomePin(checked, account, { ...session, id: 's0' }, at)[account]).toHaveLength(49);
    expect(toggleHomePin(checked, 'other|demo', mount, at)['other|demo']).toHaveLength(1);
  });
  it.each([null, [], true, 4, 'bad', undefined])('ignores malformed stores: %j', value => {
    expect(readHomePins(value)).toEqual({});
  });
  it('drops unknown fields, invalid accounts/items and duplicates while retaining valid pin order', () => {
    const garbage = [null, [], {}, true, { ...pin, kind: 'sample' }, { ...pin, id: '../bad' },
      { ...pin, label: '' }, { ...pin, label: '\n' }, { ...pin, label: 'x'.repeat(513) },
      { ...pin, pinned_at: 'yesterday' }, { ...pin, pinned_at: 12 }];
    expect(readHomePins({ bad: [pin], '|demo': [pin], 'server|': [pin], 'server|demo': {},
      [account]: [...garbage, { ...pin, extra: true }, pin, { ...mount, pinned_at: at }] }))
      .toEqual({ [account]: [pin, { ...mount, pinned_at: at }] });
    expect(toggleHomePin({}, account, { ...session, kind: 'bad' as HomePin['kind'] }, at)).toEqual({});
  });
  it('caps restored lists after validation and deduplication', () => {
    const entries = Array.from({ length: 70 }, (_, i) => ({ ...pin, id: `s${i}` }));
    expect(readHomePins({ [account]: [null, pin, pin, ...entries] })[account]).toHaveLength(50);
  });
});
