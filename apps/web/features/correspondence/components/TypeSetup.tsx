'use client';

import { useState } from 'react';
import { Button, Select, StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useTypeSetup } from '../hooks/useCorrespondence';

/**
 * Admin setup: copy a built-in AU template into the company's types, or archive one. The notice periods in the
 * templates are defaults to confirm against the contract; nothing here says what a contract requires.
 */
export function TypeSetup() {
  const setup = useTypeSetup(true);
  const [key, setKey] = useState('');
  const used = new Set((setup.types.data ?? []).map((t) => t.templateKey).filter(Boolean));
  const available = (setup.templates.data ?? []).filter((t) => !used.has(t.key));

  return (
    <section className="stack" aria-labelledby="cor-types">
      <h2 id="cor-types" className="u-h3">
        Notice types
      </h2>
      <p className="u-muted u-m-0">
        Start from an Australian notice template, then check the wording and notice periods against
        your contract before relying on them.
      </p>
      <ul className="stack u-list-reset">
        {(setup.types.data ?? []).map((t) => (
          <li key={t.id} className="row-actions">
            <span>
              <strong>{t.name}</strong> <span className="u-mono u-caption">{t.prefix}</span>{' '}
              {t.isEvidential ? <StatusPill tone="neutral">Evidence</StatusPill> : null}{' '}
              {t.timeBarDays ? (
                <span className="u-caption">notice within {t.timeBarDays} days</span>
              ) : null}{' '}
              {t.archived ? <StatusPill tone="neutral">Archived</StatusPill> : null}
            </span>
            <Button
              variant="secondary"
              disabled={setup.archive.isPending}
              onClick={() => setup.archive.mutate(t)}
            >
              {t.archived ? 'Restore' : 'Archive'}
            </Button>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <Select
          label="Add from template"
          value={key}
          placeholder={available.length ? 'Choose a template' : 'All templates added'}
          options={available.map((t) => ({ value: t.key, label: `${t.name} (${t.prefix})` }))}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button
          disabled={!key || setup.add.isPending}
          onClick={() => setup.add.mutate(key, { onSuccess: () => setKey('') })}
        >
          {setup.add.isPending ? 'Adding…' : 'Add type'}
        </Button>
      </div>
      <ErrorAlert
        error={setup.add.error ?? setup.archive.error}
        title="We couldn't change the types"
      />
    </section>
  );
}
