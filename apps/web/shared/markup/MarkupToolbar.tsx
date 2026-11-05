'use client';

import { MARKUP_COLORS, MARKUP_STROKE_WIDTHS } from '@archova/markup';
import { ToggleGroup } from '@archova/ui';
import { MARKUP_TOOLS, type MarkupStyle, type MarkupTool } from './useMarkupDrawing';

/** Colour and line width pickers for the markup tools; every control is a real button or radio, keyboard first. */
export function MarkupStyleControls({
  style,
  onChange,
}: {
  style: MarkupStyle;
  onChange: (style: MarkupStyle) => void;
}) {
  return (
    <div className="markup-style">
      <div className="markup-style__colors" role="radiogroup" aria-label="Colour">
        {MARKUP_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={style.color === c.value}
            aria-label={c.label}
            className="markup-style__swatch ac-focusable"
            style={{ background: c.value }}
            onClick={() => onChange({ ...style, color: c.value })}
          />
        ))}
      </div>
      <ToggleGroup<string>
        label="Line width"
        value={String(style.strokeWidth)}
        onValueChange={(v) => onChange({ ...style, strokeWidth: Number(v) })}
        options={MARKUP_STROKE_WIDTHS.map((w) => ({ value: String(w.value), label: w.label }))}
      />
    </div>
  );
}

export function MarkupToolPicker({
  value,
  onChange,
  label = 'Markup tool',
}: {
  value: MarkupTool | null;
  onChange: (tool: MarkupTool) => void;
  label?: string;
}) {
  return (
    <ToggleGroup<MarkupTool | 'none'>
      label={label}
      value={value ?? 'none'}
      onValueChange={(v) => v !== 'none' && onChange(v)}
      options={MARKUP_TOOLS.map((t) => ({ value: t.value, label: t.label }))}
    />
  );
}
