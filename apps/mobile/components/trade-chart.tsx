import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { curveMonotoneX, line } from 'd3-shape';

type Props = {
  data: number[];
};

export default function TradeChart({ data }: Props) {
  if (!data || data.length < 2) return null;

  const width = 320;
  const height = 160;
  const max = Math.max(...data);
  const min = Math.min(...data);

  const scaleY = (value: number) => height - ((value - min) / (max - min || 1)) * height;
  const scaleX = (index: number) => (index / (data.length - 1)) * width;

  const points = data.map((d, i) => [scaleX(i), scaleY(d)] as [number, number]);

  const lineGenerator = line<[number, number]>()
    .x((d) => d[0])
    .y((d) => d[1])
    .curve(curveMonotoneX);

  const path = lineGenerator(points) || '';
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? '#22c55e' : '#ef4444';
  const lastX = scaleX(data.length - 1);
  const lastY = scaleY(data[data.length - 1]);

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="tradeChartGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Path d={`${path} L ${width},${height} L 0,${height} Z`} fill="url(#tradeChartGrad)" />
        <Path d={path} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={lastX} cy={lastY} r={5} fill={color} />
      </Svg>
    </View>
  );
}

