/** The Keystone lockup, used as supplied (brand/archova-logo); the reversed file shows on dark themes. */
export function BrandLogo({ height = 24 }: { height?: number }) {
  const width = Math.round((height * 456) / 100);
  return (
    <span className="brand-logo">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG needs no image optimisation */}
      <img
        className="brand-logo__light"
        src="/brand/archova-logo.svg"
        alt="Archova"
        width={width}
        height={height}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
      <img
        className="brand-logo__dark"
        src="/brand/archova-logo-reversed.svg"
        alt=""
        width={width}
        height={height}
      />
    </span>
  );
}
