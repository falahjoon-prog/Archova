'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from '@archova/ui/icons';

type Choice = 'system' | 'light' | 'dark';
const KEY = 'archova-theme';
const NEXT: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Choice, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON = { system: Monitor, light: Sun, dark: Moon };

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: Choice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
}

/** Top-bar button that cycles System, Light, Dark. System follows the device setting. */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<Choice>('system');
  useEffect(() => setChoice(read()), []);
  const Icon = ICON[choice];
  return (
    <button
      type="button"
      className="inbox-link ac-focusable"
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]]}.`}
      title={`Theme: ${LABEL[choice]}`}
      onClick={() => {
        const next = NEXT[choice];
        apply(next);
        setChoice(next);
      }}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
