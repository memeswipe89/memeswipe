import React, { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { curveMonotoneX, line } from 'd3-shape';

type TimeRange = '1H' | '1D' | '1W' | '1M' | '1Y' | 'ALL';

type Props = {
  data: number[];
};

const TIME_RANGES: TimeRange[] = ['1H', '1D', '1W', '1M', '1Y', 'ALL'];

export default function TradeChart({ data }: Props) {
  const [activeRange, setActiveRange] = useState<TimeRange>('1M');
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(320);

  const chartHeight = 120;
  const paddingV = 8;

  // Slice data based on selected range
  const slicedData = useMemo(() => {
    if (!data || data.length < 2) return data || [];
    const sliceMap: Record<TimeRange, number> = {
      '1H': Math.ceil(data.length / 24),
      '1D': Math.ceil(data.length / 7),
      '1W': Math.ceil(data.length / 4),
      '1M': data.length,
      '1Y': data.length,
      'ALL': data.length,
    };
    const count = Math.max(2, sliceMap[activeRange]);
    return data.slice(-count);
  }, [data, activeRange]);

  const isUp = slicedData.length > 1
    ? slicedData[slicedData.length - 1] >= slicedData[0]
    : true;
  const color = isUp ? '#4ade80' : '#ef4444';

  const max = useMemo(() => Math.max(...slicedData), [slicedData]);
  const min = useMemo(() => Math.min(...slicedData), [slicedData]);

  const scaleY = useCallback(
    (v: number) => paddingV + (chartHeight - paddingV * 2) - ((v - min) / (max - min || 1)) * (chartHeight - paddingV * 2),
    [max, min, chartHeight]
  );
  const scaleX = useCallback(
    (i: number) => (i / (slicedData.length - 1)) * chartWidth,
    [slicedData.length, chartWidth]
  );

  const path = useMemo(() => {
    if (slicedData.length < 2) return '';
    const points = slicedData.map((d, i) => [scaleX(i), scaleY(d)] as [number, number]);
    const gen = line<[number, number]>().x(d => d[0]).y(d => d[1]).curve(curveMonotoneX);
    return gen(points) || '';
  }, [slicedData, scaleX, scaleY]);

  const scrubX = scrubIndex !== null ? scaleX(scrubIndex) : null;
  const scrubY = scrubIndex !== null ? scaleY(slicedData[scrubIndex]) : null;
  const scrubPrice = scrubIndex !== null ? slicedData[scrubIndex] : slicedData[slicedData.length - 1];

  const formatPrice = (v: number) => {
    if (!Number.isFinite(v)) return '$0';
    if (v >= 1) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
    // show significant digits for tiny prices
    return `$${v.toPrecision(4)}`;
  };

  const priceDiff = slicedData.length > 1 ? scrubPrice - slicedData[0] : 0;

  const onLayout = (e: LayoutChangeEvent) => {
    setChartWidth(e.nativeEvent.layout.width);
  };

  const handleTouch = useCallback((x: number) => {
    if (slicedData.length < 2) return;
    const idx = Math.round((x / chartWidth) * (slicedData.length - 1));
    setScrubIndex(Math.max(0, Math.min(slicedData.length - 1, idx)));
  }, [chartWidth, slicedData.length]);

  if (!data || data.length < 2) return null;

  return (
    <View style={styles.wrap}>
      {/* Price badge */}
      <View style={styles.badgeRow}>
        <View style={[styles.badge, priceDiff >= 0 ? styles.badgeGreen : styles.badgeRed]}>
          <Text style={[styles.badgeText, priceDiff >= 0 ? styles.textGreen : styles.textRed]}>
            {formatPrice(scrubPrice)}
          </Text>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartArea} onLayout={onLayout}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onTouchStart={e => handleTouch(e.nativeEvent.locationX)}
          onTouchMove={e => handleTouch(e.nativeEvent.locationX)}
          onTouchEnd={() => setScrubIndex(null)}
        >
          <Svg width={chartWidth} height={chartHeight}>
            <Path
              d={path}
              stroke={color}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {scrubX !== null && scrubY !== null && (
              <Line
                x1={scrubX}
                y1={0}
                x2={scrubX}
                y2={chartHeight}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1}
                strokeDasharray="4,3"
              />
            )}
          </Svg>
        </Pressable>
      </View>

      {/* Time selector */}
      <View style={styles.timeRow}>
        {TIME_RANGES.map(range => (
          <Pressable
            key={range}
            onPress={() => setActiveRange(range)}
            style={[styles.timeBtn, activeRange === range && styles.timeBtnActive]}
          >
            <Text style={[styles.timeBtnText, activeRange === range && styles.timeBtnTextActive]}>
              {range}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  badgeRow: {
    alignItems: 'flex-end',
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#1a1a1a',
  },
  badgeGreen: {},
  badgeRed: {},
  badgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  textGreen: {
    color: '#4ade80',
  },
  textRed: {
    color: '#ef4444',
  },
  chartArea: {
    width: '100%',
    height: 128,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 10,
  },
  timeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: 999,
  },
  timeBtnActive: {
    backgroundColor: '#2a2d35',
  },
  timeBtnText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '600',
  },
  timeBtnTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
});
