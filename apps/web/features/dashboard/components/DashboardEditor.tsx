'use client';

import { useState } from 'react';
import { Button, Dialog } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { addTile, newTileId, type Tile } from '../lib/layout';
import { getTile, type TileContext, type TileDef, type TileSurface } from '../lib/registry';
import { TileBoard } from './TileBoard';
import { TileLibrary } from './TileLibrary';

/**
 * A dashboard that people with `canEdit` can rearrange: Edit layout turns on dragging, corner resizing, Add tiles
 * (the library) and per-tile Settings/Remove; Save layout stores it for everyone, Cancel throws the changes away.
 */
export function DashboardEditor({
  surface,
  tiles,
  ctx,
  sampleCtx,
  canEdit,
  saving,
  error,
  onSave,
  onReset,
  toolbarExtra,
}: {
  surface: TileSurface;
  tiles: readonly Tile[];
  ctx: TileContext;
  /** Context carrying sample data, for the library previews. */
  sampleCtx: TileContext;
  canEdit: boolean;
  saving: boolean;
  error: unknown;
  onSave: (tiles: Tile[]) => Promise<unknown>;
  onReset?: () => Promise<unknown>;
  toolbarExtra?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<Tile[] | null>(null);
  const [library, setLibrary] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const editing = draft !== null;
  const editTile = draft?.find((t) => t.id === settingsId);
  const editDef = editTile ? getTile(editTile.type) : undefined;

  function add(def: TileDef) {
    setDraft((d) =>
      addTile(d ?? [], {
        id: newTileId(d ?? []),
        type: def.type,
        w: def.size.w,
        h: def.size.h,
        ...(def.config ? { config: def.config } : {}),
      }),
    );
  }

  return (
    <div className="stack">
      <div className="row dash-toolbar">
        {toolbarExtra}
        {canEdit && !editing ? (
          <Button
            className="dash-edit-only"
            variant="secondary"
            onClick={() => setDraft([...tiles])}
          >
            Edit layout
          </Button>
        ) : null}
        {editing ? (
          <>
            <Button
              loading={saving}
              onClick={() =>
                onSave(draft).then(
                  () => setDraft(null),
                  () => undefined,
                )
              }
            >
              Save layout
            </Button>
            <Button variant="secondary" onClick={() => setLibrary((v) => !v)}>
              Add tiles
            </Button>
            {onReset ? (
              <Button
                variant="secondary"
                onClick={() =>
                  onReset().then(
                    () => setDraft(null),
                    () => undefined,
                  )
                }
              >
                Reset to default
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(null);
                setLibrary(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : null}
      </div>
      {editing ? (
        <p className="u-muted">
          Drag a tile by its handle, pull the corner to resize, or use the arrow keys on the handle
          (Shift to resize). The layout is shared with your whole company.
        </p>
      ) : null}
      <ErrorAlert error={error} title="We couldn't save the layout" />
      {editing && library ? (
        <TileLibrary
          surface={surface}
          ctx={sampleCtx}
          onAdd={add}
          onClose={() => setLibrary(false)}
        />
      ) : null}
      <TileBoard
        tiles={draft ?? tiles}
        ctx={ctx}
        editor={
          draft
            ? {
                onChange: setDraft,
                onSettings: setSettingsId,
                onRemove: (id) => setDraft((d) => d && d.filter((t) => t.id !== id)),
              }
            : undefined
        }
      />
      <Dialog
        open={!!editTile && !!editDef?.Settings}
        onClose={() => setSettingsId(null)}
        title={`${editDef?.title ?? 'Tile'} settings`}
        footer={<Button onClick={() => setSettingsId(null)}>Done</Button>}
      >
        {editTile && editDef?.Settings ? (
          <editDef.Settings
            config={editTile.config ?? editDef.config ?? {}}
            ctx={ctx}
            onChange={(config) =>
              setDraft((d) => d && d.map((t) => (t.id === editTile.id ? { ...t, config } : t)))
            }
          />
        ) : null}
      </Dialog>
    </div>
  );
}
