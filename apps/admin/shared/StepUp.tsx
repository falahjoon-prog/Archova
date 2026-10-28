'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, FormError, TextField } from '@archova/ui';
import { ApiError, api } from './api';

type Run = <T>(action: () => Promise<T>) => Promise<T>;
const Ctx = createContext<Run | null>(null);

/**
 * Money and approvals need a fresh password check (backend 09 §2). `withStepUp(action)` runs the action; if the API
 * answers `auth.step_up_required` it asks for the password, confirms it, and runs the action again.
 */
export const useStepUp = (): Run => {
  const run = useContext(Ctx);
  if (!run) throw new Error('useStepUp needs <StepUpProvider>');
  return run;
};

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ ok: () => void; cancel: (e: unknown) => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((ok, cancel) => {
        pending.current = { ok, cancel };
        setPassword('');
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const run = useCallback<Run>(
    async (action) => {
      try {
        return await action();
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'auth.step_up_required') throw e;
        await ask();
        return action();
      }
    },
    [ask],
  );

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.stepUp(password);
      setOpen(false);
      pending.current?.ok();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not confirm your password.');
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setOpen(false);
    pending.current?.cancel(new ApiError(0, 'cancelled', 'Cancelled'));
  };

  return (
    <Ctx.Provider value={run}>
      {children}
      <Dialog
        open={open}
        onClose={cancel}
        title="Confirm it's you"
        description="This change needs your password again."
        footer={
          <>
            <Button variant="tertiary" onClick={cancel}>
              Cancel
            </Button>
            <Button onClick={() => void confirm()} loading={busy} disabled={!password}>
              Confirm
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void confirm();
          }}
        >
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <FormError message={error} />
        </form>
      </Dialog>
    </Ctx.Provider>
  );
}
