// Small invented mosaic metadata and elements; no lab images or measurements.
import type { GrainAtlas } from '../../src/lib/tims-grain-image';
import type { MountGeometry } from '../../src/lib/tims-geometry';

export const inventedAtlas: GrainAtlas = {
  tile_size: 256,
  areas: [
    { id: 'area-a', uuid: 'invented-area-a', name: 'Invented A', path: 'pyramid/area-a', origin_um: [100, -50], um_per_px: 2, w: 1024, h: 768,
      levels: [{ z: 0, scale: 1, cols: 4, rows: 3, w: 1024, h: 768 }, { z: 1, scale: 2, cols: 2, rows: 2, w: 512, h: 384 }, { z: 2, scale: 4, cols: 1, rows: 1, w: 256, h: 192 }] },
    { id: 'area-b', uuid: 'invented-area-b', name: 'Invented B', path: 'pyramid/area-b', origin_um: [1200, 400], um_per_px: 0.5, w: 600, h: 400,
      levels: [{ z: 0, scale: 1, cols: 3, rows: 2, w: 600, h: 400 }, { z: 1, scale: 2, cols: 2, rows: 1, w: 300, h: 200 }, { z: 2, scale: 4, cols: 1, rows: 1, w: 150, h: 100 }] },
  ],
};
export const inventedElements: MountGeometry = {
  current_project_uuid: 'project-demo',
  grains: [{ id: 'atlas-grain-1', server_id: 'grain-1', area_id: 'area-a', project_uuid: 'project-demo', polygon_um: [[580, 430], [980, 430], [900, 630], [580, 590]], retired: false }],
  spots: [{ id: 'atlas-1', server_id: 'spot-1', x_um: 780, y_um: 510, diameter_um: 40 }],
};
export const atlasListing = { current: { base_url: '/atlas/projects/project-demo/', project_id: 'project-demo', version: 3 }, access: 'invented-read-access' };
export const atlasFixtures = { '/v1/mounts/mount-demo/atlas': atlasListing, '/v1/mounts/mount-demo/elements': inventedElements };
