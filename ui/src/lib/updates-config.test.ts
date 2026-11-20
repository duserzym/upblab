import { describe, expect, it } from 'vitest';
import configJson from '../../../src-tauri/tauri.conf.json?raw';
import releaseConfigJson from '../../../src-tauri/tauri.release.conf.json?raw';
import { bundledNotes } from './release-notes';
import { checkButtonView, STABLE_ENDPOINT, UPDATE_APP_NAME } from './updates';

const config = JSON.parse(configJson);
const releaseConfig = JSON.parse(releaseConfigJson);

describe('signed update configuration', () => {
  it('uses the canonical stable feed and the configured display name', () => {
    const endpoint = 'https://github.com/duserzym/upblab/releases/latest/download/latest.json';
    expect(config.plugins.updater.endpoints).toEqual([endpoint]);
    expect(STABLE_ENDPOINT).toBe(endpoint);
    expect(UPDATE_APP_NAME).toBe(config.productName);
    // A release override must retain the same stable endpoint if it supplies one.
    expect(releaseConfig.plugins?.updater?.endpoints ?? config.plugins.updater.endpoints).toEqual([endpoint]);
  });

  it('bundles the running stable version notes', () => {
    expect(config.version).toBe(__APP_VERSION__);
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bundledNotes(config.version)).not.toBe('');
  });

  it('creates signed updater artifacts for releases', () => {
    expect(releaseConfig.bundle.createUpdaterArtifacts).toBe(true);
  });

  it('has an empty key with configuration feedback, or a minisign public key', () => {
    const keys = [config.plugins.updater.pubkey];
    if (releaseConfig.plugins?.updater && 'pubkey' in releaseConfig.plugins.updater) {
      keys.push(releaseConfig.plugins.updater.pubkey);
    }
    for (const pubkey of keys) {
      expect(typeof pubkey).toBe('string');
      if (pubkey === '') {
        // This is the diagnostic returned by the native empty-key guard.
        expect(checkButtonView({ kind: 'error', message: 'Updater public key is not configured' }, config.version).text)
          .toBe('Updates are not configured for this build yet.');
        continue;
      }
      // atob rejects invalid base64 rather than silently discarding bad bytes.
      const decoded = atob(pubkey).trimEnd();
      const lines = decoded.split(/\r?\n/);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^untrusted comment: minisign public key: .+$/);
      expect(lines[1]).toMatch(/^RW[A-Za-z0-9+/]+={0,2}$/);
      const key = atob(lines[1]);
      expect(key).toHaveLength(42);
      expect(key.slice(0, 2)).toBe('Ed');
    }
  });
});
