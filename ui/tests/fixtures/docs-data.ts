import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { demoAtlasStatus, demoElements } from './demo-atlas';

interface DocsCapture {
  scope: {
    session: string; mount: string; project: string; run: string;
    focusKey: string; focusLabel: string; sessions: number; mounts: number;
  };
  api: Record<string, unknown>;
}

interface AtlasProject {
  name: string;
  package: { name: string };
  areas: { id: string; sample: string }[];
  grainatlas_ui: {
    spots: unknown[]; labels: unknown[];
    grains: Record<string, { sample?: string | null; [key: string]: unknown }[]>;
  };
}

/** Read the relabelled capture in place; never copy its data into the repository. */
export function loadDocsData(folder: string) {
  if (!isAbsolute(folder)) throw new Error('DOCS_DATA must be an absolute folder.');
  const capture = JSON.parse(readFileSync(resolve(folder, 'capture.json'), 'utf8')) as DocsCapture;
  const { project, mount } = capture.scope;
  const atlasRoot = resolve(folder, 'atlas');
  const atlas = JSON.parse(readFileSync(resolve(atlasRoot, 'project.json'), 'utf8')) as AtlasProject;
  const { name } = atlas, packageName = atlas.package.name;
  // GrainAtlas compares opaque hashes and revisions for its read-only sync state.
  // Echo the bundle elements so newer builds do not report a first sync needed.
  const elements = { ...demoElements, mount_id: mount, current_project_uuid: project,
    project_uuids: [project], spots: atlas.grainatlas_ui.spots, labels: atlas.grainatlas_ui.labels,
    grains: Object.entries(atlas.grainatlas_ui.grains).flatMap(([area_id, grains]) => grains.map(grain => ({
      ...grain, area_id, sample: grain.sample !== undefined ? grain.sample : atlas.areas.find(area => area.id === area_id)?.sample ?? null,
    }))) };
  const status = { ...demoAtlasStatus, project_uuid: project, mount_id: mount,
    mount_label: name, name, package_name: packageName, current_project_uuid: project,
    counts: { spots: elements.spots.length, grains: elements.grains.length, labels: elements.labels.length,
      grains_retired: 0, grains_without_atlas_id: 0 },
    project_uuids: [{ project_uuid: project, name, package_name: packageName, is_current: true }], can_edit: false };
  return { ...capture, atlasRoot, api: { ...capture.api,
    [`/v1/atlas/projects/${project}`]: status,
    [`/v1/atlas/projects/${project}/elements`]: elements,
  } as Record<string, unknown> };
}
