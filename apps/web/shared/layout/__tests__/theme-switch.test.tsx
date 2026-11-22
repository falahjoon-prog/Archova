// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeSwitch } from '../ThemeSwitch';

describe('ThemeSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('cycles system, light, dark and back, saving the choice', () => {
    render(<ThemeSwitch />);
    const button = () => screen.getByRole('button');
    expect(button().getAttribute('aria-label')).toContain('Theme: System');

    fireEvent.click(button());
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('archova-theme')).toBe('light');

    fireEvent.click(button());
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('archova-theme')).toBe('dark');

    fireEvent.click(button());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('archova-theme')).toBeNull();
  });

  it('starts from a saved choice', () => {
    localStorage.setItem('archova-theme', 'dark');
    render(<ThemeSwitch />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Theme: Dark');
  });
});
