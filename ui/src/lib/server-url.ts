import { normaliseServerUrl } from './links';

/**
 * Web delivery uses its own server; shell dev ports need an explicit override.
 * Only vite serve sets the extra dev port via UPBLAB_DEV_PORT; production builds
 * always leave it empty, keeping the development rule limited to 1420 and 1431.
 */
export function resolveServerUrl(stored: string, desktop: boolean, pageUrl: string,
  extraDevPort = typeof __DEV_SHELL_PORT__ === 'string' ? __DEV_SHELL_PORT__ : ''): string {
  if (desktop) return stored;
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return '';
  }
  const validExtraPort = /^\d+$/.test(extraDevPort) && Number(extraDevPort) >= 1 && Number(extraDevPort) <= 65535;
  const shellDev = (page.hostname === 'localhost' || page.hostname === '127.0.0.1') &&
    (page.port === '1420' || page.port === '1431' || (validExtraPort && page.port === String(Number(extraDevPort)))) &&
    (page.protocol === 'http:' || page.protocol === 'https:');
  if (!shellDev) return page.origin;
  return normaliseServerUrl(page.searchParams.get('server') ?? '') ?? '';
}
