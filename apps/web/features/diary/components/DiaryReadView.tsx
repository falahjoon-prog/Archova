import type { ReactNode } from 'react';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { labourTotals } from '../lib/entry';
import { DELAY_TYPE_LABELS, type DiaryContent, type DiaryPhoto, type Weather } from '../lib/types';
import { WeatherSummary } from './WeatherSummary';

/** A submitted day, read-only. Changes go through Amend (X42). */
export function DiaryReadView({
  content,
  weather,
  photos,
}: {
  content: DiaryContent;
  weather: Weather | null;
  photos: DiaryPhoto[];
}) {
  const { companyName } = useProjectDirectory();
  const totals = labourTotals(content);
  const attached = photos.filter((p) => content.photoIds.includes(p.id));
  return (
    <div className="stack diary-sections">
      <Block id="diary-weather" title="Weather">
        {weather ? <WeatherSummary weather={weather} /> : null}
        {content.weatherNotes ? <p className="u-m-0 u-prewrap">{content.weatherNotes}</p> : null}
        {content.standDown.active ? (
          <p className="u-m-0">
            <strong>Site stood down</strong> {content.standDown.start ?? '?'}–
            {content.standDown.end ?? '?'}
            {content.standDown.companyIds.length
              ? `: ${content.standDown.companyIds.map(companyName).join(', ')}`
              : ''}
          </p>
        ) : null}
      </Block>
      <Block
        id="diary-labour"
        title="Labour"
        summary={`${totals.headcount} people · ${totals.hours} hours`}
      >
        <SimpleTable
          caption="Labour by company"
          head={['Company', 'Trade', 'Headcount', 'Hours']}
          rows={content.labour.map((l) => [
            companyName(l.companyId),
            l.trade,
            l.headcount ?? '—',
            l.hours ?? '—',
          ])}
        />
      </Block>
      <Block id="diary-delays" title="Delays">
        <SimpleTable
          caption="Delays"
          head={['Type', 'Hours', 'What happened', 'Affected', 'Possible EOT']}
          rows={content.delays.map((d) => [
            DELAY_TYPE_LABELS[d.type],
            d.hours ?? '—',
            d.description,
            d.affectedCompanyIds.map(companyName).join(', ') || '—',
            d.isEotCandidate ? 'Yes' : 'No',
          ])}
        />
      </Block>
      <Block id="diary-plant" title="Plant">
        <SimpleTable
          caption="Plant"
          head={['Plant', 'Quantity', 'Hours', 'Status']}
          rows={content.plant.map((p) => [
            p.description,
            p.quantity,
            p.hours ?? '—',
            p.status.replace('_', ' '),
          ])}
        />
      </Block>
      <Block id="diary-deliveries" title="Deliveries">
        <SimpleTable
          caption="Deliveries"
          head={['Supplier', 'Delivered', 'Docket']}
          rows={content.deliveries.map((d) => [d.supplier, d.description, d.docketNumber || '—'])}
        />
      </Block>
      <Block id="diary-visitors" title="Visitors">
        <SimpleTable
          caption="Visitors"
          head={['Name', 'Company', 'Purpose']}
          rows={content.visitors.map((v) => [v.name, v.company, v.purpose])}
        />
      </Block>
      <Block id="diary-notes" title="Notes">
        {content.notes ? <p className="u-m-0 u-prewrap">{content.notes}</p> : <Empty />}
      </Block>
      <Block id="diary-photos" title="Photos">
        {attached.length ? (
          <ul className="plain-list">
            {attached.map((p) => (
              <li key={p.id}>{p.caption}</li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Block>
    </div>
  );
}

function Block({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="diary-section" aria-labelledby={`${id}-h`}>
      <div className="diary-section__summary">
        <h2 id={`${id}-h`} className="diary-section__title">
          {title}
        </h2>
        {summary ? <span className="u-caption">{summary}</span> : null}
      </div>
      <div className="stack diary-section__body">{children}</div>
    </section>
  );
}

function Empty() {
  return <p className="u-muted u-m-0">None recorded.</p>;
}

function SimpleTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="u-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
