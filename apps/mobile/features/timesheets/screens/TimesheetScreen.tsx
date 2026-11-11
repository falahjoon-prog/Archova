// One day sheet. A submitted sheet shows Nova's check against the worker's sign-ins and roster before approve/reject.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { deviceTimeZone } from '../../../lib/capture/capture';
import { attemptOrQueue } from '../../../lib/actions/attempt';
import { PendingActions, StateMessage, useCurrentOrg, useDeviceData } from '../../../shared';
import { localDateOf } from '@archova/time';
import {
  approveTimesheet,
  getTimesheet,
  listSessions,
  listShiftsBetween,
  rejectTimesheet,
  submitTimesheet,
} from '../commands';
import { dayWindow, hoursText, statusLabel, timesheetFlags } from '../format';

export function TimesheetScreen({
  projectId,
  timesheetId,
}: {
  projectId: string;
  timesheetId: string;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const [reason, setReason] = useState('');
  const device = useDeviceData();
  const queue = device.status === 'ready' ? device.data.actions : null;
  const wake = () => device.status === 'ready' && device.data.requestSync('connectivity');
  const [rejecting, setRejecting] = useState(false);
  const target = orgId ? { orgId, projectId } : null;
  const sheet = useQuery({
    queryKey: ['timesheets', orgId, projectId, 'detail', timesheetId],
    queryFn: () => getTimesheet(api, target!, timesheetId),
    enabled: target !== null,
  });
  const zone = deviceTimeZone() ?? 'UTC';
  const date = sheet.data?.date;
  const needsCheck = sheet.data?.status === 'submitted' || sheet.data?.status === 'draft';
  // The check is advice only: if either lookup fails (no permission to see attendance) the screen simply omits it.
  const sessions = useQuery({
    queryKey: ['timesheets', orgId, projectId, 'sessions', date],
    queryFn: () => listSessions(api, target!, date!),
    enabled: target !== null && !!date && needsCheck,
    retry: false,
  });
  const shifts = useQuery({
    queryKey: ['timesheets', orgId, projectId, 'shifts', date],
    queryFn: () => {
      const w = dayWindow(date!, zone);
      return listShiftsBetween(api, target!, w.from, w.to);
    },
    enabled: target !== null && !!date && needsCheck,
    retry: false,
  });
  const done = () => {
    setRejecting(false);
    setReason('');
    void qc.invalidateQueries({ queryKey: ['timesheets', orgId, projectId] });
  };
  const act = (
    kind: 'timesheet.submit' | 'timesheet.approve' | 'timesheet.reject',
    online: () => Promise<unknown>,
  ) =>
    attemptOrQueue(
      queue,
      { projectId, kind, targetId: timesheetId, payload: { reason: reason.trim() } },
      online,
      wake,
    );
  const submit = useMutation({
    mutationFn: () => act('timesheet.submit', () => submitTimesheet(api, target!, timesheetId)),
    onSuccess: done,
  });
  const approve = useMutation({
    mutationFn: () => act('timesheet.approve', () => approveTimesheet(api, target!, timesheetId)),
    onSuccess: done,
  });
  const reject = useMutation({
    mutationFn: () =>
      act('timesheet.reject', () => rejectTimesheet(api, target!, timesheetId, reason)),
    onSuccess: done,
  });
  const queued = [submit, approve, reject].some((m) => m.data === 'queued');

  if (!orgId) {
    return (
      <Screen title="Timesheet">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (sheet.isPending) {
    return (
      <Screen title="Timesheet">
        <StateMessage loading message="Loading timesheet" />
      </Screen>
    );
  }
  if (sheet.isError) {
    return (
      <Screen title="Timesheet">
        <StateMessage
          tone="danger"
          message="Could not load this timesheet."
          onRetry={() => void sheet.refetch()}
        />
      </Screen>
    );
  }
  const s = sheet.data;
  const checked = sessions.isSuccess && shifts.isSuccess;
  const dayShifts = (shifts.data ?? []).filter((sh) => localDateOf(sh.startsAt, zone) === s.date);
  const flags = checked
    ? timesheetFlags(
        s,
        sessions.data.map((x) => x.session),
        dayShifts,
      )
    : [];
  const busy = submit.isPending || approve.isPending || reject.isPending;
  const failed = submit.isError || approve.isError || reject.isError;
  return (
    <Screen title={`Timesheet ${s.date}`}>
      <Text style={{ color: t.color.text, fontSize: t.font.size.lg }}>
        {hoursText(s.paidHours)}, {statusLabel(s.status)}
      </Text>
      {s.rejectionReason ? (
        <Text style={{ color: t.color.statusDanger }}>Rejected: {s.rejectionReason}</Text>
      ) : null}
      {s.lines.map((l) => (
        <ListItem
          key={l.id}
          title={`${(l.minutes / 60).toFixed(2)} h worked, ${l.breakMinutes} min break`}
          subtitle={
            l.adjustedReason ??
            (l.source === 'attendance' ? 'From site sign-in' : 'Entered by hand')
          }
        />
      ))}
      {needsCheck && checked ? (
        <View
          accessibilityRole="summary"
          style={{
            gap: t.space[1],
            padding: t.space[3],
            borderRadius: t.radius.md,
            borderWidth: 1,
            borderColor: flags.length ? t.color.statusWarning : t.color.borderControl,
          }}
        >
          <Text style={{ color: t.color.text, fontWeight: '600' }}>
            {flags.length
              ? 'Nova: check before approving'
              : 'Nova: hours match sign-ins and roster'}
          </Text>
          {flags.map((f) => (
            <Text key={f.code} style={{ color: t.color.text }}>
              {f.message}
            </Text>
          ))}
        </View>
      ) : null}
      <PendingActions targetId={timesheetId} />
      {queued ? (
        <StateMessage message="No signal. Saved on this phone and will be sent when you are online." />
      ) : null}
      {s.status === 'draft' || s.status === 'rejected' ? (
        <Button
          label="Submit for approval"
          loading={submit.isPending}
          onPress={() => submit.mutate()}
        />
      ) : null}
      {s.status === 'submitted' ? (
        <>
          <Button
            label={flags.length ? 'Approve anyway' : 'Approve'}
            loading={approve.isPending}
            disabled={busy}
            onPress={() => approve.mutate()}
          />
          {rejecting ? (
            <>
              <TextField
                label="Reason for rejecting"
                value={reason}
                onChangeText={setReason}
                multiline
              />
              <Button
                label="Reject timesheet"
                variant="danger"
                disabled={busy || reason.trim().length === 0}
                loading={reject.isPending}
                onPress={() => reject.mutate()}
              />
            </>
          ) : (
            <Button
              label="Reject"
              variant="secondary"
              disabled={busy}
              onPress={() => setRejecting(true)}
            />
          )}
        </>
      ) : null}
      {failed ? (
        <StateMessage
          tone="danger"
          message="That did not go through. You may not have permission."
        />
      ) : null}
    </Screen>
  );
}
