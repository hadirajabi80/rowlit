// Largest-Triangle-Three-Buckets downsampling (Sveinn Steinarsson, 2013): keeps the visual shape of a long line
// with `threshold` points by picking, per bucket, the point that forms the largest triangle with the previously kept
// point and the average of the next bucket. First and last points are always kept.

/** Indices (ascending) of the points to keep. Returns every index when the input is already small enough. */
export function lttb(xs: ArrayLike<number>, ys: ArrayLike<number>, threshold: number): number[] {
  const n = xs.length;
  if (threshold >= n) return Array.from({ length: n }, (_, i) => i);
  if (threshold < 3) return n > 2 ? [0, n - 1] : Array.from({ length: n }, (_, i) => i);
  const keep: number[] = [0];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    // average of the next bucket
    let s = Math.floor((i + 1) * every) + 1;
    let e = Math.min(Math.floor((i + 2) * every) + 1, n);
    let ax = 0, ay = 0;
    for (let j = s; j < e; j++) { ax += xs[j]; ay += ys[j]; }
    const len = Math.max(1, e - s);
    ax /= len; ay /= len;
    // the current bucket
    s = Math.floor(i * every) + 1;
    e = Math.floor((i + 1) * every) + 1;
    const px = xs[a], py = ys[a];
    let best = -1, pick = s;
    for (let j = s; j < e; j++) {
      const area = Math.abs((px - ax) * (ys[j] - py) - (px - xs[j]) * (ay - py));
      if (area > best) { best = area; pick = j; }
    }
    keep.push(pick);
    a = pick;
  }
  keep.push(n - 1);
  return keep;
}
