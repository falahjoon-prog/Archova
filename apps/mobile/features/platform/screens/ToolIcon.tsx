import Svg, { Path } from 'react-native-svg';

/** A 24 by 24 line icon drawn from stroke paths. */
export function ToolIcon({
  paths,
  size,
  color,
}: {
  paths: readonly string[];
  size: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {paths.map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
