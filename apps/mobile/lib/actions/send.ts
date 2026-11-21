// Replays a queued action through the typed client: the same endpoints the online screens call.
import { unwrap, type ApiClient } from '@archova/api-client';
import type { ActionSender } from './action-queue';
import { sendPretaskPlan, type SignatureUploader } from './pretask-send';

export interface ActionSenderDeps {
  /** Stores a drawn signature; needed to replay a pre-task plan. */
  uploadSignature?: SignatureUploader;
}

export function createActionSender(
  api: ApiClient,
  orgId: string,
  deps: ActionSenderDeps = {},
): ActionSender {
  return async (a) => {
    const base = { orgId, projectId: a.projectId };
    const p = a.payload;
    switch (a.kind) {
      case 'pretask.submit':
        if (!deps.uploadSignature) throw new Error('Signatures cannot be sent from here');
        await sendPretaskPlan(api, orgId, a, deps.uploadSignature);
        return;
      case 'submittal.respond':
        unwrap(
          await api.POST(
            '/v1/orgs/{orgId}/projects/{projectId}/submittals/{submittalId}/steps/{stepId}/respond',
            {
              params: { path: { ...base, submittalId: a.targetId, stepId: String(p.stepId) } },
              body: {
                response: p.response as 'approved',
                ...(typeof p.comments === 'string' && p.comments ? { comments: p.comments } : {}),
              },
            },
          ),
        );
        return;
      case 'rfi.respond':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/rfis/{rfiId}/responses', {
            params: {
              path: { ...base, rfiId: a.targetId },
              header: { 'Idempotency-Key': a.id },
            },
            body: { body: String(p.body ?? '') },
          }),
        );
        return;
      case 'timesheet.submit':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/submit', {
            params: { path: { ...base, timesheetId: a.targetId } },
          }),
        );
        return;
      case 'timesheet.approve':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/approve', {
            params: { path: { ...base, timesheetId: a.targetId } },
          }),
        );
        return;
      case 'timesheet.reject':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/timesheets/{timesheetId}/reject', {
            params: { path: { ...base, timesheetId: a.targetId } },
            body: { reason: String(p.reason ?? '') },
          }),
        );
        return;
      case 'delivery.checkIn':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/deliveries/{deliveryId}/check-in', {
            params: { path: { ...base, deliveryId: a.targetId } },
            // The time the truck was logged on the phone, not the time the signal came back.
            body: {
              event: p.event as 'arrived',
              ...(typeof p.at === 'string' ? { at: p.at } : {}),
            },
          }),
        );
        return;
      case 'swms.acknowledge':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/swms/{swmsId}/acknowledge', {
            params: {
              path: { ...base, swmsId: a.targetId },
              header: { 'Idempotency-Key': a.id },
            },
            body: { workerName: String(p.workerName ?? ''), language: 'en' },
          }),
        );
        return;
      case 'swms.transition':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/swms/{swmsId}/transition', {
            params: {
              path: { ...base, swmsId: a.targetId },
              header: { 'If-Match': `"${String(p.version)}"` },
            },
            body: {
              action: p.action as 'accept',
              ...(typeof p.reason === 'string' && p.reason ? { reason: p.reason } : {}),
              ...(p.action === 'accept' ? { confirmedUnderstandable: true } : {}),
            },
          }),
        );
        return;
      case 'permit.startRenewal':
        unwrap(
          await api.POST('/v1/orgs/{orgId}/projects/{projectId}/permits/{permitId}/transition', {
            params: {
              path: { ...base, permitId: a.targetId },
              header: { 'If-Match': `"${String(p.version)}"` },
            },
            body: { action: 'startRenewal' },
          }),
        );
        return;
      case 'environment.startCondition':
        unwrap(
          await api.POST(
            '/v1/orgs/{orgId}/projects/{projectId}/environment/conditions/{conditionId}/transition',
            {
              params: {
                path: { ...base, conditionId: a.targetId },
                header: { 'If-Match': `"${String(p.version)}"` },
              },
              body: { action: 'start' },
            },
          ),
        );
        return;
      case 'rollcall.mark':
        unwrap(
          await api.POST(
            '/v1/orgs/{orgId}/projects/{projectId}/attendance/roll-calls/{rollCallId}/marks',
            {
              params: { path: { ...base, rollCallId: a.targetId } },
              // The time it was tapped, not the time the signal came back.
              body: {
                workerId: String(p.workerId),
                status: p.status as 'accounted_for',
                ...(typeof p.at === 'string' ? { clientAt: p.at } : {}),
              },
            },
          ),
        );
        return;
      case 'rollcall.allClear':
        unwrap(
          await api.POST(
            '/v1/orgs/{orgId}/projects/{projectId}/attendance/roll-calls/{rollCallId}/all-clear',
            {
              params: { path: { ...base, rollCallId: a.targetId } },
              body: typeof p.at === 'string' ? { clientAt: p.at } : {},
            },
          ),
        );
        return;
      case 'rollcall.end':
        unwrap(
          await api.POST(
            '/v1/orgs/{orgId}/projects/{projectId}/attendance/roll-calls/{rollCallId}/end',
            { params: { path: { ...base, rollCallId: a.targetId } } },
          ),
        );
        return;
      case 'toolbox.addAttendee':
      case 'toolbox.transition': {
        // Earlier queued changes may already have moved the talk on, so use its current version, not the one the
        // phone saw. Closing a talk that someone else closed is still refused by the server.
        const talk = unwrap(
          await api.GET('/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks/{talkId}', {
            params: { path: { ...base, talkId: a.targetId } },
          }),
        );
        const params = {
          path: { ...base, talkId: a.targetId },
          header: { 'If-Match': `"${talk.talk.version}"` },
        };
        if (a.kind === 'toolbox.addAttendee') {
          unwrap(
            await api.POST(
              '/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks/{talkId}/attendees',
              {
                params,
                body: {
                  attendees: [
                    {
                      personName: String(p.personName ?? ''),
                      ...(typeof p.userId === 'string' ? { userId: p.userId } : {}),
                    },
                  ],
                },
              },
            ),
          );
        } else {
          unwrap(
            await api.POST(
              '/v1/orgs/{orgId}/projects/{projectId}/toolbox-talks/{talkId}/transition',
              {
                params,
                body: { action: p.action as 'close' },
              },
            ),
          );
        }
        return;
      }
    }
  };
}
