import { cx } from '../lib/cx';
import type { RichBlock, RichDoc, RichRun } from './richText';

function Run({ run }: { run: RichRun }) {
  const cls = cx(
    run.bold && 'ac-rt--bold',
    run.italic && 'ac-rt--italic',
    run.underline && 'ac-rt--underline',
    run.colour && `ac-rt-colour--${run.colour}`,
  );
  return cls ? <span className={cls}>{run.text}</span> : <>{run.text}</>;
}

const Line = ({ line }: { line: RichRun[] }) => (
  <>
    {line.map((r, i) => (
      <Run key={i} run={r} />
    ))}
  </>
);

function Block({ block }: { block: RichBlock }) {
  const style = block.align && block.align !== 'left' ? { textAlign: block.align } : undefined;
  if (block.type === 'paragraph')
    return (
      <p className="ac-rt__p" style={style}>
        <Line line={block.lines[0] ?? []} />
      </p>
    );
  const List = block.type === 'bullet_list' ? 'ul' : 'ol';
  return (
    <List className="ac-rt__list" style={style}>
      {block.lines.map((l, i) => (
        <li key={i}>
          <Line line={l} />
        </li>
      ))}
    </List>
  );
}

/** Shows a rich-text document. Built from data with React elements, so nothing in it can run as markup. */
export function RichText({ doc }: { doc: RichDoc }) {
  return (
    <div className="ac-rt">
      {doc.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
