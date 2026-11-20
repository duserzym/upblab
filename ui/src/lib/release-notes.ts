import { compareVersions } from './updates';

const notes = import.meta.glob<string>('../../../release-notes/*.md', { query: '?raw', import: 'default', eager: true });
export function bundledNotes(version: string): string {
  return notes[`../../../release-notes/${version}.md`]?.trim() ?? '';
}

export function whatsNewNotes(version: string, bundled: string, savedVersion: string, savedNotes: string): string {
  return bundled.trim() || (savedVersion === version ? savedNotes.trim() : '') || `Updated to v${version}.`;
}

export function isNewerVersion(current: string, lastSeen: string): boolean {
  if (!lastSeen) return false;
  try { return compareVersions(current, lastSeen) > 0; }
  catch { return false; }
}

export function releaseNotesUrl(version: string): string {
  return `https://github.com/duserzym/upblab/releases/tag/v${encodeURIComponent(version)}`;
}
