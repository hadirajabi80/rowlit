// Resources (docs/resources.md): memory of the Electron processes, reported by a window to the engine, which adds its
// own working set and compares the sum with the "Memory limit" setting. Electron-free so the Node tests can load it.
import type { AppMemoryInfo } from '../../../ui/src/platform/bridge';

/** The parts of Electron's ProcessMetric this module reads (memory sizes are in kilobytes). */
export interface ProcessMetricLike {
  type: string;
  memory?: { workingSetSize?: number; privateBytes?: number };
}

/** Sums app.getAppMetrics(): every process (browser, renderers, GPU, utilities), renderers apart. */
export function summarizeAppMetrics(metrics: readonly ProcessMetricLike[], systemBytes: number): AppMemoryInfo {
  let total = 0;
  let renderer = 0;
  for (const m of metrics) {
    const kb = m.memory?.workingSetSize ?? m.memory?.privateBytes ?? 0;
    const bytes = Number.isFinite(kb) && kb > 0 ? kb * 1024 : 0;
    total += bytes;
    if (m.type === 'Tab' || m.type === 'renderer') renderer += bytes;
  }
  return { totalBytes: total, rendererBytes: renderer, processes: metrics.length, systemBytes: Math.max(0, systemBytes) };
}
