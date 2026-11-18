// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { BrandingScreen } = await import('../screens/BrandingScreen');
const { accentCss, textOn } = await import('../lib/colour');

const B = '/v1/orgs/{orgId}/branding';
const widgets = ['projects', 'rfis', 'project_table'].map((key) => ({ key, label: `W ${key}` }));
const base = {
  logoFileId: null,
  accentColor: null,
  dashboardWidgets: ['projects', 'rfis', 'project_table'],
  availableWidgets: widgets,
  version: 2,
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', B, () => base);
});

describe('accent colour', () => {
  it('only overrides the amber tokens, with readable text on top', () => {
    expect(accentCss(null)).toBeNull();
    expect(accentCss('nope')).toBeNull();
    expect(accentCss('#1F6FEB')).toBe(':root{--brand-amber:#1F6FEB;--brand-amber-text:#FFFFFF;}');
    expect(textOn('#E08A1E')).toBe('#18222B');
  });
});

describe('BrandingScreen', () => {
  it('saves an accent and a reordered, trimmed widget list', async () => {
    const user = userEvent.setup();
    fake.on('PUT', B, () => ({
      ...base,
      accentColor: '#1F6FEB',
      dashboardWidgets: ['projects', 'project_table'],
      version: 3,
    }));
    renderInProject(<BrandingScreen />);
    await enterText(user, await screen.findByLabelText('Colour (hex)'), '#1f6feb');
    await user.click(screen.getByRole('checkbox', { name: 'W rfis' }));
    await user.click(screen.getByRole('button', { name: 'Move W project_table up' }));
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(fake.callsTo('PUT', B)).toHaveLength(1));
    expect(fake.callsTo('PUT', B)[0]!.init.body).toEqual({
      accentColor: '#1F6FEB',
      dashboardWidgets: ['projects', 'project_table'],
    });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('blocks a colour that is not a six-digit hex', async () => {
    const user = userEvent.setup();
    renderInProject(<BrandingScreen />);
    await enterText(user, await screen.findByLabelText('Colour (hex)'), 'red');
    expect(screen.getByText('Use a colour like #1F6FEB.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save branding' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
