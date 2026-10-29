// Drawing viewer (docs/mobile/03 §3.3): overview image at once, sharp tiles on top, pan and pinch.
// While the server has not built tiles for a sheet, say so rather than show a blank.
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { mobileRoutes } from '@archova/routes';
import { Button, useTheme } from '@archova/ui-native';
import { queries } from '../../../lib/api';
import { StateMessage, useCurrentOrg, useDeviceData, useLocalQuery } from '../../../shared';
import { listDefects } from '../../defects';
import { supersededNotice } from '../banner';
import { pinsOnRevision, type SheetPin } from '../pins';
import {
  fitViewport,
  panViewport,
  pinToScreen,
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
  tileUrlTemplate,
  pins,
  onOpenPin,
}: {
  pyramid: Pyramid;
  revisionId: string;
  overviewUrl: string | undefined;
  tileUrlTemplate: string;
  pins: SheetPin[];
  onOpenPin: (pin: SheetPin) => void;
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
          const now = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          const { last } = gesture.current;
          gesture.current.last = now;
          setView(panViewport(pyramid, v, now.x - last.x, now.y - last.y, MAX_SCALE));
        },
      }),
    [pyramid],
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
          {overviewUrl ? (
            <Image
              source={{ uri: overviewUrl }}
              style={{ position: 'absolute', ...drawn }}
              resizeMode="stretch"
            />
          ) : null}
          {tiles.map((k) => {
            const f = 2 ** (pyramid.levels - 1 - k.z);
            // One tile covers tileSize * f full-resolution pixels (the last row and column may be partial).
            const span = pyramid.tileSize * f * view.scale;
            return (
              <Image
                key={tileCacheKey(revisionId, k)}
                source={{ uri: tileUrl(tileUrlTemplate, k), cache: 'force-cache' }}
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
  const notice = revision.data ? supersededNotice(revision.data) : null;
  const tiles = useQuery({
    ...queries.drawingTiles(orgId ?? '', projectId, revisionId),
    enabled: orgId !== null,
    // Poll gently while the server builds tiles.
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 10_000 : false),
  });

  if (!orgId) return <StateMessage message="Choose an organisation on the Home tab first." />;
  if (tiles.isPending) return <StateMessage loading message="Loading drawing" />;
  if (tiles.isError) {
    return (
      <StateMessage
        tone="danger"
        message="Could not load this drawing. Check your connection."
        onRetry={() => void tiles.refetch()}
      />
    );
  }
  const d = tiles.data;
  if (d.status !== 'ready' || !d.width || !d.height || !d.levels || !d.tileUrlTemplate) {
    return (
      <StateMessage
        loading
        message="This sheet is still being prepared. It will appear here shortly."
      />
    );
  }
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
      <SheetCanvas
        pyramid={{
          width: d.width,
          height: d.height,
          tileSize: d.tileSize ?? 256,
          levels: d.levels,
        }}
        revisionId={revisionId}
        overviewUrl={d.overviewUrl}
        tileUrlTemplate={d.tileUrlTemplate}
        pins={pins}
        onOpenPin={(pin) => router.push(mobileRoutes.defect(projectId, pin.defectId))}
      />
    </View>
  );
}
