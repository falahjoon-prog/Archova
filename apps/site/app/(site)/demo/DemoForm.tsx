'use client';

import { useActionState } from 'react';
import { requestDemo, type DemoState } from './actions';

const initial: DemoState = { status: 'idle' };

export function DemoForm() {
  const [state, action, pending] = useActionState(requestDemo, initial);
  if (state.status === 'sent') {
    return (
      <div role="status" className="notice">
        <h2>Thanks, we have your request.</h2>
        <p>Someone from Archova will email you within one business day.</p>
      </div>
    );
  }
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} className="form" noValidate>
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          defaultValue={v.name}
          aria-invalid={!!e.name}
          aria-describedby={e.name ? 'name-err' : undefined}
          required
        />
        {e.name ? (
          <p id="name-err" className="field__error">
            {e.name}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={v.email}
          aria-invalid={!!e.email}
          aria-describedby={e.email ? 'email-err' : undefined}
          required
        />
        {e.email ? (
          <p id="email-err" className="field__error">
            {e.email}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" autoComplete="organization" defaultValue={v.company} />
      </div>
      <div className="field">
        <label htmlFor="phone">Phone (optional)</label>
        <input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={v.phone} />
      </div>
      <div className="field">
        <label htmlFor="teamSize">How many people would use it?</label>
        <select id="teamSize" name="teamSize" defaultValue={v.teamSize ?? ''}>
          <option value="">Choose one</option>
          <option value="1-5">1 to 5</option>
          <option value="6-25">6 to 25</option>
          <option value="26-100">26 to 100</option>
          <option value="100+">More than 100</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="message">Anything we should know? (optional)</label>
        <textarea id="message" name="message" rows={4} defaultValue={v.message} />
      </div>
      {/* Honeypot, hidden from people and screen readers. */}
      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            name="consent"
            defaultChecked={v.consent === 'on'}
            aria-invalid={!!e.consent}
          />
          <span>
            I agree Archova may contact me about my request. We store it in Australia and use it
            only for this. See our privacy notice on request.
          </span>
        </label>
        {e.consent ? <p className="field__error">{e.consent}</p> : null}
      </div>
      <button
        type="submit"
        className="ac-button ac-button--primary"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? 'Sending…' : 'Request a demo'}
      </button>
    </form>
  );
}
