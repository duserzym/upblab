// Where dropped or opened files go (ux-conventions rule 4: open anything, never
// ask what it is). The same rules serve both deliveries: on the desktop the
// host lists the paths (src-tauri/src/files.rs `files_scan`), on the web the
// page walks the dropped folders itself; the result is a set of roots and the
// files under them.
//
//   a `.grainatlas` folder                    -> Images, project
//   a TM4000 package (a `.zag`, or area
//     sub-folders with images)                -> Images, package
//   one folder with images in it              -> Images, area
//   loose image files                         -> Images, images
//   a folder of CSVs (a Qtegra export)        -> Sessions, export
//   zips                                      -> Sessions, zip
//   loose CSVs                                -> Sessions, csv
//
// Images and CSVs in one set: the larger group wins, images on a tie.

import type { OpenFilesKind } from '@lab/bridge';

/** Only these module tabs accept dropped or uploaded files. */
export type FileTab = 'images' | 'sessions';

export interface DropRoot {
  /** Last path segment: the folder or file name. */
  name: string;
  dir: boolean;
  /** Desktop: the host path. */
  path?: string;
}

export interface DropEntry {
  /** Index into the roots. */
  root: number;
  /** `/`-separated path inside the root folder; the file name for a file root. */
  rel: string;
  size: number;
}

export interface DropPick {
  /** Index into the entries. */
  index: number;
  /** The path the module sees (relative to the dropped folder, or `<folder>/…` when several were dropped). */
  path: string;
}

export type Routed =
  | {
      target: FileTab;
      kind: OpenFilesKind;
      /** A name for the set: the folder, the zip, or the files' common stem. */
      name: string;
      picks: DropPick[];
      bytes: number;
      /** Desktop: the host path for `upbdb://ingest?path=` (the folder, zip, or the loose files' folder). */
      path?: string;
    }
  | { target: null; reason: string };

const IMAGE = /\.(jpe?g|tiff?|png|bmp)$/i;
const CSV = /\.csv$/i;
const ZIP = /\.zip$/i;
const ZAG = /\.zag$/i;
const PROJECT = /\.grainatlas$/i;

/** grainatlas's own filter (ui/src/lib/files.ts `keep`): what its readers never need. */
function atlasKeeps(rel: string): boolean {
  const n = rel.split('/').pop() ?? rel;
  if (n.startsWith('.')) return false;
  if (/_stitch\.jpe?g$/i.test(n)) return false;
  return !/\.(pptx?|docx?|xlsx?|pdf|zip)$/i.test(n);
}

/** Common stem of file names (as grainatlas `commonStem`): no half-cut running number or trailing separators. */
export function commonStem(names: string[]): string {
  const stems = names.map((n) => (n.split('/').pop() ?? n).replace(/\.[^.]*$/, ''));
  if (!stems.length) return '';
  if (stems.length === 1) return stems[0];
  let n = stems[0].length;
  for (const s of stems.slice(1)) {
    let k = 0;
    while (k < n && k < s.length && s[k] === stems[0][k]) k++;
    n = k;
  }
  let p = stems[0].slice(0, n);
  // A running number cut in half (`_1` of `_1`, `_10`, `_141`) is not part of the stem.
  if (stems.some((s) => /^\d/.test(s.slice(n)))) p = p.replace(/\d+$/, '');
  p = p.replace(/[_\- .]+$/, '');
  return p.length >= 3 ? p : '';
}

/** The folder a host path is in (either separator). */
export function parentDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (cut < 0) return trimmed;
  if (cut === 0) return trimmed.slice(0, 1);
  // Keep `C:\` for a file at a drive root.
  return /^[A-Za-z]:$/.test(trimmed.slice(0, cut)) ? trimmed.slice(0, cut + 1) : trimmed.slice(0, cut);
}

/**
 * Paths as the OS hands them over, made ready to list: a `.zag` file (Finder
 * "Open with", a Windows file association) stands for its package folder.
 */
export function expandOpened(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const q = ZAG.test(p) ? parentDir(p) : p;
    if (q && !out.includes(q)) out.push(q);
  }
  return out;
}

/** `file:///Users/x/a b` -> `/Users/x/a b`; `file:///C:/x` -> `C:\x`; null for other URLs. */
export function fileUrlToPath(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'file:') return null;
  const path = decodeURIComponent(u.pathname);
  if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1).replace(/\//g, '\\');
  if (u.host) return `\\\\${u.host}${path.replace(/\//g, '\\')}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function classify(roots: DropRoot[], entries: DropEntry[]): Routed {
  if (!roots.length || !entries.length) return { target: null, reason: 'nothing to open: no files found' };
  const dirs = roots.filter((r) => r.dir);
  const oneFolder = roots.length === 1 && roots[0].dir;
  const where = (e: DropEntry) => (oneFolder || !roots[e.root].dir ? e.rel : `${roots[e.root].name}/${e.rel}`);
  const hostPath = roots.length === 1 ? roots[0].path : roots[0].path ? parentDir(roots[0].path) : undefined;

  const images = entries.filter((e) => IMAGE.test(e.rel) && atlasKeeps(e.rel)).length;
  const csvs = entries.filter((e) => CSV.test(e.rel)).length;
  const zips = entries.filter((e) => ZIP.test(e.rel)).length;
  const project = dirs.find((r) => PROJECT.test(r.name));

  const pick = (keep: (e: DropEntry) => boolean): { picks: DropPick[]; bytes: number; names: string[] } => {
    const picks: DropPick[] = [];
    let bytes = 0;
    entries.forEach((e, index) => {
      if (!keep(e)) return;
      picks.push({ index, path: where(e) });
      bytes += e.size;
    });
    return { picks, bytes, names: picks.map((p) => p.path) };
  };

  if (project || (images > 0 && images >= csvs + zips)) {
    const { picks, bytes, names } = pick((e) => atlasKeeps(e.rel));
    let kind: OpenFilesKind;
    if (project) kind = 'project';
    else if (entries.some((e) => ZAG.test(e.rel))) kind = 'package';
    else if (oneFolder) kind = entries.some((e) => IMAGE.test(e.rel) && !e.rel.includes('/')) ? 'area' : 'package';
    else kind = 'images';
    const name = project ? project.name : dirs.length === 1 && roots.length === 1 ? dirs[0].name : commonStem(names) || 'images';
    return { target: 'images', kind, name, picks, bytes, path: hostPath };
  }

  if (csvs + zips > 0) {
    const { picks, bytes, names } = pick((e) => CSV.test(e.rel) || ZIP.test(e.rel));
    const kind: OpenFilesKind = oneFolder ? 'export' : csvs === 0 ? 'zip' : 'csv';
    const name = oneFolder
      ? roots[0].name
      : kind === 'zip' && picks.length === 1
        ? (names[0].split('/').pop() ?? names[0]).replace(ZIP, '')
        : commonStem(names) || 'session';
    return { target: 'sessions', kind, name, picks, bytes, path: hostPath };
  }

  return {
    target: null,
    reason: 'nothing to open: no images, Qtegra CSVs or zips (drop a TM4000 package, an area folder, images, or a Qtegra export)',
  };
}

// ------------------------------------------------ web delivery: files in the page

/** Roots and entries of a browser drop or file input, with the File of each entry. */
export interface WebSet {
  roots: DropRoot[];
  entries: DropEntry[];
  files: File[];
}

const MAX_DEPTH = 4;

/** A browser drop: dropped folders are walked (as deep as the desktop host walks them). */
export async function fromDataTransfer(dt: DataTransfer): Promise<WebSet> {
  const set: WebSet = { roots: [], entries: [], files: [] };
  const items = Array.from(dt.items ?? [])
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean) as FileSystemEntry[];
  if (!items.length) {
    for (const f of Array.from(dt.files ?? [])) {
      const root = set.roots.push({ name: f.name, dir: false }) - 1;
      set.entries.push({ root, rel: f.name, size: f.size });
      set.files.push(f);
    }
    return set;
  }
  const file = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej));
  async function walk(dir: FileSystemDirectoryEntry, root: number, prefix: string, depth: number) {
    const reader = dir.createReader();
    for (;;) {
      const batch: FileSystemEntry[] = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) {
        if (e.name.startsWith('.')) continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory) {
          if (depth < MAX_DEPTH) await walk(e as FileSystemDirectoryEntry, root, rel, depth + 1);
        } else {
          const f = await file(e as FileSystemFileEntry);
          set.entries.push({ root, rel, size: f.size });
          set.files.push(f);
        }
      }
    }
  }
  for (const item of items) {
    const root = set.roots.push({ name: item.name, dir: item.isDirectory }) - 1;
    if (item.isDirectory) await walk(item as FileSystemDirectoryEntry, root, '', 0);
    else {
      const f = await file(item as FileSystemFileEntry);
      set.entries.push({ root, rel: f.name, size: f.size });
      set.files.push(f);
    }
  }
  return set;
}

/** An `<input type=file>`: a chosen folder (webkitdirectory) or chosen files. */
export function fromFileList(list: FileList | File[]): WebSet {
  const set: WebSet = { roots: [], entries: [], files: [] };
  const folders = new Map<string, number>();
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const parts = rel.split('/');
    if (parts.length > 1) {
      if (parts.some((p) => p.startsWith('.'))) continue;
      let root = folders.get(parts[0]);
      if (root === undefined) {
        root = set.roots.push({ name: parts[0], dir: true }) - 1;
        folders.set(parts[0], root);
      }
      set.entries.push({ root, rel: parts.slice(1).join('/'), size: f.size });
    } else {
      const root = set.roots.push({ name: f.name, dir: false }) - 1;
      set.entries.push({ root, rel: f.name, size: f.size });
    }
    set.files.push(f);
  }
  return set;
}

/** Bytes for people: 324 KB, 1.2 GB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
