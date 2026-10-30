// An image or document block of an induction section. It reports itself viewed only once the worker has really
// seen it: an image once it has loaded, a document once it was kept open for MIN_DOCUMENT_MS.
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Button, useTheme } from '@archova/ui-native';
import { MIN_DOCUMENT_MS } from '../flow';

type Link = { url: string };

export function FileBlockView({
  kind,
  title,
  viewed,
  load,
  onViewed,
}: {
  kind: 'image' | 'document';
  title: string | null | undefined;
  viewed: boolean;
  load: () => Promise<Link>;
  onViewed: () => void;
}) {
  const t = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = title ?? (kind === 'image' ? 'Image' : 'Document');

  useEffect(() => {
    if (kind !== 'image') return;
    let cancelled = false;
    load().then(
      (link) => !cancelled && setUrl(link.url),
      () => !cancelled && setMessage('Could not load this image. Check your connection.'),
    );
    return () => {
      cancelled = true;
    };
    // The link is fetched once per mount; `load` is a new closure each render.
  }, [kind]);

  const openDocument = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const link = await load();
      const openedAt = Date.now();
      await WebBrowser.openBrowserAsync(link.url);
      if (Date.now() - openedAt >= MIN_DOCUMENT_MS) onViewed();
      else setMessage('Keep the document open and read it, then close it.');
    } catch {
      setMessage('Could not open this document. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: t.space[2] }}>
      <Text style={{ color: t.color.text, fontWeight: '600' }}>{label}</Text>
      {kind === 'image' && url ? (
        <Image
          source={{ uri: url }}
          accessibilityLabel={label}
          resizeMode="contain"
          style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: t.color.surface }}
          onLoad={onViewed}
          onError={() => setMessage('Could not load this image. Check your connection.')}
        />
      ) : null}
      {kind === 'document' ? (
        <Button
          label={viewed ? `Open ${label} again` : `Open ${label}`}
          variant={viewed ? 'secondary' : 'primary'}
          disabled={busy}
          onPress={() => void openDocument()}
        />
      ) : null}
      {message ? <Text style={{ color: t.color.statusDanger }}>{message}</Text> : null}
    </View>
  );
}
