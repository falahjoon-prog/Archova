// Site photos by album on the phone: the auto-albums first, then the photos in the chosen one. Online only.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import {
  albumSubtitle,
  browsePhotos,
  CATEGORY_LABELS,
  listPhotoAlbums,
  photoSubtitle,
} from '../browse';

export function PhotosScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const target = orgId ? { orgId, projectId } : null;
  const [album, setAlbum] = useState<{ key: string; label: string } | null>(null);
  const albums = useQuery({
    queryKey: ['photos', orgId, projectId, 'albums'],
    queryFn: () => listPhotoAlbums(api, target!),
    enabled: target !== null && album === null,
  });
  const photos = useQuery({
    queryKey: ['photos', orgId, projectId, 'browse', album?.key],
    queryFn: () => browsePhotos(api, target!, album!.key),
    enabled: target !== null && album !== null,
  });

  if (!orgId) {
    return (
      <Screen title="Photos">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  const active = album ? photos : albums;
  if (active.isPending) {
    return (
      <Screen title="Photos">
        <StateMessage loading message="Loading photos" />
      </Screen>
    );
  }
  if (active.isError) {
    return (
      <Screen title="Photos">
        <StateMessage
          tone="danger"
          message="Could not load photos. Check your connection."
          onRetry={() => void active.refetch()}
        />
      </Screen>
    );
  }
  if (album) {
    const list = photos.data ?? [];
    return (
      <Screen title={album.label}>
        <Button label="All albums" variant="secondary" onPress={() => setAlbum(null)} />
        {list.length === 0 ? <StateMessage message="No photos in this album yet." /> : null}
        {list.map((p) => (
          <View key={p.file.id} style={styles.row}>
            <Image
              source={{ uri: p.url }}
              accessibilityLabel={photoSubtitle(p)}
              style={[styles.thumb, { backgroundColor: t.color.borderControl }]}
            />
            <Text style={{ color: t.color.text, fontSize: t.font.size.sm, flex: 1 }}>
              {photoSubtitle(p)}
            </Text>
          </View>
        ))}
      </Screen>
    );
  }
  const data = albums.data!;
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  return (
    <Screen title="Photos">
      <Text accessibilityRole="header" style={heading}>
        Auto albums
      </Text>
      {data.auto.map((a) => (
        <ListItem
          key={a.category}
          title={CATEGORY_LABELS[a.category]}
          subtitle={albumSubtitle(a.count, a.needsReview)}
          onPress={() => setAlbum({ key: a.category, label: CATEGORY_LABELS[a.category] })}
        />
      ))}
      {data.own.length > 0 ? (
        <Text accessibilityRole="header" style={heading}>
          Your albums
        </Text>
      ) : null}
      {data.own.map((a) => (
        <ListItem
          key={a.id}
          title={a.name}
          subtitle={albumSubtitle(a.count)}
          onPress={() => setAlbum({ key: a.id, label: a.name })}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 88, height: 88, borderRadius: 8 },
});
