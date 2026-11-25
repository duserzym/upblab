import { describe, expect, it } from 'vitest';
import { classify, commonStem, expandOpened, fileUrlToPath, fromFileList, parentDir, type DropEntry, type DropRoot } from './drop';

const dir = (name: string, path = `/data/${name}`): DropRoot => ({ name, dir: true, path });
const file = (name: string, path = `/data/${name}`): DropRoot => ({ name, dir: false, path });
const e = (root: number, rel: string, size = 10): DropEntry => ({ root, rel, size });

// grainatlas tests/fixtures/tm4000/Mount_XS_150X, as the host lists it.
const tm4000 = [
  e(0, '001_HJ-GC1/001_HJ-GC1_.ini'),
  e(0, '001_HJ-GC1/001_HJ-GC1_.xml'),
  e(0, '001_HJ-GC1/001_HJ-GC1_0000.jpg', 1000),
  e(0, '001_HJ-GC1/001_HJ-GC1_0000.txt'),
  e(0, '001_HJ-GC1/001_HJ-GC1_0001.jpg', 1000),
  e(0, '001_HJ-GC1/001_HJ-GC1_0001.txt'),
  e(0, 'README.md'),
  e(0, 'Mount_XS_150X.zag'),
  e(0, 'Mount_XS_150X_navigation_small.png'),
  e(0, 'Mount_XS_150X_stitch.jpg', 5000),
  e(0, 'notes.pdf'),
];

// UPbDB tests/fixtures/qtegra/Apatite_demo.
const qtegra = ['1', '10', '13', '141', '15'].map((n) => e(0, `Apatite_demo_${n}.csv`, 100));

describe('classify', () => {
  it('sends a TM4000 package to Images, without the files grainatlas skips', () => {
    const r = classify([dir('Mount_XS_150X')], tm4000);
    expect(r.target).toBe('images');
    if (r.target !== 'images') return;
    expect(r.kind).toBe('package');
    expect(r.name).toBe('Mount_XS_150X');
    expect(r.path).toBe('/data/Mount_XS_150X');
    const paths = r.picks.map((p) => p.path);
    expect(paths).toContain('001_HJ-GC1/001_HJ-GC1_0000.jpg');
    expect(paths).toContain('Mount_XS_150X.zag');
    expect(paths).not.toContain('Mount_XS_150X_stitch.jpg');
    expect(paths).not.toContain('notes.pdf');
    expect(r.bytes).toBe(r.picks.reduce((n, p) => n + tm4000[p.index].size, 0));
  });

  it('a package folder without its .zag is still a package (areas in sub-folders)', () => {
    const r = classify([dir('pkg')], tm4000.filter((x) => !x.rel.endsWith('.zag') && x.rel.includes('/')));
    expect(r.target === 'images' && r.kind).toBe('package');
  });

  it('one area folder on its own', () => {
    const area = tm4000.filter((x) => x.rel.startsWith('001_HJ-GC1/')).map((x) => ({ ...x, rel: x.rel.slice(11) }));
    const r = classify([dir('001_HJ-GC1')], area);
    expect(r.target === 'images' && r.kind).toBe('area');
    expect(r.target === 'images' && r.picks[0].path).toBe('001_HJ-GC1_.ini');
  });

  it('loose images are named after their common stem', () => {
    const roots = [file('grain_001.tif'), file('grain_002.tif'), file('grain_003.tif')];
    const r = classify(roots, roots.map((x, i) => e(i, x.name)));
    expect(r.target).toBe('images');
    if (r.target !== 'images') return;
    expect(r.kind).toBe('images');
    expect(r.name).toBe('grain');
    expect(r.picks.map((p) => p.path)).toEqual(['grain_001.tif', 'grain_002.tif', 'grain_003.tif']);
    expect(r.path).toBe('/data');
  });

  it('a saved grainatlas project folder', () => {
    const r = classify([dir('second.grainatlas')], [e(0, 'project.json'), e(0, 'tiles/0.png')]);
    expect(r.target === 'images' && r.kind).toBe('project');
  });

  it('sends a Qtegra export folder to Sessions with its path', () => {
    const r = classify([dir('Apatite_demo')], [...qtegra, e(0, 'readme.txt')]);
    expect(r.target).toBe('sessions');
    if (r.target !== 'sessions') return;
    expect(r.kind).toBe('export');
    expect(r.name).toBe('Apatite_demo');
    expect(r.path).toBe('/data/Apatite_demo');
    expect(r.picks).toHaveLength(5);
  });

  it('loose CSVs and zips', () => {
    const roots = qtegra.map((x) => file(x.rel));
    const csv = classify(roots, qtegra.map((x, i) => ({ ...x, root: i })));
    expect(csv.target === 'sessions' && csv.kind).toBe('csv');
    expect(csv.target === 'sessions' && csv.name).toBe('Apatite_demo');
    const zip = classify([file('Zircon_02Apr25.zip')], [e(0, 'Zircon_02Apr25.zip')]);
    expect(zip.target === 'sessions' && zip.kind).toBe('zip');
    expect(zip.target === 'sessions' && zip.name).toBe('Zircon_02Apr25');
    expect(zip.target === 'sessions' && zip.path).toBe('/data/Zircon_02Apr25.zip');
  });

  it('a few plots in an export folder do not make it an image set', () => {
    const r = classify([dir('Apatite_demo')], [...qtegra, e(0, 'plot.png')]);
    expect(r.target).toBe('sessions');
  });

  it('several folders keep their names in the paths', () => {
    const r = classify([dir('A'), dir('B')], [e(0, 'x.jpg'), e(1, 'y.jpg')]);
    expect(r.target === 'images' && r.picks.map((p) => p.path)).toEqual(['A/x.jpg', 'B/y.jpg']);
  });

  it('refuses what no module reads, saying what it takes', () => {
    const r = classify([file('report.docx')], [e(0, 'report.docx')]);
    expect(r.target).toBeNull();
    expect(r.target === null && r.reason).toMatch(/TM4000 package/);
    expect(classify([dir('empty')], []).target).toBeNull();
  });
});

describe('paths', () => {
  it('a .zag stands for its package folder', () => {
    expect(expandOpened(['/data/Mount_XS_150X/Mount_XS_150X.zag', '/data/Mount_XS_150X'])).toEqual(['/data/Mount_XS_150X']);
    expect(expandOpened(['C:\\scans\\pkg\\pkg.ZAG'])).toEqual(['C:\\scans\\pkg']);
  });

  it('parent folders on both systems', () => {
    expect(parentDir('/a/b/c.csv')).toBe('/a/b');
    expect(parentDir('/a/b/')).toBe('/a');
    expect(parentDir('/x')).toBe('/');
    expect(parentDir('C:\\d\\e.zip')).toBe('C:\\d');
    expect(parentDir('C:\\e.zip')).toBe('C:\\');
  });

  it('file URLs from Finder and Explorer', () => {
    expect(fileUrlToPath('file:///Users/lab/Mount%20XS/')).toBe('/Users/lab/Mount XS');
    expect(fileUrlToPath('file:///C:/scans/pkg')).toBe('C:\\scans\\pkg');
    expect(fileUrlToPath('upbdb://session/x')).toBeNull();
    expect(fileUrlToPath('not a url')).toBeNull();
  });

  it('common stems like grainatlas', () => {
    expect(commonStem(['a/001_HJ-GC1_0000.jpg', 'a/001_HJ-GC1_0001.jpg'])).toBe('001_HJ-GC1');
    expect(commonStem(['x.jpg', 'y.jpg'])).toBe('');
  });
});

describe('fromFileList', () => {
  it('splits a chosen folder into its root and relative paths, skipping hidden files', () => {
    const f = (rel: string) => Object.assign(new File(['x'], rel.split('/').pop()!), { webkitRelativePath: rel });
    const set = fromFileList([f('Apatite_demo/a.csv'), f('Apatite_demo/.DS_Store'), f('Apatite_demo/sub/b.csv')]);
    expect(set.roots).toEqual([{ name: 'Apatite_demo', dir: true }]);
    expect(set.entries.map((x) => x.rel)).toEqual(['a.csv', 'sub/b.csv']);
    expect(set.files).toHaveLength(2);
  });

  it('loose files are their own roots', () => {
    const set = fromFileList([new File(['x'], 'a.jpg'), new File(['y'], 'b.jpg')]);
    expect(set.roots.map((r) => r.dir)).toEqual([false, false]);
    expect(classify(set.roots, set.entries).target).toBe('images');
  });
});

describe('laser logs', () => {
  it('routes exactly one loose laser log, case-insensitively', () => {
    expect(classify([file('day.LASE')], [e(0, 'day.LASE', 12)])).toEqual({
      target: 'sessions', kind: 'lase', name: 'day.LASE', picks: [{ index: 0, path: 'day.LASE' }], bytes: 12, path: '/data/day.LASE',
    });
  });
  it('refuses several laser log roots', () => {
    expect(classify([file('a.lase'), file('b.lase')], [e(0, 'a.lase'), e(1, 'b.lase')])).toEqual({ target: null, reason: 'Open one laser log at a time.' });
  });
  it('preserves Qtegra classification for folders and mixed loose files', () => {
    const folder = classify([dir('export')], [...qtegra, e(0, 'day.lase')]);
    expect(folder).toMatchObject({ target: 'sessions', kind: 'export' });
    if (folder.target) expect(folder.picks).toHaveLength(qtegra.length);
    expect(classify([file('a.csv'), file('day.lase')], [e(0, 'a.csv'), e(1, 'day.lase')])).toMatchObject({ target: 'sessions', kind: 'csv', picks: [{ index: 0, path: 'a.csv' }] });
    expect(classify([dir('logs')], [e(0, 'day.lase')]).target).toBeNull();
    expect(classify([dir('area')], [e(0, 'a.jpg'), e(0, 'day.lase')])).toMatchObject({ target: 'images', kind: 'area' });
  });
});
