// The current organisation's device data: its encrypted database, sync store, file queue and the scheduler
// that keeps them moving (mobile 02 §2.6). Screens read and write the local store through this, never the
// network.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import { SyncEngine, SyncScheduler, type SyncTrigger } from '@archova/sync-core';
import { api } from '../lib/api';
import { openOrgDatabase, SqliteSyncStore, type SqlDatabase } from '../lib/db';
import { expoSqlDriver } from '../lib/db/expo-driver';
import { createSignInSender, SignInQueue } from '../lib/attendance/sign-in-queue';
import { createUploadApi } from '../lib/files/api';
import { UploadQueue } from '../lib/files/upload-queue';
import { backgroundFileTransfer } from '../lib/platform/file-transfer';
import { randomBytes } from '../lib/platform/crypto';
import { createDeviceSync } from '../lib/sync/device-sync';
import { SheetCache } from '../lib/files/sheet-cache';
import { sheetFiles } from '../lib/platform/sheet-files';
import { OfflineProjects } from '../lib/sync/offline-projects';
import { deviceScopes } from '../lib/sync/scopes';
import { createSyncTransport } from '../lib/sync/transport';
import { useCurrentOrg } from './org';
import { useSession } from './session';

/** Module each synced entity type belongs to, for purging a revoked module. */
const MODULE_OF: Record<string, string> = {
  photo: 'photos',
  defect: 'defects',
  defect_event: 'defects',
  diary_entry: 'diary',
  diary_labour: 'diary',
  diary_plant: 'diary',
  diary_delivery: 'diary',
  diary_delay: 'diary',
  inspection: 'quality',
  inspection_template: 'quality',
  incident: 'safety',
  drawing_sheet: 'drawings',
  drawing_revision: 'drawings',
  drawing_markup: 'drawings',
};
const moduleOf = (entityType: string) => MODULE_OF[entityType] ?? entityType;

export interface DeviceData {
  orgId: string;
  db: SqlDatabase;
  store: SqliteSyncStore;
  uploads: UploadQueue;
  signIns: SignInQueue;
  offline: OfflineProjects;
  sheets: SheetCache;
  requestSync: (trigger: SyncTrigger) => void;
}

type State =
  | { status: 'none' }
  | { status: 'opening' }
  | { status: 'ready'; data: DeviceData }
  | { status: 'error'; message: string };

const DeviceDataContext = createContext<State>({ status: 'none' });

export function DeviceDataProvider({ children }: { children: ReactNode }) {
  const { orgId } = useCurrentOrg();
  const { status: sessionStatus } = useSession();
  const [state, setState] = useState<State>({ status: 'none' });

  useEffect(() => {
    if (!orgId || sessionStatus !== 'signed_in') {
      setState({ status: 'none' });
      return;
    }
    let alive = true;
    let cleanup: (() => void) | null = null;
    setState({ status: 'opening' });
    openOrgDatabase(orgId, {
      driver: expoSqlDriver,
      keys: SecureStore,
      keyOptions: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
      randomBytes,
    })
      .then(async (db) => {
        if (!alive) {
          void db.closeAsync();
          return;
        }
        const store = new SqliteSyncStore(db, { moduleOf });
        const uploads = new UploadQueue(
          db,
          store,
          createUploadApi(api, orgId),
          backgroundFileTransfer,
        );
        const signIns = new SignInQueue(db, createSignInSender(api, orgId));
        const sheets = new SheetCache(db, sheetFiles);
        const offline = new OfflineProjects(db, store, sheets);
        const engine = new SyncEngine({
          store,
          transport: createSyncTransport(api, orgId),
          scopes: () => deviceScopes(api, orgId, () => offline.excludedIds()),
        });
        // Drains saved before the app last stopped, so the unsent work of a lost project is still sent.
        await engine.restore();
        if (!alive) {
          void db.closeAsync();
          return;
        }
        const scheduler = new SyncScheduler(createDeviceSync({ uploads, signIns, engine }), {
          setTimeout: (cb, ms) => setTimeout(cb, ms),
          clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
          now: () => Date.now(),
        });
        scheduler.start();
        let wasConnected: boolean | null = null;
        const netSub = NetInfo.addEventListener((net) => {
          const connected = net.isConnected === true;
          if (connected && wasConnected === false) scheduler.request('connectivity');
          wasConnected = connected;
        });
        const appSub = AppState.addEventListener('change', (next) => {
          if (next === 'active') scheduler.request('foreground');
        });
        cleanup = () => {
          scheduler.stop();
          netSub();
          appSub.remove();
          void db.closeAsync();
        };
        setState({
          status: 'ready',
          data: {
            orgId,
            db,
            store,
            uploads,
            signIns,
            offline,
            sheets,
            requestSync: (t) => scheduler.request(t),
          },
        });
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not open device storage',
          });
        }
      });
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [orgId, sessionStatus]);

  return <DeviceDataContext.Provider value={state}>{children}</DeviceDataContext.Provider>;
}

/** The current organisation's device data, or its loading or error state. */
export function useDeviceData(): State {
  return useContext(DeviceDataContext);
}

/** Polls a value from the local store; screens re-read after their own writes via `refresh`. */
export function useLocalQuery<T>(read: (() => Promise<T>) | null, deps: unknown[]) {
  const [value, setValue] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!read) return;
    let alive = true;
    void read().then((v) => alive && setValue(v));
    const id = setInterval(() => void read().then((v) => alive && setValue(v)), 3_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [...deps, tick]);
  return useMemo(() => ({ value, refresh: () => setTick((t) => t + 1) }), [value]);
}

/**
 * The user's company on a project, from their synced project membership (`my_project_membership`, keyed by
 * project id, in the org sync scope). Null until the project has synced.
 */
export function useMyProjectCompany(projectId: string): string | null {
  const state = useDeviceData();
  const data = state.status === 'ready' ? state.data : null;
  const membership = useLocalQuery(
    data ? () => data.store.get('my_project_membership', projectId) : null,
    [data, projectId],
  );
  const value = membership.value?.data as { companyId?: string } | undefined;
  return value?.companyId ?? null;
}
