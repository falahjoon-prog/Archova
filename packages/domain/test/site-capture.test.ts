import { describe, expect, it } from 'vitest';
import { CAPTURE_FRAME_SOURCES, parseCaptureLink } from '../src/site-capture';

describe('parseCaptureLink', () => {
  it('accepts share links from the supported providers', () => {
    expect(parseCaptureLink('https://my.matterport.com/show/?m=SxQL3iGyoDo')).toEqual({
      provider: 'matterport',
      url: 'https://my.matterport.com/show/?m=SxQL3iGyoDo',
    });
    expect(parseCaptureLink(' https://kuula.co/share/7vXpl ')?.provider).toBe('kuula');
    expect(parseCaptureLink('https://tour.theta360.com/s/abc')?.provider).toBe('ricoh');
  });

  it('drops the fragment', () => {
    expect(parseCaptureLink('https://kuula.co/share/7vXpl#frag')?.url).toBe(
      'https://kuula.co/share/7vXpl',
    );
  });

  it('refuses other hosts, look-alikes, plain http, credentials, ports and bare hosts', () => {
    for (const bad of [
      'https://example.com/show/?m=1',
      'https://matterport.com.evil.example/show/?m=1',
      'https://evilmatterport.com/show/?m=1',
      'http://my.matterport.com/show/?m=1',
      'https://user:pw@my.matterport.com/show/?m=1',
      'https://my.matterport.com:8443/show/?m=1',
      'https://my.matterport.com/',
      'javascript:alert(1)',
      'not a url',
    ])
      expect(parseCaptureLink(bad), bad).toBeNull();
  });

  it('lists every provider host for the frame policy', () => {
    expect(CAPTURE_FRAME_SOURCES).toContain('https://my.matterport.com');
    expect(CAPTURE_FRAME_SOURCES).toContain('https://*.kuula.co');
  });
});
