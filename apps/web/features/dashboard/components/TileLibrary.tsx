'use client';

import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, TextField } from '@archova/ui';
import {
  TILE_CATEGORIES,
  listTiles,
  type TileCategory,
  type TileContext,
  type TileDef,
  type TileSurface,
} from '../lib/registry';

/** A tile drawn small and inert, from sample data, so people see what they are adding. */
function Preview({ def, ctx }: { def: TileDef; ctx: TileContext }) {
  const Body = def.render;
  return (
    <div className="dash-preview" aria-hidden="true">
      <div className="dash-preview__inner">
        <Body config={def.config ?? {}} ctx={{ ...ctx, preview: true }} size={def.size} />
      </div>
    </div>
  );
}

/** "Add tiles": categories on the left, search on top, one card per tile type with a preview and an Add button. */
export function TileLibrary({
  surface,
  ctx,
  onAdd,
  onClose,
}: {
  surface: TileSurface;
  /** Context with sample data for previews. */
  ctx: TileContext;
  onAdd: (def: TileDef) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<TileCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const all = useMemo(() => listTiles(surface), [surface]);
  const q = query.trim().toLowerCase();
  const matches = (d: TileDef) => !q || `${d.title} ${d.description}`.toLowerCase().includes(q);
  const groups = TILE_CATEGORIES.filter((c) => category === 'all' || c.id === category)
    .map((c) => ({ ...c, tiles: all.filter((d) => d.category === c.id && matches(d)) }))
    .filter((g) => g.tiles.length > 0);

  return (
    <Card
      title="Add tiles"
      actions={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="dash-library">
        <nav aria-label="Tile categories" className="dash-library__cats">
          {[{ id: 'all' as const, label: 'All categories' }, ...TILE_CATEGORIES].map((c) => (
            <button
              key={c.id}
              type="button"
              className="dash-library__cat"
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </nav>
        <div className="stack">
          <TextField
            label="Search tiles"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {groups.length === 0 ? (
            <EmptyState title="No tiles match" description="Try another word or category." />
          ) : (
            groups.map((g) => (
              <section key={g.id} aria-labelledby={`lib-${g.id}`} className="stack">
                <h3 id={`lib-${g.id}`} className="panel-heading">
                  {g.label}
                </h3>
                <ul className="dash-library__grid">
                  {g.tiles.map((d) => (
                    <li key={d.type} className="dash-library__card">
                      <Preview def={d} ctx={ctx} />
                      <div className="dash-library__text">
                        <strong>{d.title}</strong>
                        <span className="u-muted">{d.description}</span>
                      </div>
                      <Button variant="secondary" onClick={() => onAdd(d)}>
                        Add {d.title}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
