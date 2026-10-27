// Chart export: the rendered SVG becomes a standalone .svg (theme colours resolved to literals), a .png through a
// canvas, or an image on the clipboard.
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';

const VAR = /var\((--[\w-]+)\)/g;

/** A standalone SVG document of the chart: no CSS variables, a panel-coloured background, no interaction overlays. */
export function serializeSvg(svg: SVGSVGElement): string {
  const cs = getComputedStyle(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
  clone.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex'));
  clone.removeAttribute('xmlns'); // the serializer declares the SVG namespace itself (a second declaration is invalid XML)
  const w = svg.getAttribute('width') ?? '640', h = svg.getAttribute('height') ?? '400';
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  const resolve = (name: string) => cs.getPropertyValue(name).trim();
  const bg = resolve('--bg-panel') || 'white';
  let text = new XMLSerializer().serializeToString(clone);
  text = text.replace(VAR, (m, name: string) => resolve(name) || m);
  // the background goes first so everything else paints over it
  return text.replace(/(<svg\b[^>]*>)/, `$1<rect width="${w}" height="${h}" fill="${bg}"/>`);
}

export async function svgToPngBlob(svgText: string, w: number, h: number, scale = 2): Promise<Blob> {
  const img = new Image();
  const loaded = new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error('The chart image could not be rendered'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('PNG encoding failed'))), 'image/png'));
}

const size = (svg: SVGSVGElement) => ({ w: Number(svg.getAttribute('width')) || 640, h: Number(svg.getAttribute('height')) || 400 });
const fileName = (base: string, ext: string) => `${base.replace(/[^\p{L}\p{N}_.-]+/gu, '_') || 'chart'}.${ext}`;

export async function saveChart(svg: SVGSVGElement, format: 'png' | 'svg', baseName: string): Promise<void> {
  try {
    const text = serializeSvg(svg);
    const content = format === 'svg' ? text : await svgToPngBlob(text, size(svg).w, size(svg).h);
    const saved = await getPlatform().saveFile({
      suggestedName: fileName(baseName, format),
      content,
      mime: format === 'svg' ? 'image/svg+xml' : 'image/png',
      filters: [{ name: format === 'svg' ? 'SVG image' : 'PNG image', extensions: [format] }],
    });
    if (saved) toast('success', `Saved chart to ${saved}`);
  } catch (e) {
    toast('error', 'Could not export the chart', e instanceof Error ? e.message : String(e));
  }
}

/** PNG on the clipboard; where images cannot be written, the SVG source as text. */
export async function copyChart(svg: SVGSVGElement): Promise<void> {
  try {
    const text = serializeSvg(svg);
    const { w, h } = size(svg);
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const png = await svgToPngBlob(text, w, h);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('success', 'Chart copied to the clipboard');
    } else {
      await navigator.clipboard.writeText(text);
      toast('success', 'Chart SVG copied to the clipboard');
    }
  } catch (e) {
    toast('error', 'Could not copy the chart', e instanceof Error ? e.message : String(e));
  }
}
