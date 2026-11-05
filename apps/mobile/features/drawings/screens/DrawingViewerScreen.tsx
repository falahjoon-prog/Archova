// Drawing viewer (docs/mobile/03 §3.3): overview image at once, sharp tiles on top, pan and pinch.
// While the server has not built tiles for a sheet, say so rather than show a blank.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery } from '@tanstack/react-query';
import { uuidv7 } from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { Button, useTheme } from '@archova/ui-native';
import { api, queries } from '../../../lib/api';
import { StateMessage, useCurrentOrg, useDeviceData, useLocalQuery } from '../../../shared';
import { listDefects } from '../../defects';
import type { Markup } from '@archova/contracts';
import { overviewPath, tilePath } from '../../../lib/files/sheet-cache';
import { supersededNotice } from '../banner';
import { MarkupLayer } from './MarkupLayer';
import {
  canChangeMarkup,
  changeMarkup,
  listRevisionMarkups,
  savePenMarkup,
  type ChangeMarkup,
} from '../commands';
import { MyMarkups } from './MyMarkups';
import { useMe } from '../../platform';
import { createInk, type Ink } from '../ink';
import { needsLocationCheck } from '../markup';
import { drawingPdfUrl } from '../pdf';
import { pinsOnRevision, type SheetPin } from '../pins';
import {
  fitViewport,
  isTap,
  panViewport,
  pinToScreen,
  screenToPin,
  tileCacheKey,
  tileUrl,
  visibleTiles,
  zoomViewport,
  type Pyramid,
  type Viewport,
} from '../viewport';

const MAX_SCALE = 2;

const distance = (a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }) =>
  Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

function SheetCanvas({
  pyramid,
  revisionId,
  overviewUrl,
  tileSource,
  pins,
  markups,
  onOpenPin,
  placing,
  onPlace,
  inking,
  ink,
  onInkChange,
}: {
  pyramid: Pyramid;
  revisionId: string;
  overviewUrl: string | undefined;
  /** Where to load a tile from: a saved file, the network, or null when neither is available. */
  tileSource: (k: { z: number; x: number; y: number }) => string | null;
  pins: SheetPin[];
  markups: readonly Markup[];
  onOpenPin: (pin: SheetPin) => void;
  /** The next tap on the sheet drops a new defect pin there. */
  placing: boolean;
  onPlace: (pin: { pinX: number; pinY: number }) => void;
  /** One finger draws instead of panning; two fingers still pan and zoom. */
  inking: boolean;
  ink: Ink;
  /** Called as the drawing changes, so the screen can redraw and enable Save and Undo. */
  onInkChange: () => void;
}) {
  const t = useTheme();
  const [selected, setSelected] = useState<SheetPin | null>(null);
  const pinColor = (pin: SheetPin) =>
    pin.resolved
      ? t.color.statusNeutral
      : pin.priority === 'critical' || pin.priority === 'high'
        ? t.color.statusDanger
        : pin.priority === 'medium'
          ? t.color.statusWarning
          : t.color.statusInfo;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<Viewport | null>(null);
  const viewRef = useRef<Viewport | null>(null);
  viewRef.current = view;
  const placingRef = useRef(placing);
  placingRef.current = placing;
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const inkingRef = useRef(inking);
  inkingRef.current = inking;
  const onInkChangeRef = useRef(onInkChange);
  onInkChangeRef.current = onInkChange;
  const moved = useRef({ dx: 0, dy: 0, multi: false });
  const gesture = useRef<{ last: { x: number; y: number }; dist: number | null }>({
    last: { x: 0, y: 0 },
    dist: null,
  });

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setSize({ w: width, h: height });
      setView(fitViewport(pyramid, width, height));
    },
    [pyramid],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          moved.current = { dx: 0, dy: 0, multi: false };
          const start = viewRef.current;
          if (inkingRef.current && start) {
            const { pinX, pinY } = screenToPin(pyramid, start, {
              x: e.nativeEvent.locationX,
              y: e.nativeEvent.locationY,
            });
            ink.begin({ x: pinX, y: pinY });
          }
          gesture.current = {
            last: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY },
            dist: null,
          };
        },
        onPanResponderMove: (e) => {
          const v = viewRef.current;
          const touches = e.nativeEvent.touches;
          if (!v) return;
          const [a, b] = touches;
          if (a && b) {
            moved.current.multi = true;
            if (inkingRef.current) ink.cancel();
            const d = distance(a, b);
            const prev = gesture.current.dist;
            gesture.current.dist = d;
            if (prev && prev > 0) {
              const focus = {
                x: (a.locationX + b.locationX) / 2,
                y: (a.locationY + b.locationY) / 2,
              };
              setView(zoomViewport(pyramid, v, d / prev, focus, MAX_SCALE));
            }
            return;
          }
          gesture.current.dist = null;
          if (inkingRef.current) {
            const { pinX, pinY } = screenToPin(pyramid, v, {
              x: e.nativeEvent.locationX,
              y: e.nativeEvent.locationY,
            });
            ink.move({ x: pinX, y: pinY });
            onInkChangeRef.current();
            return;
          }
          const now = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          const { last } = gesture.current;
          gesture.current.last = now;
          moved.current.dx += now.x - last.x;
          moved.current.dy += now.y - last.y;
          setView(panViewport(pyramid, v, now.x - last.x, now.y - last.y, MAX_SCALE));
        },
        onPanResponderRelease: (e) => {
          if (inkingRef.current) {
            if (moved.current.multi) ink.cancel();
            else ink.end();
            onInkChangeRef.current();
            return;
          }
          const v = viewRef.current;
          const m = moved.current;
          if (!placingRef.current || !v || m.multi || !isTap(m.dx, m.dy)) return;
          onPlaceRef.current(
            screenToPin(pyramid, v, { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }),
          );
        },
      }),
    [pyramid, ink],
  );

  // The whole sheet is on screen from the overview; tiles at the sharp level sit over it.
  const tiles = view ? visibleTiles(pyramid, view) : [];
  const drawn = view
    ? {
        left: -view.x * view.scale,
        top: -view.y * view.scale,
        width: pyramid.width * view.scale,
        height: pyramid.height * view.scale,
      }
    : null;

  return (
    <View
      onLayout={onLayout}
      style={{ flex: 1, overflow: 'hidden', backgroundColor: t.color.surface }}
      {...responder.panHandlers}
    >
      {size && view && drawn ? (
        <>
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          >
            {overviewUrl ? (
              <Image
                source={{ uri: overviewUrl }}
                style={{ position: 'absolute', ...drawn }}
                resizeMode="stretch"
              />
            ) : null}
            {tiles.map((k) => {
              const uri = tileSource(k);
              if (!uri) return null;
              const f = 2 ** (pyramid.levels - 1 - k.z);
              // One tile covers tileSize * f full-resolution pixels (the last row and column may be partial).
              const span = pyramid.tileSize * f * view.scale;
              return (
                <Image
                  key={tileCacheKey(revisionId, k)}
                  source={{ uri, cache: 'force-cache' }}
                  style={{
                    position: 'absolute',
                    left: drawn.left + k.x * span,
                    top: drawn.top + k.y * span,
                    width: span,
                    height: span,
                  }}
                  resizeMode="stretch"
                />
              );
            })}
          </View>
          <MarkupLayer
            pyramid={pyramid}
            view={view}
            markups={[
              ...markups,
              {
                shapes: [
                  ...ink.strokes,
                  ...(ink.live.length > 1
                    ? [{ id: 'live', kind: 'pen' as const, points: [...ink.live], strokeWidth: 3 }]
                    : []),
                ],
              },
            ]}
          />
          {pins.map((pin) => {
            const at = pinToScreen(pyramid, view, pin);
            if (!at.onScreen) return null;
            return (
              <Pressable
                key={pin.defectId}
                onPress={() => setSelected(pin)}
                accessibilityRole="button"
                accessibilityLabel={`Defect ${pin.label}: ${pin.title}`}
                style={{
                  position: 'absolute',
                  left: at.x - 16,
                  top: at.y - 16,
                  minWidth: 32,
                  height: 32,
                  paddingHorizontal: 6,
                  borderRadius: t.radius.full,
                  backgroundColor: pinColor(pin),
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pin.resolved ? 0.6 : 1,
                }}
              >
                <Text style={{ color: t.color.surface, fontSize: 12, fontWeight: '700' }}>
                  {pin.label}
                </Text>
              </Pressable>
            );
          })}
        </>
      ) : null}
      {selected ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: t.space[3],
            gap: t.space[2],
            backgroundColor: t.color.surface,
          }}
        >
          <Text style={{ color: t.color.text, fontWeight: '700' }}>
            {selected.label} · {selected.title}
          </Text>
          <Button label="Open defect" onPress={() => onOpenPin(selected)} />
          <Button label="Close" variant="secondary" onPress={() => setSelected(null)} />
        </View>
      ) : null}
    </View>
  );
}

export function DrawingViewerScreen({
  projectId,
  revisionId,
}: {
  projectId: string;
  revisionId: string;
}) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const device = useDeviceData();
  const defects = useLocalQuery(
    device.status === 'ready' ? () => listDefects(device.data.store, projectId) : null,
    [device.status === 'ready' ? device.data : null, projectId],
  );
  const pins = pinsOnRevision(defects.value ?? [], revisionId);
  const revision = useQuery({
    ...queries.drawingRevision(orgId ?? '', projectId, revisionId),
    enabled: orgId !== null,
  });
  // The revision from the device when offline, so the "replaced by a newer revision" notice still shows.
  const storedRevision = useLocalQuery(
    device.status === 'ready'
      ? async () => (await device.data.store.get('drawing_revision', revisionId))?.data
      : null,
    [device.status === 'ready' ? device.data : null, revisionId],
  );
  const revisionInfo =
    revision.data ?? (storedRevision.value as typeof revision.data | null | undefined) ?? undefined;
  const notice = revisionInfo ? supersededNotice(revisionInfo) : null;
  // Markups come from the device, so a sheet and the strokes just drawn on it work with no signal.
  const markups = useLocalQuery(
    device.status === 'ready'
      ? () => listRevisionMarkups(device.data.store, projectId, revisionId)
      : null,
    [device.status === 'ready' ? device.data : null, projectId, revisionId],
  );
  const markupList = markups.value ?? [];
  const me = useMe();
  const myMarkups = markupList.filter((m) => canChangeMarkup(m, me.data?.user.id ?? null));
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const change = (markupId: string, what: ChangeMarkup) => {
    if (device.status !== 'ready') return;
    setChanging(true);
    setChangeError(null);
    changeMarkup(device.data.store, {
      markupId,
      change: what,
      mutationId: uuidv7(),
      clientAt: new Date().toISOString(),
    })
      .then((r) => {
        if (!r.ok) {
          setChangeError(
            r.reason === 'published'
              ? 'A published markup can not be changed.'
              : 'That markup is no longer on this device.',
          );
        } else {
          device.data.requestSync('local_write');
        }
        markups.refresh();
      })
      .catch(() => setChangeError('Could not save that change on this device. Try again.'))
      .finally(() => setChanging(false));
  };
  const [ink] = useState(() => createInk(uuidv7));
  const [, setInkVersion] = useState(0);
  const [inking, setInking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const sheetId = revisionInfo?.sheetId ?? null;
  // Defects are raised on the current sheet only, never on one that has been replaced.
  const canPin = sheetId !== null && notice === null;
  const tiles = useQuery({
    ...queries.drawingTiles(orgId ?? '', projectId, revisionId),
    enabled: orgId !== null,
    // Poll gently while the server builds tiles.
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 10_000 : false),
  });

  const sheets = device.status === 'ready' ? device.data.sheets : null;
  const saved = useLocalQuery(sheets ? () => sheets.get(revisionId) : null, [sheets, revisionId]);

  // Save the sheet for offline use the first time it opens with a connection. Failures are silent: the sheet
  // simply stays online-only and is tried again next time.
  const ready = tiles.data;
  useEffect(() => {
    if (
      !sheets ||
      !ready ||
      ready.status !== 'ready' ||
      !ready.width ||
      !ready.height ||
      !ready.levels ||
      !ready.tileUrlTemplate ||
      saved.value !== null
    )
      return;
    const spec = {
      width: ready.width,
      height: ready.height,
      tileSize: ready.tileSize ?? 256,
      levels: ready.levels,
      overviewUrl: ready.overviewUrl,
      tileUrlTemplate: ready.tileUrlTemplate,
    };
    void sheets
      .save(projectId, revisionId, spec)
      .then(async (ok) => {
        if (ok) {
          await sheets.evict(undefined, revisionId);
          saved.refresh();
        }
      })
      .catch(() => undefined);
  }, [sheets, ready, saved.value === null, projectId, revisionId]);

  const savedSheet = saved.value;
  if (!orgId && !savedSheet)
    return <StateMessage message="Choose an organisation on the Home tab first." />;
  if (tiles.isPending && !savedSheet) return <StateMessage loading message="Loading drawing" />;
  if (tiles.isError && !savedSheet) {
    return (
      <StateMessage
        tone="danger"
        message="Could not load this drawing. Check your connection."
        onRetry={() => void tiles.refetch()}
      />
    );
  }
  const d = tiles.data;
  if (!d && savedSheet && sheets) {
    // Offline (or the tiles call failed): the saved overview and low levels, and whatever else is already cached.
    return renderSheet({
      pyramid: {
        width: savedSheet.width,
        height: savedSheet.height,
        tileSize: savedSheet.tileSize,
        levels: savedSheet.levels,
      },
      overviewUrl: overviewPath(sheets.root, revisionId),
      tileSource: (k) =>
        k.z <= savedSheet.cachedLevel ? tilePath(sheets.root, revisionId, k) : null,
    });
  }
  if (!d) return null;
  if (d.status !== 'ready' || !d.width || !d.height || !d.levels || !d.tileUrlTemplate) {
    const file = revision.data;
    return (
      <View style={{ flex: 1 }}>
        <StateMessage
          loading
          message="This sheet is still being prepared. It will appear here shortly."
        />
        {file ? (
          <View style={{ padding: t.space[3], gap: t.space[2] }}>
            <Button
              label="Open the PDF meanwhile"
              variant="secondary"
              onPress={() => {
                if (!orgId) return;
                setPdfError(false);
                drawingPdfUrl(api, orgId, file.fileId, file.pageIndex)
                  .then((url) => WebBrowser.openBrowserAsync(url))
                  .catch(() => setPdfError(true));
              }}
            />
            {pdfError ? (
              <Text style={{ color: t.color.statusDanger }}>
                Could not open the PDF. Check your connection.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }
  // Tiles: a saved file when the sheet is on the device, otherwise the network.
  const local = savedSheet && sheets ? sheets.root : null;
  return renderSheet({
    pyramid: { width: d.width, height: d.height, tileSize: d.tileSize ?? 256, levels: d.levels },
    overviewUrl: local && savedSheet ? overviewPath(local, revisionId) : d.overviewUrl,
    tileSource: (k) =>
      local && savedSheet && k.z <= savedSheet.cachedLevel
        ? tilePath(local, revisionId, k)
        : tileUrl(d.tileUrlTemplate as string, k),
  });

  function renderSheet(args: {
    pyramid: Pyramid;
    overviewUrl: string | undefined;
    tileSource: (k: { z: number; x: number; y: number }) => string | null;
  }) {
    return (
      <View style={{ flex: 1 }}>
        {notice ? (
          <View
            accessibilityRole="alert"
            style={{ padding: t.space[3], gap: t.space[2], backgroundColor: t.color.statusWarning }}
          >
            <Text style={{ color: t.color.surface, fontWeight: '700' }}>{notice.message}</Text>
            {notice.latestRevisionId ? (
              <Button
                label="Open latest"
                variant="secondary"
                onPress={() =>
                  router.replace(mobileRoutes.drawingSheet(projectId, notice.latestRevisionId))
                }
              />
            ) : null}
          </View>
        ) : null}
        {needsLocationCheck(markupList) ? (
          <View style={{ padding: t.space[2], backgroundColor: t.color.statusWarning }}>
            <Text style={{ color: t.color.surface }}>
              Some markups came from an earlier revision. Check their location before relying on
              them.
            </Text>
          </View>
        ) : null}
        <SheetCanvas
          pyramid={args.pyramid}
          revisionId={revisionId}
          overviewUrl={args.overviewUrl}
          tileSource={args.tileSource}
          pins={pins}
          markups={markupList}
          onOpenPin={(pin) => router.push(mobileRoutes.defect(projectId, pin.defectId))}
          inking={inking}
          ink={ink}
          onInkChange={() => setInkVersion((n) => n + 1)}
          placing={placing}
          onPlace={(pin) => {
            setPlacing(false);
            if (sheetId) {
              router.push(
                mobileRoutes.newDefect(projectId, {
                  sheetId,
                  drawingRevisionId: revisionId,
                  ...pin,
                }),
              );
            }
          }}
        />
        {canPin ? (
          <View style={{ padding: t.space[3], gap: t.space[2] }}>
            <Button
              label={inking ? 'Stop drawing' : 'Draw a markup'}
              variant={inking ? 'secondary' : 'primary'}
              onPress={() => {
                setPlacing(false);
                setInking((on) => !on);
              }}
            />
            {ink.strokes.length > 0 ? (
              <View style={{ gap: t.space[2] }}>
                <Button
                  label="Save markup"
                  disabled={saving}
                  onPress={() => {
                    if (device.status !== 'ready') return;
                    setSaving(true);
                    setSaveError(false);
                    savePenMarkup(device.data.store, {
                      projectId,
                      revisionId,
                      shapes: ink.strokes,
                      mutationId: uuidv7(),
                      clientAt: new Date().toISOString(),
                    })
                      .then(() => {
                        ink.clear();
                        setInking(false);
                        setInkVersion((n) => n + 1);
                        markups.refresh();
                        device.data.requestSync('local_write');
                      })
                      .catch(() => setSaveError(true))
                      .finally(() => setSaving(false));
                  }}
                />
                <Button
                  label="Undo last stroke"
                  variant="secondary"
                  disabled={saving}
                  onPress={() => {
                    ink.undo();
                    setInkVersion((n) => n + 1);
                  }}
                />
                <Button
                  label="Discard drawing"
                  variant="secondary"
                  disabled={saving}
                  onPress={() => {
                    ink.clear();
                    setInkVersion((n) => n + 1);
                  }}
                />
                {saveError ? (
                  <Text style={{ color: t.color.statusDanger }}>
                    Could not save the markup on this device. Try again.
                  </Text>
                ) : null}
              </View>
            ) : null}
            <MyMarkups
              markups={myMarkups}
              busy={changing}
              onRemoveLastStroke={(m) =>
                change(m.id, { kind: 'shapes', shapes: m.shapes.slice(0, -1) as never })
              }
              onPublish={(m) => change(m.id, { kind: 'publish' })}
              onDelete={(m) => change(m.id, { kind: 'delete' })}
            />
            {changeError ? (
              <Text style={{ color: t.color.statusDanger }}>{changeError}</Text>
            ) : null}
            <Button
              label={
                placing
                  ? 'Tap the sheet where the defect is (cancel)'
                  : 'Raise defect on this sheet'
              }
              variant={placing ? 'secondary' : 'primary'}
              onPress={() => {
                setInking(false);
                setPlacing((p) => !p);
              }}
            />
          </View>
        ) : null}
      </View>
    );
  }
}
