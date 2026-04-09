"use client";

import { useEffect, useRef, useState } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5xy from "@amcharts/amcharts5/xy";
import * as am5stock from "@amcharts/amcharts5/stock";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

interface Props {
  /** Solana token mint address */
  address: string;
  /** Default interval */
  defaultInterval?: Interval;
  /** API base URL */
  apiBase?: string;
}

interface Candle {
  Date: number;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

interface ChartResponse {
  candles: Candle[];
  baseToken?: { symbol?: string; name?: string };
  interval: string;
  error?: string;
}

const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
const POLL_MS = 10_000;

export default function StockChart({
  address,
  defaultInterval = "15m",
  apiBase = process.env.NEXT_PUBLIC_API_URL ?? "https://memeswipe.onrender.com",
}: Props) {
  const chartDivRef    = useRef<HTMLDivElement>(null);
  const controlsDivRef = useRef<HTMLDivElement>(null);
  const rootRef        = useRef<am5.Root | null>(null);

  // Series refs so the poll callback can push data without re-mounting
  const valueSeriesRef  = useRef<am5xy.CandlestickSeries | null>(null);
  const volumeSeriesRef = useRef<am5xy.ColumnSeries | null>(null);
  const sbSeriesRef     = useRef<am5xy.LineSeries | null>(null);

  const [interval, setInterval] = useState<Interval>(defaultInterval);
  const [label, setLabel]       = useState<string>("");
  const [error, setError]       = useState<string>("");
  const [loading, setLoading]   = useState(true);

  // ── Build chart once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartDivRef.current || !controlsDivRef.current) return;

    const root = am5.Root.new(chartDivRef.current);
    rootRef.current = root;

    const myTheme = am5.Theme.new(root);
    myTheme.rule("Grid", ["scrollbar", "minor"]).setAll({ visible: false });
    root.setThemes([am5themes_Animated.new(root), myTheme]);
    root.numberFormatter.set("numberFormat", "#,###.00000000");

    // Stock chart
    const stockChart = root.container.children.push(
      am5stock.StockChart.new(root, {})
    );

    // ── Main panel ──────────────────────────────────────────────────────────
    const mainPanel = stockChart.panels.push(
      am5stock.StockPanel.new(root, {
        wheelY: "zoomX",
        panX: true,
        panY: true,
        height: am5.percent(70),
      })
    );

    const valueAxis = mainPanel.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, { pan: "zoom" }),
        tooltip: am5.Tooltip.new(root, {}),
        numberFormat: "#,###.00000000",
        extraTooltipPrecision: 2,
      })
    );

    const dateAxis = mainPanel.xAxes.push(
      am5xy.GaplessDateAxis.new(root, {
        groupData: true,
        groupCount: 150,
        baseInterval: { timeUnit: "minute", count: 1 },
        renderer: am5xy.AxisRendererX.new(root, { minorGridEnabled: true }),
        tooltip: am5.Tooltip.new(root, {}),
      })
    );

    const valueSeries = mainPanel.series.push(
      am5xy.CandlestickSeries.new(root, {
        turboMode: true,
        name: "Price",
        clustered: false,
        valueXField: "Date",
        valueYField: "Close",
        highValueYField: "High",
        lowValueYField: "Low",
        openValueYField: "Open",
        calculateAggregates: true,
        xAxis: dateAxis,
        yAxis: valueAxis,
        legendValueText:
          "O:[bold]{openValueY}[/]  H:[bold]{highValueY}[/]  L:[bold]{lowValueY}[/]  C:[bold]{valueY}[/]",
        legendRangeValueText: "",
      })
    );
    valueSeriesRef.current = valueSeries;
    stockChart.set("stockSeries", valueSeries);

    const valueLegend = mainPanel.plotContainer.children.push(
      am5stock.StockLegend.new(root, { stockChart })
    );
    valueLegend.data.setAll([valueSeries]);

    mainPanel.set(
      "cursor",
      am5xy.XYCursor.new(root, {
        yAxis: valueAxis,
        xAxis: dateAxis,
        snapToSeries: [valueSeries],
        snapToSeriesBy: "y!",
      })
    );

    // ── Volume panel ────────────────────────────────────────────────────────
    const volumePanel = stockChart.panels.push(
      am5stock.StockPanel.new(root, {
        wheelY: "zoomX",
        panX: true,
        panY: false,
        height: am5.percent(30),
        paddingTop: 6,
      })
    );
    volumePanel.panelControls.closeButton.set("forceHidden", true);

    const volumeDateAxis = volumePanel.xAxes.push(
      am5xy.GaplessDateAxis.new(root, {
        baseInterval: { timeUnit: "minute", count: 1 },
        groupData: true,
        groupCount: 150,
        renderer: am5xy.AxisRendererX.new(root, { minorGridEnabled: true }),
        tooltip: am5.Tooltip.new(root, { forceHidden: true }),
        height: 0,
      })
    );
    volumeDateAxis.get("renderer").labels.template.set("forceHidden", true);

    const volumeValueAxis = volumePanel.yAxes.push(
      am5xy.ValueAxis.new(root, {
        numberFormat: "#.#a",
        renderer: am5xy.AxisRendererY.new(root, { pan: "zoom" }),
      })
    );

    const volumeSeries = volumePanel.series.push(
      am5xy.ColumnSeries.new(root, {
        turboMode: true,
        name: "Volume",
        clustered: false,
        valueXField: "Date",
        valueYField: "Volume",
        xAxis: volumeDateAxis,
        yAxis: volumeValueAxis,
        legendValueText: "[bold]{valueY.formatNumber('#,###.0a')}[/]",
      })
    );
    volumeSeries.columns.template.setAll({ strokeOpacity: 0, fillOpacity: 0.5 });
    volumeSeries.columns.template.adapters.add("fill", (fill, target) => {
      const dataItem = target.dataItem;
      if (dataItem) return stockChart.getVolumeColor(dataItem);
      return fill;
    });
    volumeSeriesRef.current = volumeSeries;
    stockChart.set("volumeSeries", volumeSeries);

    const volumeLegend = volumePanel.plotContainer.children.push(
      am5stock.StockLegend.new(root, { stockChart })
    );
    volumeLegend.data.setAll([volumeSeries]);

    const volumeCursor = volumePanel.set(
      "cursor",
      am5xy.XYCursor.new(root, {
        yAxis: volumeValueAxis,
        xAxis: volumeDateAxis,
        snapToSeries: [volumeSeries],
        snapToSeriesBy: "y!",
      })
    );
    volumeCursor.lineY.set("forceHidden", true);

    // ── Scrollbar ────────────────────────────────────────────────────────────
    const scrollbar = mainPanel.set(
      "scrollbarX",
      am5xy.XYChartScrollbar.new(root, { orientation: "horizontal", height: 50 })
    );
    stockChart.toolsContainer.children.push(scrollbar);

    const sbDateAxis = scrollbar.chart.xAxes.push(
      am5xy.GaplessDateAxis.new(root, {
        baseInterval: { timeUnit: "minute", count: 1 },
        renderer: am5xy.AxisRendererX.new(root, { minorGridEnabled: true }),
      })
    );
    const sbValueAxis = scrollbar.chart.yAxes.push(
      am5xy.ValueAxis.new(root, { renderer: am5xy.AxisRendererY.new(root, {}) })
    );
    const sbSeries = scrollbar.chart.series.push(
      am5xy.LineSeries.new(root, {
        valueYField: "Close",
        valueXField: "Date",
        xAxis: sbDateAxis,
        yAxis: sbValueAxis,
      })
    );
    sbSeries.fills.template.setAll({ visible: true, fillOpacity: 0.3 });
    sbSeriesRef.current = sbSeries;

    // ── Toolbar ──────────────────────────────────────────────────────────────
    am5stock.StockToolbar.new(root, {
      container: controlsDivRef.current!,
      stockChart,
      controls: [
        am5stock.IndicatorControl.new(root, { stockChart, legend: valueLegend }),
        am5stock.DateRangeSelector.new(root, { stockChart }),
        am5stock.PeriodSelector.new(root, { stockChart }),
        am5stock.DrawingControl.new(root, { stockChart }),
        am5stock.ResetControl.new(root, { stockChart }),
        am5stock.SettingsControl.new(root, { stockChart }),
      ],
    });

    return () => {
      root.dispose();
      rootRef.current = null;
      valueSeriesRef.current = null;
      volumeSeriesRef.current = null;
      sbSeriesRef.current = null;
    };
  }, []); // mount once

  // ── Fetch + push data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!address) return;
    let active = true;

    async function fetchAndPush(isInitial: boolean) {
      try {
        const res = await fetch(
          `${apiBase}/api/chart/${encodeURIComponent(address)}?interval=${interval}`
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({})) as { error?: string };
          if (active) setError(j.error ?? `HTTP ${res.status}`);
          return;
        }
        const json: ChartResponse = await res.json();
        if (!active) return;

        if (json.error) { setError(json.error); return; }
        setError("");

        const candles = (json.candles ?? []).filter(
          (c) => Number.isFinite(c.Date) && Number.isFinite(c.Close)
        );
        if (!candles.length) return;

        if (json.baseToken?.symbol) setLabel(json.baseToken.symbol);

        const vs  = valueSeriesRef.current;
        const vols = volumeSeriesRef.current;
        const sb  = sbSeriesRef.current;
        if (!vs || !vols || !sb) return;

        if (isInitial) {
          // Full load
          vs.data.setAll(candles);
          vols.data.setAll(candles);
          sb.data.setAll(candles);
          setLoading(false);
        } else {
          // Incremental: push/update the last candle
          const last = candles[candles.length - 1];
          const existing = vs.data.values as Candle[];
          if (existing.length && existing[existing.length - 1].Date === last.Date) {
            // Update in place
            vs.data.setIndex(existing.length - 1, last);
            vols.data.setIndex(existing.length - 1, last);
            sb.data.setIndex(existing.length - 1, last);
          } else {
            // New candle
            vs.data.push(last);
            vols.data.push(last);
            sb.data.push(last);
          }
        }
      } catch (err: unknown) {
        if (active) setError(err instanceof Error ? err.message : "Fetch failed");
      }
    }

    setLoading(true);
    fetchAndPush(true);
    const timer = globalThis.setInterval(() => fetchAndPush(false), POLL_MS);

    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [address, interval, apiBase]);

  return (
    <div className="flex flex-col w-full h-full bg-[#13131f] rounded-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-base">{label || address.slice(0, 8) + "…"}</span>
          {loading && (
            <span className="text-xs text-white/40 animate-pulse">Loading…</span>
          )}
          {error && (
            <span className="text-xs text-red-400">{error}</span>
          )}
        </div>

        {/* Interval selector */}
        <div className="flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                interval === iv
                  ? "bg-white/20 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {iv.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar injected by amCharts */}
      <div ref={controlsDivRef} className="w-full" style={{ minHeight: 44 }} />

      {/* Chart canvas */}
      <div ref={chartDivRef} className="flex-1 w-full" style={{ minHeight: 480 }} />
    </div>
  );
}
