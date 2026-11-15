import { describe, expect, it } from 'vitest';
import { initialState, reduce, validateLocal, type Context, type WizardEvent, type WizardState } from './wizard';

const dev: Context = { localAvailable: true, bundled: false };
const bundled: Context = { localAvailable: true, bundled: true };
const serverOnly: Context = { localAvailable: false, bundled: false };

const start = () => initialState({ dataRoot: '~/upbdb', serverUrl: 'http://localhost:8000', devPath: '/src/upbdb' });

function run(events: WizardEvent[], ctx = dev, from = start()): WizardState {
  return events.reduce((s, e) => reduce(s, e, ctx), from);
}

const account: WizardEvent[] = [
  { type: 'edit', field: 'username', value: 'ada' },
  { type: 'edit', field: 'email', value: 'ada@example.org' },
  { type: 'edit', field: 'password', value: 'correct horse' },
  { type: 'edit', field: 'confirm', value: 'correct horse' },
];

describe('first-run wizard', () => {
  it('starts at the mode choice', () => {
    const s = start();
    expect(s.step).toBe('choose');
    expect(s.form.loadDemo).toBe(true);
  });

  it('goes through This computer: form, start, account, done', () => {
    let s = run([{ type: 'choose', mode: 'local' }, ...account, { type: 'submit' }]);
    expect(s.step).toBe('starting');
    s = run([{ type: 'service-ready' }], dev, s);
    expect(s.step).toBe('account');
    s = run([{ type: 'account-created' }], dev, s);
    expect(s.step).toBe('done');
    expect(s.mode).toBe('local');
    expect(s.form.password).toBe('');
    expect(s.form.confirm).toBe('');
    expect(s.form.username).toBe('ada');
  });

  it('keeps This computer closed when this build cannot run it', () => {
    const s = run([{ type: 'choose', mode: 'local' }], serverOnly);
    expect(s.step).toBe('choose');
    expect(run([{ type: 'choose', mode: 'server' }], serverOnly).step).toBe('server');
  });

  it('refuses an invalid account form and clears an error when the field is edited', () => {
    let s = run([{ type: 'choose', mode: 'local' }, { type: 'edit', field: 'username', value: '-x' }, { type: 'submit' }]);
    expect(s.step).toBe('local');
    expect(Object.keys(s.errors).sort()).toEqual(['email', 'password', 'username']);
    s = run([{ type: 'edit', field: 'username', value: 'ada' }], dev, s);
    expect(s.errors.username).toBeUndefined();
    expect(s.errors.email).toBeDefined();
  });

  it('checks passwords: length, confirmation, not the user name', () => {
    const base = { ...start().form, username: 'adalovelace', email: 'a@b.org', dataRoot: '~/x', devPath: '/co' };
    expect(validateLocal({ ...base, password: 'short', confirm: 'short' }, dev).password).toMatch(/8/);
    expect(validateLocal({ ...base, password: 'longenough', confirm: 'different' }, dev).confirm).toBeDefined();
    expect(validateLocal({ ...base, password: 'AdaLovelace', confirm: 'AdaLovelace' }, dev).password).toMatch(/differ/);
    expect(validateLocal({ ...base, password: 'longenough', confirm: 'longenough' }, dev)).toEqual({});
  });

  it('needs a checkout only when nothing is bundled', () => {
    const form = { ...start().form, devPath: '', username: 'ada', email: 'a@b.org', password: 'longenough', confirm: 'longenough' };
    expect(validateLocal(form, dev).devPath).toBeDefined();
    expect(validateLocal(form, bundled).devPath).toBeUndefined();
  });

  it('a failed start shows the log tail, and Retry starts again', () => {
    let s = run([{ type: 'choose', mode: 'local' }, ...account, { type: 'submit' }]);
    s = run([{ type: 'service-failed', message: 'PostgreSQL exited', logTail: 'FATAL: …' }], dev, s);
    expect(s.step).toBe('failed');
    expect(s.failure).toEqual({ stage: 'service', message: 'PostgreSQL exited', logTail: 'FATAL: …' });
    s = run([{ type: 'retry' }], dev, s);
    expect(s.step).toBe('starting');
    expect(s.failure).toBeNull();
    // The password is still there for the account step after a retry.
    expect(s.form.password).toBe('correct horse');
  });

  it('a failed account creation can be retried or edited', () => {
    let s = run([{ type: 'choose', mode: 'local' }, ...account, { type: 'submit' }, { type: 'service-ready' }]);
    s = run([{ type: 'account-failed', message: 'password too common' }], dev, s);
    expect(s.failure?.stage).toBe('account');
    const edited = run([{ type: 'back' }], dev, s);
    expect(edited.step).toBe('local');
    expect(run([{ type: 'retry' }], dev, s).step).toBe('starting');
  });

  it('can switch to a lab server after a failure, dropping the password', () => {
    let s = run([{ type: 'choose', mode: 'local' }, ...account, { type: 'submit' }, { type: 'service-failed', message: 'x' }]);
    s = run([{ type: 'use-server' }], dev, s);
    expect(s.step).toBe('server');
    expect(s.mode).toBe('server');
    expect(s.form.password).toBe('');
  });

  it('Lab server: validates and normalises the URL', () => {
    let s = run([{ type: 'choose', mode: 'server' }, { type: 'edit', field: 'serverUrl', value: 'ftp://x' }, { type: 'submit' }]);
    expect(s.step).toBe('server');
    expect(s.errors.serverUrl).toBeDefined();
    s = run([{ type: 'edit', field: 'serverUrl', value: 'https://upbdb.example.edu/' }, { type: 'submit' }], dev, s);
    expect(s.step).toBe('done');
    expect(s.mode).toBe('server');
    expect(s.form.serverUrl).toBe('https://upbdb.example.edu');
  });

  it('back returns to the choice', () => {
    expect(run([{ type: 'choose', mode: 'server' }, { type: 'back' }]).step).toBe('choose');
    expect(run([{ type: 'choose', mode: 'local' }, { type: 'back' }]).mode).toBeNull();
  });

  it('ignores events that do not belong to the current step', () => {
    const s = start();
    for (const e of [
      { type: 'submit' },
      { type: 'service-ready' },
      { type: 'account-created' },
      { type: 'retry' },
      { type: 'use-server' },
      { type: 'edit', field: 'username', value: 'x' },
    ] as WizardEvent[]) {
      expect(reduce(s, e, dev)).toBe(s);
    }
    const starting = run([{ type: 'choose', mode: 'local' }, ...account, { type: 'submit' }]);
    expect(reduce(starting, { type: 'edit', field: 'password', value: 'x' }, dev)).toBe(starting);
    expect(reduce(starting, { type: 'account-created' }, dev)).toBe(starting);
  });
});
