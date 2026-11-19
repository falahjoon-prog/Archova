import { describe, expect, it, vi } from 'vitest';
import { mobileRoutes } from '@archova/routes';
import { albumSubtitle, photoSubtitle } from '../features/photos';

vi.mock('../features/photos/screens/PhotosScreen', () => ({}));
vi.mock('../features/photos/screens/CaptureScreen', () => ({}));

describe('photo albums on the phone', () => {
  it('counts photos and says how many still need filing', () => {
    expect(albumSubtitle(1)).toBe('1 photo');
    expect(albumSubtitle(12, 3)).toBe('12 photos, 3 to file');
  });
  it('names the photo and where an unfiled one probably belongs', () => {
    const file = { filename: 'slab.jpg' };
    expect(photoSubtitle({ file, needsReview: false, suggestion: null })).toBe('slab.jpg');
    expect(photoSubtitle({ file, needsReview: true, suggestion: null })).toBe(
      'slab.jpg. Not filed yet',
    );
    expect(photoSubtitle({ file, needsReview: true, suggestion: { category: 'punch_list' } })).toBe(
      'slab.jpg. Looks like Punch list',
    );
  });
  it('routes inside the project', () => {
    expect(mobileRoutes.photos('prj_1')).toBe('/project/prj_1/photos');
  });
});
