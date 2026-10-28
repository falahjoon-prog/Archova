'use client';

import { Captions, CaptionsOff, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Switch } from '../primitives/Checkbox';

export interface WatchProgress {
  /** Furthest point reached by watching, in seconds. */
  furthest: number;
  duration: number;
}

export interface WatchToEndVideoProps {
  title: string;
  src: string;
  /** Lower rendition for "Use less data". */
  lowDataSrc?: string;
  /** WebVTT captions, on by default (IND-AC11). Videos uploaded to an induction have none yet, so the control hides. */
  captionsSrc?: string;
  captionsLang?: string;
  /** Text transcript under the video. */
  transcript?: string;
  /** True until the person has watched to the end once: seeking past the furthest point watched snaps back. */
  enforce: boolean;
  /** Called every few seconds while playing, on pause and at the end; the server decides when it counts. */
  onProgress: (progress: WatchProgress) => void;
}

const REPORT_EVERY_S = 5;
/** Slack for timeupdate granularity: playback, not a seek. */
const PLAY_SLACK_S = 1.5;

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Video that must be watched to the end on first view (design 02 §7.10, design 08 B3): custom controls with
 * play/pause, back 10 seconds and captions; no seeking ahead of what has been watched until it's complete.
 */
export function WatchToEndVideo({
  title,
  src,
  lowDataSrc,
  captionsSrc,
  captionsLang = 'en',
  transcript,
  enforce,
  onProgress,
}: WatchToEndVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const furthest = useRef(0);
  const lastReport = useRef(0);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const enforceRef = useRef(enforce);
  enforceRef.current = enforce;
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [lowData, setLowData] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });

  const report = () => {
    const v = ref.current;
    if (!v || !Number.isFinite(v.duration)) return;
    lastReport.current = v.currentTime;
    onProgressRef.current({ furthest: furthest.current, duration: v.duration });
  };

  useEffect(() => {
    const track = ref.current?.textTracks[0];
    if (track) track.mode = captions ? 'showing' : 'hidden';
  }, [captions]);

  const switchRendition = (low: boolean) => {
    const v = ref.current;
    const at = v?.currentTime ?? 0;
    const wasPlaying = playing;
    setLowData(low);
    // Keep the place: the new source starts at the same time.
    requestAnimationFrame(() => {
      const next = ref.current;
      if (!next) return;
      next.currentTime = at;
      if (wasPlaying) void next.play().catch(() => setPlaying(false));
    });
  };

  return (
    <figure className="ac-video">
      <div className="ac-video__frame">
        <video
          ref={ref}
          src={lowData && lowDataSrc ? lowDataSrc : src}
          preload="metadata"
          playsInline
          aria-label={title}
          onLoadedMetadata={(e) =>
            setTime({ current: e.currentTarget.currentTime, duration: e.currentTarget.duration })
          }
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.currentTime <= furthest.current + PLAY_SLACK_S)
              furthest.current = Math.max(furthest.current, v.currentTime);
            setTime({ current: v.currentTime, duration: v.duration });
            if (v.currentTime - lastReport.current >= REPORT_EVERY_S) report();
          }}
          onSeeking={(e) => {
            const v = e.currentTarget;
            if (enforceRef.current && v.currentTime > furthest.current + PLAY_SLACK_S)
              v.currentTime = furthest.current;
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            report();
          }}
          onEnded={(e) => {
            furthest.current = e.currentTarget.duration;
            setPlaying(false);
            report();
          }}
        >
          {captionsSrc ? (
            <track
              kind="captions"
              src={captionsSrc}
              srcLang={captionsLang}
              label="Captions"
              default
            />
          ) : null}
        </video>
      </div>
      <div className="ac-video__controls">
        <button
          type="button"
          className="ac-video__button ac-focusable"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            if (v.paused) void v.play().catch(() => setPlaying(false));
            else v.pause();
          }}
        >
          {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="ac-video__button ac-focusable"
          aria-label="Back 10 seconds"
          onClick={() => {
            const v = ref.current;
            if (v) v.currentTime = Math.max(0, v.currentTime - 10);
          }}
        >
          <RotateCcw size={20} aria-hidden="true" />
        </button>
        {captionsSrc ? (
          <button
            type="button"
            className="ac-video__button ac-focusable"
            aria-pressed={captions}
            aria-label="Captions"
            onClick={() => setCaptions((c) => !c)}
          >
            {captions ? (
              <Captions size={20} aria-hidden="true" />
            ) : (
              <CaptionsOff size={20} aria-hidden="true" />
            )}
          </button>
        ) : null}
        <span className="ac-video__time">
          {formatClock(time.current)} / {formatClock(time.duration)}
        </span>
        {lowDataSrc ? (
          <Switch label="Use less data" checked={lowData} onCheckedChange={switchRendition} />
        ) : null}
      </div>
      {transcript ? (
        <details className="ac-video__transcript">
          <summary>Transcript</summary>
          <p>{transcript}</p>
        </details>
      ) : null}
    </figure>
  );
}
