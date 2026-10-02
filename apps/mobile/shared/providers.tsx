import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@archova/api-client';
import { DeviceDataProvider } from './device-data';
import { OrgProvider } from './org';
import { SessionProvider } from './session';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Client errors (401, 403, 404, 402 module_not_licensed…) will not fix themselves on retry.
        retry: (count, err) =>
          !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

/** App-wide providers: TanStack Query (online-only reads), session, current org, its device data. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <OrgProvider>
          <DeviceDataProvider>{children}</DeviceDataProvider>
        </OrgProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
