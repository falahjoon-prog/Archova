import { describe, expect, it } from 'vitest';
import { actorKind, describeAction, parseEventType } from '../../src/domain/audit';

describe('audit log helpers', () => {
  it('splits an event type into action and module', () => {
    expect(parseEventType('rfis.rfi.created.v1')).toEqual({
      action: 'rfis.rfi.created',
      module: 'rfis',
    });
    expect(parseEventType('platform.project.updated')).toEqual({
      action: 'platform.project.updated',
      module: 'platform',
    });
  });
  it('reads the actor kind, treating anything unknown as the system', () => {
    expect(actorKind({ type: 'user', id: 'x' })).toBe('user');
    expect(actorKind({ type: 'link', id: 'x' })).toBe('link');
    expect(actorKind({ type: 'worker' })).toBe('system');
    expect(actorKind(null)).toBe('system');
  });
  it('writes a readable summary', () => {
    expect(describeAction('rfis.rfi.created')).toBe('Rfi created');
    expect(describeAction('defects.defect_event.logged')).toBe('Defect event logged');
    expect(describeAction('orgs.created')).toBe('Orgs created');
  });
});
