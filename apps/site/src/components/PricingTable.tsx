import Link from 'next/link';
import { buttonClassName } from '@archova/ui';
import { getPriceBook } from '../lib/price-book';

export async function PricingTable({ note }: { note?: string | null }) {
  const book = await getPriceBook();
  return (
    <section className="section" aria-labelledby="pricing-heading">
      <h2 id="pricing-heading" className="visually-hidden">
        Plans and prices
      </h2>
      <ul className="plans">
        {book.plans.map((p) => (
          <li key={p.id} className="plan">
            <h3>{p.name}</h3>
            <p className="plan__price">
              <strong>{p.price}</strong> <span className="muted">{p.unit}</span>
            </p>
            <p>{p.blurb}</p>
            <ul className="plan__features">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <Link
              href={p.cta.href}
              className={buttonClassName(p.id === 'business' ? 'primary' : 'secondary')}
            >
              {p.cta.label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="muted">{note ?? book.gstNote}</p>
    </section>
  );
}
