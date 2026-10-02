import { describe, expect, it } from 'vitest';
import { webRoutes } from '../src';

describe('webRoutes project tools', () => {
  it('builds tool URLs under the project and encodes segments', () => {
    expect(webRoutes.rfis('acme', 'prj_1')).toBe('/acme/projects/prj_1/rfis');
    expect(webRoutes.rfi('acme', 'prj_1', 'rfi 1')).toBe('/acme/projects/prj_1/rfis/rfi%201');
    expect(webRoutes.drawing('acme', 'prj_1', 'sht_1')).toBe('/acme/projects/prj_1/drawings/sht_1');
    expect(webRoutes.drawing('acme', 'prj_1', 'sht_1', 'rev_2')).toBe(
      '/acme/projects/prj_1/drawings/sht_1?rev=rev_2',
    );
    expect(webRoutes.diary('acme', 'prj_1')).toBe('/acme/projects/prj_1/diary');
    expect(webRoutes.diary('acme', 'prj_1', '2026-10-02')).toBe(
      '/acme/projects/prj_1/diary/2026-10-02',
    );
    expect(webRoutes.tenderPackage('acme', 'prj_1', 'tpk_1')).toBe(
      '/acme/projects/prj_1/estimating/packages/tpk_1',
    );
  });
});
