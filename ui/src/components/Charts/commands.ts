// Chart commands (auto-loaded by commands/index.ts). The chart itself is a lazy chunk; this file only touches the tiny
// eager chartMode store, so it adds nothing to the initial bundle beyond two command descriptors.
//   results.toggleChart   grid <-> chart for the grid that has focus (or `args.gridKey`), result sets and data tabs alike
//   results.exportChart   save the shown chart as PNG / SVG (`args.format`, default PNG) or copy it (`args.format: 'copy'`)
import { registerCommands, type Command } from '../../commands/registry';
import { toast } from '../../store/ui';
import { activeGridController } from '../Grid/controller';
import { chartExporter, chartViewOf, toggleChart } from './chartMode';

interface ChartArgs {
  gridKey?: string;
  format?: 'png' | 'svg' | 'copy';
}
const argsOf = (a?: unknown): ChartArgs => (a && typeof a === 'object' ? (a as ChartArgs) : {});
const keyOf = (a?: unknown): string | null => argsOf(a).gridKey ?? activeGridController()?.key ?? null;
const chartShown = (a?: unknown): boolean => {
  const k = keyOf(a);
  return !!k && chartViewOf(k) !== 'grid';
};

export const CHART_COMMANDS: Command<never>[] = [
  {
    id: 'results.toggleChart', title: 'Toggle chart view of the results', category: 'Grid',
    keywords: 'chart graph plot bar line pie visualize grid',
    when: (a?: unknown) => !!keyOf(a),
    run: (a?: unknown) => {
      const k = keyOf(a);
      if (k) toggleChart(k);
    },
  },
  {
    id: 'results.exportChart', title: 'Export chart…', category: 'Grid', icon: 'Download',
    keywords: 'chart save png svg image copy picture',
    when: chartShown,
    run: async (a?: unknown) => {
      const k = keyOf(a);
      const e = k ? chartExporter(k) : undefined;
      if (!e) {
        toast('info', 'Show the chart first (Grid | Chart switch)');
        return;
      }
      const f = argsOf(a).format ?? 'png';
      await (f === 'copy' ? e.copy() : e.save(f));
    },
  },
];

export function registerChartCommands(): void {
  registerCommands(CHART_COMMANDS);
}
