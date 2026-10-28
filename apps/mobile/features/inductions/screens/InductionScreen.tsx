// The online site induction (IND-US1): read each section, pass the quiz, sign the declaration. Needs a connection.
// Video, document and SWMS blocks come later; a section with those cannot be ticked as seen.
import { useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { ApiError } from '@archova/api-client';
import type { InductionCompletion } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { Button, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import {
  getInductionCompletion,
  recordSectionSeen,
  signInduction,
  startInduction,
  submitQuiz,
} from '../commands';
import {
  nextStep,
  quizOutcome,
  sectionProgress,
  unsupportedBlockKinds,
  unsupportedBlocksMessage,
} from '../flow';
import { SignaturePad } from './SignaturePad';
import { WhiteCardStep } from './WhiteCardStep';

const offline = 'Could not reach the server. Check your connection and try again.';

export function InductionScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const [completion, setCompletion] = useState<InductionCompletion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ title: string; detail: string | null } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [skipCredentials, setSkipCredentials] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [fit, setFit] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState('');
  const [padKey, setPadKey] = useState(0);
  const openedAt = useRef(Date.now());
  const startKey = useRef(uuidv7());

  const target = orgId ? { orgId, projectId } : null;

  const run = async <T,>(call: () => Promise<T>, then: (value: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      then(await call());
    } catch (e) {
      setError(e instanceof ApiError && e.status < 500 && e.status !== 0 ? e.message : offline);
    } finally {
      setBusy(false);
    }
  };

  const begin = () =>
    target
      ? run(
          () => startInduction(api, target, { idempotencyKey: startKey.current }),
          (c) => {
            setCompletion(c);
            openedAt.current = Date.now();
          },
        )
      : Promise.resolve();

  useEffect(() => {
    void begin();
    // Started once per visit; `begin` reads the latest target.
  }, [orgId, projectId]);

  if (!target) {
    return (
      <Screen title="Site induction">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (!completion) {
    return (
      <Screen title="Site induction">
        {error ? (
          <StateMessage tone="danger" message={error} onRetry={() => void begin()} />
        ) : (
          <StateMessage loading message="Opening your induction" />
        )}
      </Screen>
    );
  }

  const step = nextStep(completion);
  const body = (() => {
    if (step.kind === 'done') {
      return (
        <Text style={{ color: t.color.statusSuccess, fontSize: 22, fontWeight: '700' }}>
          Induction complete. You can sign in at the gate.
        </Text>
      );
    }
    if (step.kind === 'section') {
      const section = completion.content.sections[step.index]!;
      const unsupported = unsupportedBlockKinds(section);
      return (
        <>
          <Text style={{ color: t.color.textSecondary }}>
            {sectionProgress(completion, step.index)}
          </Text>
          <Text style={{ color: t.color.text, fontSize: 20, fontWeight: '700' }}>
            {section.title}
          </Text>
          {section.blocks.map((b, i) =>
            b.type === 'text' ? (
              <Text key={i} style={{ color: t.color.text }}>
                {b.body}
              </Text>
            ) : b.type === 'slides' ? (
              <View key={i} style={{ gap: t.space[3] }}>
                {b.slides.map((s, j) => (
                  <View key={j} style={{ gap: t.space[1] }}>
                    <Text style={{ color: t.color.text, fontWeight: '600' }}>{s.title}</Text>
                    {s.points.map((p, k) => (
                      <Text key={k} style={{ color: t.color.text }}>
                        {`• ${p}`}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            ) : null,
          )}
          {unsupported.length > 0 ? (
            <StateMessage tone="danger" message={unsupportedBlocksMessage(unsupported)} />
          ) : (
            <Button
              label="I have read this section"
              disabled={busy}
              onPress={() =>
                void run(
                  () =>
                    recordSectionSeen(api, target, completion.id, {
                      section: step.index,
                      seconds: Math.round((Date.now() - openedAt.current) / 1000),
                    }),
                  (c) => {
                    setCompletion(c);
                    openedAt.current = Date.now();
                  },
                )
              }
            />
          )}
        </>
      );
    }
    if (step.kind === 'quiz') {
      const quiz = completion.content.quiz;
      const complete = quiz.every((q) => answers[q.id] !== undefined);
      return (
        <>
          <Text style={{ color: t.color.text, fontSize: 20, fontWeight: '700' }}>Quiz</Text>
          <Text style={{ color: t.color.textSecondary }}>
            You need {completion.content.passMark}% and every critical question right.
          </Text>
          {notice ? (
            <View accessibilityLiveRegion="polite" style={{ gap: t.space[1] }}>
              <Text style={{ color: t.color.statusDanger, fontWeight: '600' }}>{notice.title}</Text>
              {notice.detail ? <Text style={{ color: t.color.text }}>{notice.detail}</Text> : null}
            </View>
          ) : null}
          {quiz.map((q) => (
            <View key={q.id} style={{ gap: t.space[2] }}>
              <Text style={{ color: t.color.text, fontWeight: '600' }}>{q.question}</Text>
              {q.options.map((o, i) => (
                <Button
                  key={i}
                  label={o}
                  variant={answers[q.id] === i ? 'primary' : 'secondary'}
                  onPress={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
                />
              ))}
            </View>
          ))}
          <Button
            label="Submit answers"
            disabled={busy || !complete}
            onPress={() =>
              void run(
                () =>
                  submitQuiz(
                    api,
                    target,
                    completion.id,
                    quiz.map((q) => ({ questionId: q.id, answerIndex: answers[q.id]! })),
                  ),
                async (result) => {
                  const outcome = quizOutcome(result);
                  setNotice(result.passed ? null : outcome);
                  setAnswers({});
                  setCompletion(await getInductionCompletion(api, target, completion.id));
                },
              )
            }
          />
        </>
      );
    }
    if (step.kind === 'credentials' && !skipCredentials) {
      return (
        <WhiteCardStep
          target={target}
          completionId={completion.id}
          onAdded={() =>
            void run(
              () => getInductionCompletion(api, target, completion.id),
              (c) => setCompletion(c),
            )
          }
          onSkip={() => setSkipCredentials(true)}
        />
      );
    }
    const ready = typedName.trim() !== '' && fit && agreed && signature !== '';
    return (
      <>
        <Text style={{ color: t.color.text, fontSize: 20, fontWeight: '700' }}>Declaration</Text>
        <Text style={{ color: t.color.text }}>{completion.content.declarationText}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[3] }}>
          <Switch value={fit} onValueChange={setFit} accessibilityLabel="I am fit for work" />
          <Text style={{ color: t.color.text, flex: 1 }}>I am fit for work</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[3] }}>
          <Switch value={agreed} onValueChange={setAgreed} accessibilityLabel="I agree" />
          <Text style={{ color: t.color.text, flex: 1 }}>I agree to the declaration</Text>
        </View>
        <TextField label="Your full name" value={typedName} onChangeText={setTypedName} />
        <SignaturePad key={padKey} onChange={setSignature} />
        <Button
          label="Clear signature"
          variant="secondary"
          onPress={() => {
            setSignature('');
            setPadKey((k) => k + 1);
          }}
        />
        <Button
          label="Sign and finish"
          disabled={busy || !ready}
          onPress={() =>
            void run(async () => {
              await signInduction(api, target, completion.id, {
                typedName: typedName.trim(),
                signaturePath: signature,
                fitForWork: fit,
                agreed,
                clientAt: new Date().toISOString(),
              });
              return getInductionCompletion(api, target, completion.id);
            }, setCompletion)
          }
        />
      </>
    );
  })();

  return (
    <Screen title="Site induction">
      {body}
      {error ? <StateMessage tone="danger" message={error} /> : null}
    </Screen>
  );
}
