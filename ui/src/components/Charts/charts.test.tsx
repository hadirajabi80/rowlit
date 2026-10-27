// Rendering, interaction and export of the chart components.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellValue } from '../../api/types';
import { useUi } from '../../store/ui';
import { buildChartData } from './aggregate';
import ChartPanel from './ChartPanel';
import { ChartSvg } from './ChartSvg';
import { copyChart, saveChart, serializeSvg, svgToPngBlob } from './exportChart';
import { buildScene } from './scene';
import { hashQuery } from './settings';
import { cols, rowsOf, SALES_COLUMNS, SALES_ROWS, spec } from './testKit';
import type { ChartSpec, ChartType } from './types';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const y = [{ column: 'amount', agg: 'sum' as const }];
function chart(patch: Partial<ChartSpec>, rows: CellValue[][] = SALES_ROWS, columns = SALES_COLUMNS) {
  const s = spec(patch);
  const scene = buildScene(buildChartData(columns, rowsOf(rows), s), s, 640, 360);
  return render(<ChartSvg scene={scene} />);
}
const focus = (el: Element) => act(() => (el as HTMLElement).focus());
const svgOf = (c: HTMLElement) => c.querySelector('svg') as SVGSVGElement;

describe('chart types render', () => {
  const cases: [ChartType, Partial<ChartSpec>, RegExp, number][] = [
    ['bar', { x: 'region', y }, /^Bar chart of sum\(amount\) by region/, 3],
    ['hbar', { x: 'region', y }, /^Horizontal bar chart/, 3],
    ['stacked', { x: 'day', bucket: 'month', group: 'region', y: [{ column: 'qty', agg: 'sum' }] }, /^Stacked bar chart/, 5],
    ['line', { x: 'day', bucket: 'month', y }, /^Line chart/, 3],
    ['area', { x: 'day', bucket: 'month', y }, /^Area chart/, 3],
    ['scatter', { x: 'qty', y: [{ column: 'amount', agg: 'none' }] }, /^Scatter chart/, 6],
    ['pie', { x: 'region', y }, /^Pie chart/, 3],
    ['donut', { x: 'region', y }, /^Donut chart/, 3],
  ];
  for (const [type, patch, title, marks] of cases) {
    it(`${type}: an accessible svg with titled, labelled marks`, () => {
      const { container } = chart({ type, ...patch });
      const svg = svgOf(container);
      expect(svg).toHaveAccessibleName(title);
      expect(svg.querySelector('desc')?.textContent).toMatch(/\d/);
      const items = container.querySelectorAll('[data-mi]');
      expect(items).toHaveLength(marks);
      items.forEach((el) => expect(el).toHaveAttribute('aria-label'));
      expect(container.querySelector('style')?.textContent).toContain('var(--fg');
    });
  }

  it('kpi: the numbers as text with a name', () => {
    const { container } = chart({ type: 'kpi', y: [{ column: 'amount', agg: 'sum' }] });
    expect(svgOf(container)).toHaveAccessibleName('KPI: sum(amount)');
    expect(container.querySelector('.cs-kpi-value')?.textContent).toBe('59');
    expect(container.querySelector('.cs-kpi-label')?.textContent).toBe('sum(amount)');
  });

  it('series use the --chart-N tokens, never literal colours', () => {
    const { container } = chart({ type: 'stacked', x: 'day', bucket: 'month', group: 'region', y: [{ column: 'qty', agg: 'sum' }] });
    const fills = [...container.querySelectorAll<SVGElement>('rect[data-mi]')].map((r) => r.style.fill);
    expect(new Set(fills)).toEqual(new Set(['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']));
  });
});

describe('tooltips and keyboard', () => {
  it('one tab stop; arrows move between bars and show a tooltip', () => {
    const { container } = chart({ type: 'bar', x: 'region', y });
    const marks = [...container.querySelectorAll<SVGElement>('[data-mi]')];
    expect(marks.map((m) => m.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(screen.queryByRole('tooltip')).toBeNull();
    focus(marks[0]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('north');
    expect(screen.getByRole('tooltip')).toHaveTextContent('35');
    fireEvent.keyDown(marks[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(marks[1]);
    expect(marks[1]).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tooltip')).toHaveTextContent('south');
    expect(screen.getByRole('status')).toHaveTextContent('south, sum(amount): 19');
    fireEvent.keyDown(marks[1], { key: 'End' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('east');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('north');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Up/Down switch series of a multi-series chart, Left/Right switch categories', () => {
    const { container } = chart({ type: 'line', x: 'day', bucket: 'month', y: [{ column: 'amount', agg: 'sum' }, { column: 'qty', agg: 'sum' }] });
    const first = container.querySelector<SVGElement>('[data-mi="0"]')!;
    focus(first);
    expect(screen.getByRole('tooltip')).toHaveTextContent('2024-01');
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const active = document.activeElement as SVGElement;
    expect(active.getAttribute('aria-label')).toBe('2024-01, sum(qty): 6');
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    expect((document.activeElement as SVGElement).getAttribute('aria-label')).toBe('2024-02, sum(qty): 9');
    // both series are listed in the tooltip, the focused one emphasised
    expect(screen.getByRole('tooltip').querySelectorAll('.chart-tip-row')).toHaveLength(2);
    expect(screen.getByRole('tooltip').querySelector('.chart-tip-row.on')).toHaveTextContent('sum(qty)');
  });

  it('pointer movement shows the nearest point', () => {
    const { container } = chart({ type: 'bar', x: 'region', y });
    const svg = svgOf(container);
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360, x: 0, y: 0, toJSON: () => ({}) });
    const bar = container.querySelector<SVGRectElement>('rect[data-mi="1"]')!;
    fireEvent.pointerMove(svg, { clientX: Number(bar.getAttribute('x')) + 5, clientY: Number(bar.getAttribute('y')) + 5 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('south');
    fireEvent.pointerLeave(container.querySelector('.chart-stage')!);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('pie slices show their share on hover and focus', () => {
    const { container } = chart({ type: 'pie', x: 'region', y });
    fireEvent.pointerEnter(container.querySelector('[data-mi="1"]')!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('south');
    expect(screen.getByRole('tooltip')).toHaveTextContent('32%');
  });

  it('a dense chart is one focus stop that drives the cursor', () => {
    const rows: CellValue[][] = Array.from({ length: 5000 }, (_, i) => [i, Math.sin(i / 90)]);
    const { container } = chart({ type: 'line', x: 'x', y: [{ column: 'y', agg: 'none' }] }, rows, cols(['x', 'int'], ['y', 'float']));
    expect(container.querySelectorAll('[data-mi]')).toHaveLength(0);
    const plot = container.querySelector<SVGGElement>('g[tabindex="0"]')!;
    expect(plot).toBeTruthy();
    focus(plot);
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(container.querySelector('.chart-cursor')).toBeTruthy();
  });
});

describe('ChartPanel', () => {
  const props = { columns: SALES_COLUMNS, rows: rowsOf(SALES_ROWS), rev: 1, done: true, truncated: false, queryText: 'SELECT * FROM sales', name: 'sales' };

  it('starts from a suggestion (date + number -> line) and lets the builder change it', async () => {
    render(<ChartPanel {...props} />);
    expect(screen.getByRole('group', { name: 'Chart settings' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^Line chart/ })).toBeInTheDocument();
    // chart type
    fireEvent.click(screen.getByRole('combobox', { name: 'Chart type' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Pie' }));
    await waitFor(() => expect(screen.getByRole('group', { name: /^Pie chart/ })).toBeInTheDocument());
    // remembered per query text
    expect(JSON.parse(localStorage.getItem(`rowlit.chart.v1.${hashQuery('SELECT * FROM sales')}`)!).type).toBe('pie');
  });

  it('restores the remembered settings for the same query text', () => {
    localStorage.setItem(`rowlit.chart.v1.${hashQuery('SELECT * FROM sales')}`, JSON.stringify(spec({ type: 'hbar', x: 'region', y: [{ column: 'qty', agg: 'max' }] })));
    render(<ChartPanel {...props} queryText="  SELECT *
  FROM sales " />);
    expect(screen.getByRole('group', { name: /^Horizontal bar chart of max\(qty\) by region/ })).toBeInTheDocument();
  });

  it('adds and removes Y series, switches aggregation and toggles options', async () => {
    render(<ChartPanel {...props} queryText="q1" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Chart type' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Bar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove series 2' }));
    expect(screen.queryByRole('combobox', { name: 'Series 2 column' })).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'Series 1 aggregation' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Average' }));
    expect(screen.getByRole('group', { name: /avg\(amount\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add series/ }));
    expect(screen.getByRole('combobox', { name: 'Series 2 column' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Labels'));
    expect(document.querySelectorAll('.cs-label').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('Log scale'));
    expect(document.querySelector('.chart-plot')).toBeTruthy();
  });

  it('"Suggest a chart" goes back to the column-based suggestion', () => {
    render(<ChartPanel {...props} queryText="q2" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Chart type' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Donut' }));
    fireEvent.click(screen.getByRole('button', { name: /Suggest a chart/ }));
    expect(screen.getByRole('group', { name: /^Line chart/ })).toBeInTheDocument();
  });

  it('says why there is nothing to draw, and what was left out', () => {
    render(<ChartPanel {...props} queryText="q3" columns={cols(['blob', 'binary'])} rows={rowsOf([[null]])} />);
    expect(screen.getByText(/Choose a Y column/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export chart/ })).toBeDisabled();
  });

  it('notes a truncated or still loading result', () => {
    render(<ChartPanel {...props} queryText="q4" truncated done={false} />);
    expect(screen.getByText(/limited to the loaded rows/)).toBeInTheDocument();
    expect(screen.getByText(/still loading/)).toBeInTheDocument();
  });

  it('updates when rows stream in', () => {
    const rows = rowsOf([['a', 1]]);
    const c = cols(['k', 'string'], ['v', 'int']);
    const { rerender } = render(<ChartPanel {...props} columns={c} rows={rows} queryText="q5" />);
    expect(screen.getByRole('img', { name: /^KPI/ })).toBeInTheDocument(); // one row: KPI
    const more = rowsOf([['a', 1], ['b', 2], ['a', 3]]);
    rerender(<ChartPanel {...props} columns={c} rows={more} rev={2} queryText="q5" />);
    expect(screen.getByRole('group', { name: /^Bar chart/ })).toBeInTheDocument();
  });
});

describe('export', () => {
  function styled() {
    const { container } = chart({ type: 'bar', x: 'region', y });
    const svg = svgOf(container);
    document.documentElement.style.setProperty('--bg-panel', '#fafafa');
    document.documentElement.style.setProperty('--chart-1', '#123456');
    document.documentElement.style.setProperty('--fg', '#111111');
    for (const v of ['--font-ui', '--fg-muted', '--border-subtle', '--border-strong']) document.documentElement.style.setProperty(v, v === '--font-ui' ? 'Arial' : '#999999');
    return svg;
  }
  afterEach(() => {
    for (const v of ['--bg-panel', '--chart-1', '--fg', '--font-ui', '--fg-muted', '--border-subtle', '--border-strong']) document.documentElement.style.removeProperty(v);
  });

  it('serialises a standalone SVG: no css variables, background, no cursor overlay or tab stops', () => {
    const svg = styled();
    const text = serializeSvg(svg);
    expect(text.startsWith('<svg')).toBe(true);
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).not.toMatch(/var\(--/);
    expect(text).toContain('#123456');
    expect(text).toMatch(/<rect width="640" height="360" fill="#fafafa"\/>/);
    expect(text).not.toContain('tabindex');
    expect(text).not.toContain('chart-cursor');
    expect(new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });

  it('keeps the cursor ring out of the file', () => {
    const { container } = chart({ type: 'bar', x: 'region', y });
    focus(container.querySelector<SVGElement>('[data-mi="0"]')!);
    expect(container.querySelector('.chart-cursor')).toBeTruthy();
    expect(serializeSvg(svgOf(container))).not.toContain('chart-cursor');
  });

  function mockCanvas() {
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn(), drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb) { cb(new Blob(['png'], { type: 'image/png' })); });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', FakeImage);
    return draw;
  }

  it('renders a PNG at twice the size through a canvas', async () => {
    const draw = mockCanvas();
    const blob = await svgToPngBlob('<svg/>', 640, 360);
    expect(blob.type).toBe('image/png');
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 360);
    vi.unstubAllGlobals();
  });

  it('saves PNG and SVG through the platform save dialog', async () => {
    mockCanvas();
    const save = vi.fn().mockResolvedValue('C:/out/sales.png');
    const platform = await import('../../platform');
    vi.spyOn(platform, 'getPlatform').mockReturnValue({ saveFile: save } as unknown as ReturnType<typeof platform.getPlatform>);
    const svg = styled();
    await saveChart(svg, 'png', 'my sales');
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ suggestedName: 'my_sales.png', mime: 'image/png', content: expect.any(Blob) }));
    await saveChart(svg, 'svg', 'sales');
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ suggestedName: 'sales.svg', mime: 'image/svg+xml', content: expect.stringContaining('<svg') }));
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'success' });
    vi.unstubAllGlobals();
  });

  it('copies the image to the clipboard, or the SVG text where images are not supported', async () => {
    mockCanvas();
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText }, configurable: true });
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    const svg = styled();
    await copyChart(svg);
    expect(write).toHaveBeenCalledTimes(1);
    expect((write.mock.calls[0][0][0] as { items: Record<string, Blob> }).items['image/png']).toBeInstanceOf(Blob);
    vi.stubGlobal('ClipboardItem', undefined);
    await copyChart(svg);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('<svg'));
    vi.unstubAllGlobals();
  });

  it('shows the Export menu with PNG, SVG and copy', async () => {
    render(<ChartPanel columns={SALES_COLUMNS} rows={rowsOf(SALES_ROWS)} rev={1} done truncated={false} queryText="q6" name="sales" />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Export chart/ })); });
    const { useMenu } = await import('../common/Menu');
    expect(useMenu.getState().open?.items.map((i) => i.label).filter(Boolean)).toEqual(['Save as PNG…', 'Save as SVG…', 'Copy image']);
  });
});
