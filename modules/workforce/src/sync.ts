import { decodeId } from '@archova/domain';
import { AppError, type SyncCommand } from '@archova/kernel';
import type { AttendanceService } from './application/attendance';

const invalid = (path: string, message = 'Invalid') =>
  new AppError('validation_failed', message, [{ path, message }]);

/**
 * Commands a device may queue offline. Signing out is the one that matters after access ends: a worker who is
 * removed from the project while still on site still leaves, and the hours should close at the time they left.
 * Signing in is not queued late, because a person without access has nothing to sign in to.
 */
export function attendanceSyncCommands(attendance: AttendanceService): SyncCommand[] {
  const sessionId = (entityId: unknown) => {
    const id = typeof entityId === 'string' ? decodeId('attendanceSession', entityId) : null;
    if (!id) throw invalid('entityId', 'Invalid id');
    return id;
  };
  const signOut: SyncCommand = {
    name: 'attendance.signOut',
    module: 'workforce',
    // Worth an admin's look if the person lost access first (X38); a grant only queues it.
    drainable: true,
    async projectOf(scope, entityId) {
      const id = typeof entityId === 'string' ? decodeId('attendanceSession', entityId) : null;
      return id ? attendance.projectOfSession(scope, id) : null;
    },
    async run(scope, m) {
      const row = await attendance.signOutSession(scope, sessionId(m.entityId), {
        clientAt: m.late ? m.late.clientAt : m.clientAt,
        late: Boolean(m.late),
      });
      return { version: row.version };
    },
    async current(scope, entityId) {
      void scope;
      void entityId;
      return null;
    },
  };
  return [signOut];
}
