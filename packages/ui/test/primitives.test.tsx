// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button, FormError, Select, TextField } from '../src';

afterEach(cleanup);

describe('Button', () => {
  it('renders a non-submitting primary button by default', () => {
    render(<Button>Create project</Button>);
    const button = screen.getByRole('button', { name: 'Create project' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('ac-button--primary');
  });

  it('is disabled and busy while loading', () => {
    render(
      <Button variant="secondary" loading>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.className).toContain('ac-button--secondary');
  });
});

describe('TextField', () => {
  it('labels the input and links hint and error text', () => {
    render(<TextField label="Email" hint="Your work email" error="Enter a valid email address" />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(['Your work email', 'Enter a valid email address']);
  });

  it('has no aria-describedby without hint or error', () => {
    render(<TextField label="Name" />);
    expect(screen.getByLabelText('Name').hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('Select', () => {
  it('renders a placeholder and options', () => {
    render(
      <Select
        label="State"
        placeholder="Choose a state"
        options={[{ value: 'NSW', label: 'New South Wales' }]}
      />,
    );
    const select = screen.getByLabelText('State') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Choose a state',
      'New South Wales',
    ]);
  });
});

describe('FormError', () => {
  it('renders nothing without a message and an alert with one', () => {
    const { rerender } = render(<FormError message={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<FormError message="Email or password is incorrect." />);
    expect(screen.getByRole('alert').textContent).toContain('Email or password is incorrect.');
  });
});
