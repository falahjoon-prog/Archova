'use client';

import { useId, useState } from 'react';
import type { ContractReview } from '../data/api';

type Source = ContractReview['flags'][number]['source'];

const SHORT = 160;

/** A clause citation: clause number, page and the quoted words. A long quote expands with a button, never truncated away. */
export function SourceQuote({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = source.quote.length > SHORT;
  const shown = long && !open ? `${source.quote.slice(0, SHORT).trimEnd()}…` : source.quote;
  return (
    <figure className="cr-quote">
      <figcaption className="cr-quote__cite">
        {source.clause ? `Clause ${source.clause}` : 'Clause number not printed'} · page{' '}
        {source.page}
      </figcaption>
      <blockquote id={id} className="cr-quote__text">
        {shown}
      </blockquote>
      {long ? (
        <button
          type="button"
          className="link-button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : 'Show the full quote'}
        </button>
      ) : null}
    </figure>
  );
}
