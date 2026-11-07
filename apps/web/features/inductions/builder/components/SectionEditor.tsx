'use client';

import { Button, Select, StatusPill, TextField, Textarea } from '@archova/ui';
import { newAnimationBlock } from '../lib/animation';
import { blockSummary, sectionHasContent } from '../lib/content';
import { AnimationEditor } from './AnimationEditor';
import {
  SECTION_KEYS,
  SECTION_LABELS,
  type InductionBlock,
  type InductionSection,
  type InductionSectionKey,
} from '../lib/types';

interface Props {
  index: number;
  section: InductionSection;
  count: number;
  approved: boolean;
  /** Approving needs the saved draft, so it waits while edits are unsaved. */
  canApprove: boolean;
  busy: boolean;
  onChange: (next: InductionSection) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onApprove: () => void;
}

/** One section of the induction: its title, topic, content blocks and approval (IND-AC2). */
export function SectionEditor({
  index,
  section,
  count,
  approved,
  canApprove,
  busy,
  onChange,
  onMove,
  onRemove,
  onApprove,
}: Props) {
  const setBlock = (i: number, block: InductionBlock) =>
    onChange({ ...section, blocks: section.blocks.map((b, n) => (n === i ? block : b)) });
  const label = section.title || `Section ${index + 1}`;
  return (
    <section className="induction-section" aria-label={label}>
      <div className="induction-section__head">
        <h3 className="panel-heading">
          {index + 1}. {label}
        </h3>
        <StatusPill tone={approved ? 'success' : 'warning'}>
          {approved ? 'Approved' : 'Needs approval'}
        </StatusPill>
      </div>
      <div className="form-row">
        <TextField
          label="Title"
          value={section.title}
          maxLength={200}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
        <Select
          label="Topic"
          value={section.key}
          options={SECTION_KEYS.map((k) => ({ value: k, label: SECTION_LABELS[k] }))}
          onChange={(e) => onChange({ ...section, key: e.target.value as InductionSectionKey })}
        />
      </div>
      {section.blocks.map((block, i) =>
        block.type === 'text' ? (
          <Textarea
            key={i}
            label={`Text ${section.blocks.length > 1 ? i + 1 : ''}`.trim()}
            rows={5}
            value={block.body}
            maxLength={20000}
            onChange={(e) => setBlock(i, { type: 'text', body: e.target.value })}
          />
        ) : block.type === 'animation' ? (
          <div key={i} className="induction-block induction-block--animation">
            <AnimationEditor block={block} onChange={(next) => setBlock(i, next)} />
            <Button
              variant="tertiary"
              size="sm"
              onClick={() =>
                onChange({ ...section, blocks: section.blocks.filter((_, n) => n !== i) })
              }
            >
              Remove animation
            </Button>
          </div>
        ) : (
          <div key={i} className="induction-block">
            <span>{blockSummary(block)}</span>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() =>
                onChange({ ...section, blocks: section.blocks.filter((_, n) => n !== i) })
              }
            >
              Remove<span className="u-visually-hidden"> {blockSummary(block)}</span>
            </Button>
          </div>
        ),
      )}
      <div className="row-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange({ ...section, blocks: [...section.blocks, { type: 'text', body: '' }] })
          }
        >
          Add text
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange({ ...section, blocks: [...section.blocks, newAnimationBlock()] })}
        >
          Add animation
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label={`Move ${label} up`}
        >
          Move up
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label={`Move ${label} down`}
        >
          Move down
        </Button>
        <Button
          variant="tertiary"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove section ${label}`}
        >
          Remove section
        </Button>
        <Button
          size="sm"
          disabled={approved || !canApprove || busy || !sectionHasContent(section)}
          onClick={onApprove}
          aria-label={`Approve ${label}`}
        >
          Approve section
        </Button>
      </div>
    </section>
  );
}
