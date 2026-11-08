'use client';

import { useEffect, useId, useRef } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Underline,
  Undo2,
} from 'lucide-react';
import {
  docFromElement,
  fillElement,
  RICH_COLOURS,
  type RichColour,
  type RichDoc,
} from './richText';

export interface RichTextEditorProps {
  label: string;
  /** The document to start from. Read once; the editor owns the text while it is open. */
  initial: RichDoc;
  /** Called with the document as it is typed. */
  onChange: (doc: RichDoc) => void;
}

const COMMANDS: { cmd: string; label: string; icon: typeof Bold }[] = [
  { cmd: 'undo', label: 'Undo', icon: Undo2 },
  { cmd: 'redo', label: 'Redo', icon: Redo2 },
  { cmd: 'bold', label: 'Bold', icon: Bold },
  { cmd: 'italic', label: 'Italic', icon: Italic },
  { cmd: 'underline', label: 'Underline', icon: Underline },
  { cmd: 'insertUnorderedList', label: 'Bulleted list', icon: List },
  { cmd: 'insertOrderedList', label: 'Numbered list', icon: ListOrdered },
  { cmd: 'justifyLeft', label: 'Align left', icon: AlignLeft },
  { cmd: 'justifyCenter', label: 'Align centre', icon: AlignCenter },
  { cmd: 'justifyRight', label: 'Align right', icon: AlignRight },
];

/**
 * A small word-processor box: bold, italic, underline, lists, alignment and a few theme colours. It reads what was
 * typed back into a plain document (see richText.ts), so pasted markup or styles outside that set are dropped.
 */
export function RichTextEditor({ label, initial, onChange }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const labelId = useId();

  useEffect(() => {
    if (ref.current) fillElement(ref.current, initial);
    // Start from the document once; later edits live in the element.
  }, []);

  const emit = () => {
    if (ref.current) onChange(docFromElement(ref.current));
  };
  const run = (cmd: string, value?: string) => {
    ref.current?.focus();
    // execCommand is deprecated but is the only built-in way to edit rich text in a contenteditable box.
    document.execCommand(cmd, false, value);
    emit();
  };

  return (
    <div className="ac-rte">
      <span id={labelId} className="ac-rte__label">
        {label}
      </span>
      <div className="ac-rte__bar" role="toolbar" aria-label="Text formatting">
        {COMMANDS.map(({ cmd, label: l, icon: Icon }) => (
          <button
            key={cmd}
            type="button"
            className="ac-rte__btn ac-focusable"
            aria-label={l}
            title={l}
            // Keep the selection in the text while a button is pressed.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(cmd)}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        ))}
        <select
          className="ac-rte__colour ac-focusable"
          aria-label="Text colour"
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value as RichColour | 'default' | '';
            if (v) run('foreColor', v === 'default' ? '#18222b' : RICH_COLOURS[v]);
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            Colour
          </option>
          <option value="default">Default</option>
          <option value="slate">Slate</option>
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="blue">Blue</option>
        </select>
      </div>
      <div
        ref={ref}
        className="ac-rte__area ac-rt"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelId}
        tabIndex={0}
        onInput={emit}
        onBlur={emit}
      />
    </div>
  );
}
