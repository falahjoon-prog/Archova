'use client';

import { Camera, Upload } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { StatusPill } from '../primitives/StatusPill';

export type CredentialStatus = 'missing' | 'recorded' | 'sighted';

export interface CredentialCaptureCardProps {
  title: string;
  required?: boolean;
  status: CredentialStatus;
  /** The chosen photo, before or after saving; shown with the frame guide. */
  photo: Blob | null;
  onPhoto: (file: File) => void;
  /** Number, state, expiry: the caller's fields. */
  children?: ReactNode;
  /** Shown under the photo buttons: who sees the photo and when it's deleted. */
  note?: ReactNode;
}

const STATUS: Record<CredentialStatus, { tone: 'neutral' | 'info' | 'success'; label: string }> = {
  missing: { tone: 'neutral', label: 'Not added' },
  // "Recorded" or "Sighted", never "Verified" until a register lookup exists (IND-AC7).
  recorded: { tone: 'info', label: 'Recorded' },
  sighted: { tone: 'success', label: 'Sighted' },
};

/**
 * A ticket or licence on a phone (design 02 §7.10, design 08 B5): take a photo with the camera (frame guide over
 * the preview) or upload one, plus the caller's fields. Status reads "Recorded" or "Sighted", never "Verified".
 */
export function CredentialCaptureCard({
  title,
  required,
  status,
  photo,
  onPhoto,
  children,
  note,
}: CredentialCaptureCardProps) {
  const id = useId();
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!photo || typeof URL.createObjectURL !== 'function') {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const pill = STATUS[status];
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onPhoto(f);
  };

  return (
    <section className="ac-credential" aria-labelledby={`${id}-title`}>
      <div className="ac-credential__head">
        <h3 id={`${id}-title`} className="ac-credential__title">
          {title}
          {required ? <span className="ac-credential__required"> (required)</span> : null}
        </h3>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </div>
      <div className="ac-credential__photo">
        {preview ? (
          <img src={preview} alt={`Photo of your ${title.toLowerCase()}`} />
        ) : (
          <span className="ac-credential__guide" aria-hidden="true" />
        )}
      </div>
      <div className="ac-credential__buttons">
        <label className="ac-button ac-button--primary ac-focusable ac-credential__pick">
          <Camera size={20} aria-hidden="true" />
          {photo ? 'Retake photo' : 'Take photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="ac-visually-hidden"
            onChange={(e) => pick(e.target.files)}
          />
        </label>
        <label className="ac-button ac-button--secondary ac-focusable ac-credential__pick">
          <Upload size={20} aria-hidden="true" />
          Upload
          <input
            type="file"
            accept="image/*"
            className="ac-visually-hidden"
            onChange={(e) => pick(e.target.files)}
          />
        </label>
      </div>
      {note ? <p className="ac-credential__note">{note}</p> : null}
      {children ? <div className="ac-credential__fields">{children}</div> : null}
    </section>
  );
}
