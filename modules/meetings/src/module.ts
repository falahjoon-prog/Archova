import {
  defineModule,
  type KernelServices,
  type Logger,
  type MessageSender,
} from '@archova/kernel';
import { createMeetingService, type IssueNotice, type MeetingsDeps } from './application/meetings';
import { meetingsRoutes } from './api/routes';
import { MEETINGS_PERMISSIONS } from './permissions';

export interface MeetingsModuleDeps extends MeetingsDeps {
  messages: MessageSender;
  /** The web origin the emailed link points at. */
  baseUrl: string;
  logger: Pick<Logger, 'warn'>;
}

export function createMeetingsModule(services: KernelServices, deps: MeetingsModuleDeps) {
  const service = createMeetingService(deps);

  /** MTG-AC4: tell each recipient the minutes are out. The PDF is one click away; a failed address is logged, never fatal. */
  async function notify(n: IssueNotice) {
    const link = `${deps.baseUrl}/${n.orgSlug}/projects/${n.projectId}/meetings/${n.meetingId}`;
    const text = [
      `The minutes of "${n.title}" have been issued${n.version > 1 ? ` (corrected, version ${n.version})` : ''}.`,
      n.correctionsBy ? `Please send corrections by ${n.correctionsBy}.` : null,
      n.note ? n.note : null,
      `Read them and download the PDF: ${link}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    for (const r of n.recipients)
      try {
        await deps.messages.email(r.email, { subject: `Minutes: ${n.title}`, text });
      } catch (err) {
        deps.logger.warn({ err, meetingId: n.meetingId }, 'meeting minutes email failed');
      }
  }

  return {
    definition: defineModule({ name: 'meetings', permissions: MEETINGS_PERMISSIONS }),
    routes: meetingsRoutes(services.database, service, notify),
    api: {
      /** The meeting's title, day, sections and attendees for Nova minutes drafting (MTG-US7). */
      forMinutesDraft: service.forMinutesDraft,
      /** Open actions assigned to a person across projects, for the "my tasks" rollup (`tasks`). */
      openActionsForUser: service.openActionsForUser,
    },
  };
}

export type MeetingsModule = ReturnType<typeof createMeetingsModule>;
