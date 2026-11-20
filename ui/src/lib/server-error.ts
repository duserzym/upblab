/**
 * One sentence for people from a UPbDB error reply (sync contract,
 * November 2026, section 1): the server's `detail` (or `message` when
 * `detail` is a list), else a sentence chosen by status. Raw bodies and ids
 * stay out of the interface; callers log them when needed.
 */
export function serverMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as { detail?: unknown; message?: unknown };
  if (typeof b.detail === 'string' && b.detail.trim()) return b.detail.trim();
  if (typeof b.message === 'string' && b.message.trim()) return b.message.trim();
  return statusSentence(status);
}

/** API reads keep the HTTP status alongside the server's explanation. */
export function apiReplyMessage(reply: { status: number; body: unknown; error?: string }): string {
  return reply.error || `Server returned ${reply.status}: ${serverMessage(reply.body, reply.status)}`;
}

/** Keep HTTP status available even when an API reply is not JSON. */
export class ApiReadError extends Error {
  constructor(public status: number, public body: unknown, message: string) { super(message); }
}

export function statusSentence(status: number): string {
  if (status === 401) return 'Sign in again to continue.';
  if (status === 403) return 'Your account does not have access to this.';
  if (status === 404) return 'The server does not have this item.';
  if (status === 409) return 'This changed on the server in the meantime. Reload and try again.';
  if (status === 422 || status === 400) return 'The server did not accept the request.';
  if (status === 0) return 'The server could not be reached.';
  if (status >= 500) return 'The server had a problem. Try again in a moment.';
  return `The server refused the request (status ${status}).`;
}

/** The stable `code` of an error reply, for logs and decisions; '' when absent. */
export function serverCode(body: unknown): string {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : '';
}
