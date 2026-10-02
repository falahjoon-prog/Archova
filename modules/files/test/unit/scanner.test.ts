import { describe, expect, it } from 'vitest';
import type { GetObjectTaggingCommand } from '@aws-sdk/client-s3';
import { createGuardDutyScanner, guardDutyVerdict } from '../../src/infra/scanner';

describe('GuardDuty scan verdicts (security-licensing/09 §4)', () => {
  it('maps the result tag and fails closed on anything but a clean result', () => {
    expect(guardDutyVerdict(undefined)).toBe('pending');
    expect(guardDutyVerdict('NO_THREATS_FOUND')).toBe('clean');
    expect(guardDutyVerdict('THREATS_FOUND')).toBe('infected');
    for (const tag of ['UNSUPPORTED', 'FAILED', 'ACCESS_DENIED', 'SOMETHING_NEW'])
      expect(guardDutyVerdict(tag)).toBe('unscannable');
  });

  it('reads the GuardDutyMalwareScanStatus tag on the quarantine object', async () => {
    const sent: GetObjectTaggingCommand[] = [];
    let tags: Array<{ Key: string; Value: string }> = [{ Key: 'other', Value: 'x' }];
    const s3 = {
      send: async (cmd: GetObjectTaggingCommand) => {
        sent.push(cmd);
        return { TagSet: tags };
      },
    } as unknown as Parameters<typeof createGuardDutyScanner>[1];
    const scanner = createGuardDutyScanner({ bucket: 'files', region: 'ap-southeast-2' }, s3);

    expect(await scanner.scan('quarantine/u1')).toBe('pending');
    expect(sent[0]!.input).toEqual({ Bucket: 'files', Key: 'quarantine/u1' });
    tags = [...tags, { Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' }];
    expect(await scanner.scan('quarantine/u1')).toBe('clean');
  });
});
