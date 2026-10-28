import { useMemo } from 'react';
import { ChartSvg } from '../Charts/ChartSvg';
import { buildScene } from '../Charts/scene';
import type { ChartData, ChartSpec } from '../Charts/types';

export function Sparkline({ values, label }: { values: { at: number; value: number }[]; label: string }) {
  const scene = useMemo(() => {
    const data: ChartData = { xKind: 'time', xName: 'Time', categories: values.map((v, i) => ({ key: String(v.at), label: new Date(v.at).toLocaleTimeString(), pos: v.at || i })), series: [{ name: label, column: label, agg: 'none', values: values.map((v) => v.value) }], usedRows: values.length, skippedRows: 0, droppedCategories: 0, droppedSeries: 0, bucket: 'none' };
    const spec: ChartSpec = { type: 'line', x: 'Time', y: [{ column: label, agg: 'none' }], group: null, bucket: 'none', sort: 'none', topN: 0, labels: false, legend: false, log: false };
    return buildScene(data, spec, 190, 72);
  }, [label, values]);
  return <div className="monitor-spark"><ChartSvg scene={scene} label={label}/></div>;
}
