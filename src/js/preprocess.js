// Photo clean-up before OCR. Pure functions on grey pixel arrays so they run in the page and in tests.
(function (root) {
  // Estimate the paper brightness around every pixel (coarse grid of bright percentiles, smoothed),
  // then divide it out: shadows, lamp glare and yellow paper all become an even white.
  function flatten(gray, w, h) {
    const s = Math.max(16, Math.round(Math.max(w, h) / 64));
    const gw = Math.ceil(w / s), gh = Math.ceil(h / s);
    const grid = new Float32Array(gw * gh);
    const hist = new Uint32Array(256);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        hist.fill(0);
        const x1 = Math.min(w, (gx + 1) * s), y1 = Math.min(h, (gy + 1) * s);
        let n = 0;
        for (let y = gy * s; y < y1; y++) for (let x = gx * s; x < x1; x++) { hist[gray[y * w + x]]++; n++; }
        let need = n * 0.1, v = 255;
        while (v > 0 && (need -= hist[v]) > 0) v--;
        grid[gy * gw + gx] = Math.max(v, 24);
      }
    }
    // grey-scale closing + blur on the grid so a block full of ink still sees the paper level
    const pass = (src, pick) => {
      const out = new Float32Array(src.length);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let acc = pick === 'avg' ? 0 : src[y * gw + x], cnt = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(gw - 1, Math.max(0, x + dx)), yy = Math.min(gh - 1, Math.max(0, y + dy));
          const val = src[yy * gw + xx];
          if (pick === 'max') acc = Math.max(acc, val); else { acc += val; cnt++; }
        }
        out[y * gw + x] = pick === 'avg' ? acc / cnt : acc;
      }
      return out;
    };
    const bg = pass(pass(grid, 'max'), 'avg');
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / s - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / s - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
        const b = (bg[y0 * gw + x0] * (1 - tx) + bg[y0 * gw + x1] * tx) * (1 - ty) + (bg[y1 * gw + x0] * (1 - tx) + bg[y1 * gw + x1] * tx) * ty;
        const norm = gray[y * w + x] / b;
        out[y * w + x] = (norm - 0.3) / 0.62 * 255;
      }
    }
    return out;
  }

  function otsu(px) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i++) hist[px[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = px.length - wB; if (!wF) break;
      sumB += t * hist[t];
      const d = sumB / wB - (sum - sumB) / wF, v = wB * wF * d * d;
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  function binarize(px) {
    const t = Math.min(200, Math.max(90, otsu(px)));
    const out = new Uint8ClampedArray(px.length);
    for (let i = 0; i < px.length; i++) out[i] = px[i] > t ? 255 : 0;
    return out;
  }

  // rgba -> grey (luma)
  function toGray(rgba, n) {
    const g = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    return g;
  }

  const api = { flatten, binarize, toGray, otsu };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Preprocess = api;
})(typeof window !== 'undefined' ? window : globalThis);
