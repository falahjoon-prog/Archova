import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserEvent } from '@testing-library/user-event';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AssistantScopeProvider } from '@/features/assistant';
import { CurrentOrgProvider, type CurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  CurrentProjectProvider,
  type CurrentProject,
} from '@/shared/providers/CurrentProjectProvider';

export const testOrg: CurrentOrg = {
  orgId: 'org_test',
  orgSlug: 'acme',
  orgName: 'Acme Builders',
  role: 'admin',
  kind: 'member',
  user: { id: 'usr_me', name: 'Test User' },
};

export const testProject: CurrentProject = {
  projectId: 'prj_test',
  name: 'Harbour St Tower',
  number: 'HST-01',
  timezone: 'Australia/Sydney',
  state: 'NSW',
  companyId: 'cmp_builder',
};

/** Renders a project screen with a fresh query cache and the org, project and assistant contexts. */
export function renderInProject(ui: ReactElement, options?: RenderOptions) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <CurrentOrgProvider org={testOrg}>
        <CurrentProjectProvider project={testProject}>
          <AssistantScopeProvider>{children}</AssistantScopeProvider>
        </CurrentProjectProvider>
      </CurrentOrgProvider>
    </QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/** State behind the mocked next/navigation; tests set `search` and read `pushed`. */
export const nav = { search: '', pushed: [] as string[], pathname: '/acme/projects/prj_test' };

/** Use with `vi.mock('next/navigation', () => navigationMock)`. */
export const navigationMock = {
  useRouter: () => ({
    push: (href: string) => nav.pushed.push(href),
    replace: (href: string) => {
      nav.search = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
    },
    back: () => undefined,
    prefetch: () => undefined,
  }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  notFound: () => {
    throw new Error('notFound');
  },
};

/**
 * Enters free text in one input event. `user.type` sends a key at a time, and on a loaded CI runner the caret
 * drifted between keystrokes and scrambled the text; tests that aren't about typing use this instead.
 */
export async function enterText(user: UserEvent, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}
