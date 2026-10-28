import Link from 'next/link';
import { buttonClassName } from '@archova/ui';
import type { Page } from '../../payload-types';
import { PricingTable } from './PricingTable';
import { RichText } from './RichText';

type Block = Page['layout'][number];

function BlockView({ block }: { block: Block }) {
  switch (block.blockType) {
    case 'hero':
      return (
        <section className="hero">
          <h1>{block.heading}</h1>
          {block.subheading ? <p className="hero__sub">{block.subheading}</p> : null}
          <p className="hero__actions">
            {block.primaryLabel && block.primaryHref ? (
              <Link href={block.primaryHref} className={buttonClassName('primary')}>
                {block.primaryLabel}
              </Link>
            ) : null}
            {block.secondaryLabel && block.secondaryHref ? (
              <Link href={block.secondaryHref} className={buttonClassName('secondary')}>
                {block.secondaryLabel}
              </Link>
            ) : null}
          </p>
        </section>
      );
    case 'featureGrid':
      return (
        <section className="section">
          {block.heading ? <h2>{block.heading}</h2> : null}
          <ul className="grid">
            {(block.items ?? []).map((i) => (
              <li key={i.id} className="card">
                <h3>{i.title}</h3>
                <p>{i.body}</p>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'richText':
      return (
        <section className="section">
          <RichText data={block.content} />
        </section>
      );
    case 'faq':
      return (
        <section className="section">
          {block.heading ? <h2>{block.heading}</h2> : null}
          {(block.items ?? []).map((i) => (
            <details key={i.id} className="faq">
              <summary>{i.question}</summary>
              <p>{i.answer}</p>
            </details>
          ))}
        </section>
      );
    case 'cta':
      return (
        <section className="cta">
          <h2>{block.heading}</h2>
          {block.body ? <p>{block.body}</p> : null}
          <Link href={block.href} className={buttonClassName('primary')}>
            {block.label}
          </Link>
        </section>
      );
    case 'pricingTable':
      return <PricingTable note={block.note} />;
    default:
      return null;
  }
}

export function Blocks({ layout }: { layout: Page['layout'] }) {
  return (
    <>
      {layout.map((b, i) => (
        <BlockView key={b.id ?? i} block={b} />
      ))}
    </>
  );
}
