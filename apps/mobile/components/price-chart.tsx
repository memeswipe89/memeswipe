import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

type Props = {
  data: number[];
};

export default function PriceChart({ data }: Props) {
  const source = useMemo(() => (Array.isArray(data) && data.length ? data : []), [data]);
  if (!source.length) return null;

  const width = 320;
  const height = 160;
  const max = Math.max(...source);
  const min = Math.min(...source);

  const points = source.map((value, i) => {
    const x = (i / (source.length - 1 || 1)) * width;
    const y = height - ((value - min) / (max - min || 1)) * height;
    return { x, y };
  });

  const path = `M${points.map((p) => `${p.x},${p.y}`).join(' L ')}`;
  const last = points[points.length - 1];

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
            <Stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Path d={`${path} L ${width},${height} L 0,${height} Z`} fill="url(#grad)" />

        <Path
          d={path}
          stroke="#22c55e"
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <Circle cx={last.x} cy={last.y} r={5} fill="#22c55e" />
      </Svg>
    </View>
  );
}

