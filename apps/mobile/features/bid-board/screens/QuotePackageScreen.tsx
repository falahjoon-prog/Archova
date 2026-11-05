// One tender package: what is being priced, the quotes already sent, and a form to send or revise a quote.
// Online only; a revision replaces the company's earlier quote on the server.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { uuidv7 } from '@archova/domain';
import { Button, ListItem, Screen, TextField, fontWeight, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { getProjectPackage, listMyQuotes, submitQuote } from '../commands';
import { buildQuote, moneyText, packageSubtitle } from '../quoting';

export function QuotePackageScreen({
  projectId,
  packageId,
}: {
  projectId: string;
  packageId: string;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const target = orgId ? { orgId, projectId, packageId } : null;
  const pkg = useQuery({
    queryKey: ['tenders', orgId, projectId, packageId],
    queryFn: () => getProjectPackage(api, target!),
    enabled: target !== null,
  });
  const quotes = useQuery({
    queryKey: ['tenders', orgId, projectId, packageId, 'quotes'],
    queryFn: () => listMyQuotes(api, target!),
    enabled: target !== null,
  });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [lumpSum, setLumpSum] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // One key per intended quote, so a retry after a dropped reply cannot send it twice.
  const key = useRef(uuidv7());
  const send = useMutation({
    mutationFn: (body: Parameters<typeof submitQuote>[2]['body']) =>
      submitQuote(api, target!, { body, idempotencyKey: key.current }),
    onSuccess: () => {
      key.current = uuidv7();
      setAmounts({});
      setLumpSum('');
      setNotes('');
      void qc.invalidateQueries({ queryKey: ['tenders', orgId, projectId, packageId] });
    },
  });

  if (!target) {
    return (
      <Screen title="Tender">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (pkg.isPending || quotes.isPending) {
    return (
      <Screen title="Tender">
        <StateMessage loading message="Loading the package" />
      </Screen>
    );
  }
  if (pkg.isError || quotes.isError) {
    return (
      <Screen title="Tender">
        <StateMessage
          tone="danger"
          message="Could not load this package. This needs a connection."
          onRetry={() => {
            void pkg.refetch();
            void quotes.refetch();
          }}
        />
      </Screen>
    );
  }
  const p = pkg.data;
  const open = p.status === 'out_to_tender';
  const heading = {
    color: t.color.text,
    fontSize: t.font.size.lg,
    fontWeight: fontWeight(t.font.weight.semibold),
  };
  const current = quotes.data.filter((q) => q.status !== 'superseded');

  const submit = () => {
    const built = buildQuote(p.scope, { amounts, lumpSum, reference, notes });
    if (!built.ok) {
      setProblem(built.problem);
      return;
    }
    setProblem(null);
    send.mutate(built.body);
  };

  return (
    <Screen title={`${p.numberLabel}  ${p.name}`}>
      <ListItem title="Package" subtitle={packageSubtitle(p)} />
      <Text accessibilityRole="header" style={heading}>
        Your quotes
      </Text>
      {current.length === 0 ? <StateMessage message="You have not sent a quote yet." /> : null}
      {current.map((q) => (
        <ListItem
          key={q.id}
          title={`Revision ${q.revision}  ${moneyText(Math.round(Number(q.totalExGst) * 100))} ex GST`}
          subtitle={q.status}
        />
      ))}
      {open ? (
        <>
          <Text accessibilityRole="header" style={heading}>
            {current.length ? 'Send a revised quote' : 'Send a quote'}
          </Text>
          {p.scope.map((s) => (
            <TextField
              key={s.key}
              label={`${s.description}${s.quantity ? `, ${s.quantity} ${s.unit}` : ''} (ex GST)`}
              keyboardType="decimal-pad"
              value={amounts[s.key] ?? ''}
              onChangeText={(v) => setAmounts((a) => ({ ...a, [s.key]: v }))}
            />
          ))}
          <TextField
            label={p.scope.length ? 'Other work (ex GST)' : 'Total price (ex GST)'}
            keyboardType="decimal-pad"
            value={lumpSum}
            onChangeText={setLumpSum}
          />
          <TextField label="Your quote number" value={reference} onChangeText={setReference} />
          <TextField
            label="Exclusions and qualifications, one per line"
            multiline
            value={notes}
            onChangeText={setNotes}
          />
          {problem ? <StateMessage tone="danger" message={problem} /> : null}
          {send.isError ? (
            <StateMessage
              tone="danger"
              message="Could not send the quote. Check your connection and try again."
            />
          ) : null}
          {send.isSuccess ? <StateMessage message="Quote sent." /> : null}
          <Button
            label={current.length ? 'Send revised quote' : 'Send quote'}
            disabled={send.isPending}
            onPress={submit}
          />
        </>
      ) : (
        <StateMessage message="This package is not open for quotes." />
      )}
    </Screen>
  );
}
