'use client';

import { Button, Checkbox, Select, TextField } from '@archova/ui';
import { newQuestion } from '../lib/content';
import {
  SECTION_LABELS,
  type InductionContent,
  type InductionQuestion,
  type InductionSectionKey,
} from '../lib/types';

interface Props {
  content: InductionContent;
  onChange: (next: InductionContent) => void;
}

/** The quiz and pass mark (IND-AC5). Emergency and high-risk questions are always critical on the server. */
export function QuizEditor({ content, onChange }: Props) {
  const topics = [...new Set(content.sections.map((s) => s.key))] as InductionSectionKey[];
  const setQ = (i: number, q: InductionQuestion) =>
    onChange({ ...content, quiz: content.quiz.map((x, n) => (n === i ? q : x)) });
  return (
    <div className="stack">
      <TextField
        label="Pass mark (%)"
        hint="Between 70 and 100. Every critical question must also be right."
        type="number"
        min={70}
        max={100}
        value={String(content.passMark)}
        onChange={(e) =>
          onChange({
            ...content,
            passMark: Math.min(100, Math.max(70, Number(e.target.value) || 70)),
          })
        }
      />
      {content.quiz.map((q, i) => (
        <fieldset key={q.id ?? i} className="induction-question">
          <legend>Question {i + 1}</legend>
          <TextField
            label="Question"
            value={q.question}
            maxLength={500}
            onChange={(e) => setQ(i, { ...q, question: e.target.value })}
          />
          <Select
            label="Topic"
            value={q.section}
            options={topics.map((k) => ({ value: k, label: SECTION_LABELS[k] }))}
            onChange={(e) => setQ(i, { ...q, section: e.target.value as InductionSectionKey })}
          />
          {q.options.map((o, n) => (
            <div key={n} className="induction-option">
              <TextField
                label={`Answer ${n + 1}`}
                value={o}
                maxLength={300}
                onChange={(e) =>
                  setQ(i, {
                    ...q,
                    options: q.options.map((x, m) => (m === n ? e.target.value : x)),
                  })
                }
              />
              <label className="induction-option__correct">
                <input
                  type="radio"
                  name={`correct-${i}`}
                  checked={q.answerIndex === n}
                  onChange={() => setQ(i, { ...q, answerIndex: n })}
                />
                Correct
              </label>
              <Button
                variant="tertiary"
                size="sm"
                disabled={q.options.length <= 2}
                aria-label={`Remove answer ${n + 1} of question ${i + 1}`}
                onClick={() => {
                  const options = q.options.filter((_, m) => m !== n);
                  const answerIndex =
                    q.answerIndex === n ? 0 : q.answerIndex > n ? q.answerIndex - 1 : q.answerIndex;
                  setQ(i, { ...q, options, answerIndex });
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="row-actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={q.options.length >= 6}
              aria-label={`Add answer to question ${i + 1}`}
              onClick={() => setQ(i, { ...q, options: [...q.options, ''] })}
            >
              Add answer
            </Button>
            <Checkbox
              label="Critical"
              hint="Must be right to pass"
              checked={q.critical}
              onChange={(e) => setQ(i, { ...q, critical: e.target.checked })}
            />
            <Button
              variant="tertiary"
              size="sm"
              aria-label={`Remove question ${i + 1}`}
              onClick={() => onChange({ ...content, quiz: content.quiz.filter((_, n) => n !== i) })}
            >
              Remove question
            </Button>
          </div>
        </fieldset>
      ))}
      <div>
        <Button
          variant="secondary"
          disabled={content.quiz.length >= 15 || !content.sections.length}
          onClick={() =>
            onChange({
              ...content,
              quiz: [...content.quiz, newQuestion(content.sections[0]?.key ?? 'extra')],
            })
          }
        >
          Add question
        </Button>
      </div>
    </div>
  );
}
