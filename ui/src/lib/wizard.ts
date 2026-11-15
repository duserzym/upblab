// First-run wizard (ADR-0003, "First run") as a pure state machine. The
// component (components/FirstRun.svelte) renders the state and performs the
// side effects a step asks for: starting the local service on `starting`,
// creating the account on `account`, saving the settings on `done`.
//
//   choose ──local──> local ──submit──> starting ──ready──> account ──created──> done
//     │                 ▲                 │  ▲                 │
//     │                 └──────back────── failed <───failed────┘
//     │                                   │ retry ─> starting
//     └──server──> server ──submit──> done  use-server ─> server

import { normaliseServerUrl } from './links';

export type WizardMode = 'local' | 'server';
export type Step = 'choose' | 'local' | 'server' | 'starting' | 'account' | 'failed' | 'done';

export interface Form {
  dataRoot: string;
  devPath: string;
  username: string;
  email: string;
  password: string;
  confirm: string;
  loadDemo: boolean;
  serverUrl: string;
}

export type Errors = Partial<Record<keyof Form, string>>;

export interface Failure {
  /** Where it failed: starting the service or creating the account. */
  stage: 'service' | 'account';
  message: string;
  logTail: string;
}

export interface WizardState {
  step: Step;
  mode: WizardMode | null;
  form: Form;
  errors: Errors;
  failure: Failure | null;
}

export interface Context {
  /** "This computer" can run here (bundled service, or a dev checkout). */
  localAvailable: boolean;
  /** A bundled service: the checkout field is not needed. */
  bundled: boolean;
}

export type WizardEvent =
  | { type: 'choose'; mode: WizardMode }
  | { type: 'back' }
  | { type: 'edit'; field: keyof Form; value: string | boolean }
  | { type: 'submit' }
  | { type: 'service-ready' }
  | { type: 'service-failed'; message: string; logTail?: string }
  | { type: 'account-created' }
  | { type: 'account-failed'; message: string; logTail?: string }
  | { type: 'retry' }
  | { type: 'use-server' };

export function initialState(defaults: { dataRoot: string; serverUrl: string; devPath: string }): WizardState {
  return {
    step: 'choose',
    mode: null,
    form: {
      dataRoot: defaults.dataRoot,
      devPath: defaults.devPath,
      username: '',
      email: '',
      password: '',
      confirm: '',
      loadDemo: true,
      serverUrl: defaults.serverUrl,
    },
    errors: {},
    failure: null,
  };
}

/** Same rule as `valid_username` in src-tauri/src/local_service/mod.rs (Django's, minus a leading dash). */
export const USERNAME = /^(?!-)[\p{L}\p{N}@.+_-]{1,150}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLocal(form: Form, ctx: Context): Errors {
  const e: Errors = {};
  if (!form.dataRoot.trim()) e.dataRoot = 'Choose a folder for the data root.';
  if (!ctx.bundled && !form.devPath.trim()) e.devPath = 'This build has no bundled service: give the path of a UPbDB checkout.';
  if (!USERNAME.test(form.username.trim())) e.username = 'Letters, digits and @ . + - _ only, not starting with -.';
  if (!EMAIL.test(form.email.trim())) e.email = 'Enter an email address.';
  if ([...form.password].length < 8) e.password = 'At least 8 characters.';
  else if (form.password.toLowerCase() === form.username.trim().toLowerCase()) e.password = 'Must differ from the user name.';
  if (form.confirm !== form.password) e.confirm = 'The two passwords differ.';
  return e;
}

export function validateServer(form: Form): Errors {
  return normaliseServerUrl(form.serverUrl) ? {} : { serverUrl: 'Enter a full http:// or https:// URL, e.g. https://upbdb.example.edu' };
}

/** Drop secrets once they are no longer needed. */
function forgetPasswords(form: Form): Form {
  return { ...form, password: '', confirm: '' };
}

export function reduce(state: WizardState, event: WizardEvent, ctx: Context): WizardState {
  const at = (step: Step, patch: Partial<WizardState> = {}): WizardState => ({ ...state, step, ...patch });
  switch (event.type) {
    case 'choose':
      if (state.step !== 'choose') return state;
      if (event.mode === 'local' && !ctx.localAvailable) return state;
      return at(event.mode, { mode: event.mode, errors: {} });

    case 'back':
      if (state.step === 'local' || state.step === 'server') return at('choose', { mode: null, errors: {} });
      if (state.step === 'failed') return at('local', { failure: null });
      return state;

    case 'edit': {
      if (state.step !== 'local' && state.step !== 'server') return state;
      const errors = { ...state.errors };
      delete errors[event.field];
      return { ...state, form: { ...state.form, [event.field]: event.value }, errors };
    }

    case 'submit':
      if (state.step === 'local') {
        const errors = validateLocal(state.form, ctx);
        return Object.keys(errors).length ? { ...state, errors } : at('starting', { errors: {}, failure: null });
      }
      if (state.step === 'server') {
        const errors = validateServer(state.form);
        if (Object.keys(errors).length) return { ...state, errors };
        const serverUrl = normaliseServerUrl(state.form.serverUrl)!;
        return at('done', { mode: 'server', form: forgetPasswords({ ...state.form, serverUrl }), errors: {} });
      }
      return state;

    case 'service-ready':
      return state.step === 'starting' ? at('account') : state;

    case 'service-failed':
      return state.step === 'starting'
        ? at('failed', { failure: { stage: 'service', message: event.message, logTail: event.logTail ?? '' } })
        : state;

    case 'account-created':
      return state.step === 'account' ? at('done', { form: forgetPasswords(state.form) }) : state;

    case 'account-failed':
      return state.step === 'account'
        ? at('failed', { failure: { stage: 'account', message: event.message, logTail: event.logTail ?? '' } })
        : state;

    case 'retry':
      return state.step === 'failed' ? at('starting', { failure: null }) : state;

    case 'use-server':
      return state.step === 'failed' || state.step === 'starting'
        ? at('server', { mode: 'server', failure: null, form: forgetPasswords(state.form), errors: {} })
        : state;
  }
}
