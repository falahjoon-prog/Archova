// A video block of an induction section. It reports itself viewed only when the video was played through
// (see video.ts), not when it was skipped to the end.
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '@archova/ui-native';
import { createWatchTracker } from '../video';

function Player({ url, onWatched }: { url: string; onWatched: () => void }) {
  const t = useTheme();
  const tracker = useMemo(() => createWatchTracker(), []);
  const [progress, setProgress] = useState<string | null>(null);
  const player = useVideoPlayer(url, (p) => {
    p.timeUpdateEventInterval = 0.5;
  });

  useEffect(() => {
    const time = player.addListener('timeUpdate', ({ currentTime }) => tracker.tick(currentTime));
    const end = player.addListener('playToEnd', () => {
      tracker.ended();
      if (tracker.complete(player.duration)) onWatched();
      else
        setProgress('Watch the whole video, without skipping ahead. Play it again from the start.');
    });
    return () => {
      time.remove();
      end.remove();
    };
  }, [player, tracker, onWatched]);

  return (
    <View style={{ gap: t.space[2] }}>
      <VideoView
        player={player}
        nativeControls
        style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: t.color.surface }}
        accessibilityLabel="Induction video"
      />
      {progress ? <Text style={{ color: t.color.statusDanger }}>{progress}</Text> : null}
    </View>
  );
}

export function VideoBlockView({
  title,
  viewed,
  load,
  onViewed,
}: {
  title: string | null | undefined;
  viewed: boolean;
  load: () => Promise<{ url: string }>;
  onViewed: () => void;
}) {
  const t = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (link) => !cancelled && setUrl(link.url),
      () => !cancelled && setMessage('Could not load this video. Check your connection.'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={{ gap: t.space[2] }}>
      <Text style={{ color: t.color.text, fontWeight: '600' }}>{title ?? 'Video'}</Text>
      {url ? <Player url={url} onWatched={onViewed} /> : null}
      {viewed ? <Text style={{ color: t.color.statusSuccess }}>Watched</Text> : null}
      {message ? <Text style={{ color: t.color.statusDanger }}>{message}</Text> : null}
    </View>
  );
}
