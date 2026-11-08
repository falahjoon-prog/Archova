'use client';

import { Textarea } from '@archova/ui';
import { useBranding, useLogoUrl } from '@/features/branding';
import { registerTile, type TileProps } from './lib/registry';

/** Generic tiles that need no module data. Module tiles (stats, charts, health) register from their own feature. */

function TextBox({ config }: TileProps) {
  const text = typeof config.text === 'string' ? config.text : '';
  return text ? (
    <p className="dash-text">{text}</p>
  ) : (
    <p className="dash-text u-muted">Use Settings in Edit layout mode to write something here.</p>
  );
}

function LogoYou({ ctx }: TileProps) {
  const branding = useBranding(!ctx.preview);
  const logo = useLogoUrl(ctx.preview ? null : branding.data?.logoFileId);
  return logo.data ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="dash-logo" src={logo.data} alt="Company logo" />
  ) : (
    <p className="dash-text u-muted">Upload a logo in Settings → Branding to show it here.</p>
  );
}

registerTile({
  type: 'text_box',
  title: 'Text box',
  description: 'Add any notes, links or reminders.',
  category: 'project_information',
  surfaces: ['portfolio', 'project'],
  size: { w: 4, h: 3 },
  config: { text: 'Add your own text here.' },
  render: TextBox,
  Settings: ({ config, onChange }) => (
    <Textarea
      label="Text"
      rows={6}
      maxLength={600}
      value={typeof config.text === 'string' ? config.text : ''}
      onChange={(e) => onChange({ ...config, text: e.target.value })}
    />
  ),
});

registerTile({
  type: 'logo_you',
  title: 'Logo (yours)',
  description: "Show your company's logo.",
  category: 'project_information',
  surfaces: ['portfolio', 'project'],
  size: { w: 3, h: 3 },
  render: LogoYou,
});
