import type { SheetArtwork } from '../lib/artwork';

const DOOR_DIRS: Record<0 | 1 | 2 | 3, readonly [number, number]> = {
  0: [1, -1],
  1: [1, 1],
  2: [-1, -1],
  3: [-1, 1],
};

/** Renders preview artwork. Black on white like a printed sheet, whatever the app theme. */
export function SheetArtworkSvg({
  art,
  tone = 'ink',
}: {
  art: SheetArtwork;
  tone?: 'ink' | 'old' | 'new';
}) {
  // Sheet colours are paper and ink, not UI tokens; compare mode tints old red and new blue (DOC-AC9).
  const ink =
    tone === 'old' ? '#c2410c' : tone === 'new' ? '#1d4ed8' : art.raster ? '#4b5563' : '#111827';
  const { widthMm: w, heightMm: h } = art;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="presentation"
      aria-hidden="true"
    >
      {tone === 'ink' ? <rect x={0} y={0} width={w} height={h} fill="white" /> : null}
      <rect
        x={10}
        y={10}
        width={w - 20}
        height={h - 20}
        fill="none"
        stroke={ink}
        strokeWidth={0.6}
      />
      {art.walls.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={ink}
          strokeWidth={1.6}
          strokeLinecap="square"
        />
      ))}
      {art.doors.map((d, i) => {
        const [dx, dy] = DOOR_DIRS[d.dir];
        return (
          <g key={i} stroke={ink} strokeWidth={0.5} fill="none">
            <line x1={d.x} y1={d.y} x2={d.x + dx * d.r} y2={d.y} />
            <path
              d={`M ${d.x} ${d.y + dy * d.r} A ${d.r} ${d.r} 0 0 ${dx * dy > 0 ? 1 : 0} ${d.x + dx * d.r} ${d.y}`}
            />
            <line x1={d.x} y1={d.y} x2={d.x} y2={d.y + dy * d.r} />
          </g>
        );
      })}
      {art.labels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={l.y}
          fontSize={l.size ?? 7}
          textAnchor="middle"
          fill={ink}
          fontFamily="sans-serif"
        >
          {l.text}
        </text>
      ))}
      {art.dimensions.map((d, i) => (
        <g key={i} stroke={ink} strokeWidth={0.4} fill={ink}>
          <line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} />
          <line x1={d.x1} y1={d.y1 - 4} x2={d.x1} y2={d.y1 + 4} />
          <line x1={d.x2} y1={d.y2 - 4} x2={d.x2} y2={d.y2 + 4} />
          <text
            x={(d.x1 + d.x2) / 2}
            y={d.y1 - 3}
            fontSize={6}
            textAnchor="middle"
            stroke="none"
            fontFamily="sans-serif"
          >
            {d.text}
          </text>
        </g>
      ))}
      <g fill={ink} fontFamily="sans-serif">
        <rect x={640} y={420} width={190} height={164} fill="none" stroke={ink} strokeWidth={0.6} />
        <text x={650} y={440} fontSize={7}>
          {art.titleBlock.project}
        </text>
        <text x={650} y={470} fontSize={10} fontWeight={700}>
          {art.titleBlock.title.toUpperCase()}
        </text>
        <text x={650} y={510} fontSize={8}>
          DWG {art.titleBlock.sheetNumber}
        </text>
        <text x={650} y={530} fontSize={8}>
          REV {art.titleBlock.rev}
        </text>
        <text x={650} y={550} fontSize={8}>
          SCALE {art.titleBlock.scale ?? 'NTS'} @ A1
        </text>
      </g>
    </svg>
  );
}
