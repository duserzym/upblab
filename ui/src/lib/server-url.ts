import { normaliseServerUrl } from './links';

/** Web delivery uses its own server; shell dev ports need an explicit override. */
export function resolveServerUrl(stored: string, desktop: boolean, pageUrl: string): string {
  if (desktop) return stored;
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return '';
  }
  const shellDev = (page.hostname === 'localhost' || page.hostname === '127.0.0.1') &&
    (page.port === '1420' || page.port === '1431') &&
    (page.protocol === 'http:' || page.protocol === 'https:');
  if (!shellDev) return page.origin;
  return normaliseServerUrl(page.searchParams.get('server') ?? '') ?? '';
}
