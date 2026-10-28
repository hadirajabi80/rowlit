// Image preview of the value viewer: fit to the panel or actual size, with the pixel size of the image.
import { Maximize2, ScanSearch } from 'lucide-react';
import { useState } from 'react';

interface Props {
  src: string;
  alt: string;
  /** The browser could not decode the bytes (the viewer offers the hex dump instead). Key the component by `src`. */
  onError?(): void;
}

export function ImageView({ src, alt, onError }: Props) {
  const [fit, setFit] = useState(true);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  if (failed) return <div className="cell-viewer-error">This is not an image the viewer can draw. Use the Hex view.</div>;
  return (
    <div className="cell-viewer-image" aria-label="Image preview">
      <div className="cell-viewer-image-bar">
        <span className="muted">{size ? `${size.w} × ${size.h} px` : 'Loading…'}</span>
        <button className="icon-btn sm" aria-pressed={fit} title={fit ? 'Show at actual size' : 'Fit to panel'} aria-label={fit ? 'Actual size' : 'Fit to panel'} onClick={() => setFit(!fit)}>
          {fit ? <ScanSearch size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
      <div className={`cell-viewer-image-stage${fit ? ' fit' : ''}`}>
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => {
            setFailed(true);
            onError?.();
          }}
        />
      </div>
    </div>
  );
}
