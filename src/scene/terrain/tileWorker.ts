/// <reference lib="webworker" />
import { decode } from 'fast-png';
import { DataUtils } from 'three/webgpu';

/**
 * Decodes terrain PNGs off the main thread.
 *  - 'tile': 16-bit grey, code = round((h + off) * scale) * 2 + lakeFlag
 *    -> RG half floats (height m, lake 0/1) for the GPU, Float32 heights for CPU sampling
 *  - 'sdf' : 16-bit grey signed distance -> R half floats (metres)
 *  - 'rgb8': 8-bit RGB -> RGBA8
 */
export interface DecodeRequest {
  id: number;
  url: string;
  kind: 'tile' | 'sdf' | 'rgb8';
  hOffset: number;
  hScale: number;
  sdfScale: number;
}

export interface DecodeResponse {
  id: number;
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  gpu?: Uint16Array | Uint8Array;
  heights?: Float32Array;
  min?: number;
  max?: number;
}

self.onmessage = async (ev: MessageEvent<DecodeRequest>) => {
  const req = ev.data;
  try {
    const res = await fetch(req.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const png = decode(new Uint8Array(await res.arrayBuffer()));
    const n = png.width * png.height;
    const src = png.data;
    if (req.kind === 'tile') {
      const gpu = new Uint16Array(n * 2);
      const heights = new Float32Array(n);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < n; i++) {
        const code = src[i]!;
        const h = (code >> 1) / req.hScale - req.hOffset;
        heights[i] = h;
        if (h < min) min = h;
        if (h > max) max = h;
        gpu[i * 2] = DataUtils.toHalfFloat(h);
        gpu[i * 2 + 1] = DataUtils.toHalfFloat(code & 1);
      }
      const out: DecodeResponse = { id: req.id, ok: true, width: png.width, height: png.height, gpu, heights, min, max };
      (self as DedicatedWorkerGlobalScope).postMessage(out, [gpu.buffer, heights.buffer]);
    } else if (req.kind === 'sdf') {
      // Pad rows to an even width so each row is 4-byte aligned for the GPU upload.
      const w = png.width + (png.width % 2);
      const gpu = new Uint16Array(w * png.height);
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          gpu[y * w + x] = DataUtils.toHalfFloat((src[y * png.width + x]! - 32768) / req.sdfScale);
        }
        if (w !== png.width) gpu[y * w + png.width] = gpu[y * w + png.width - 1]!;
      }
      const out: DecodeResponse = { id: req.id, ok: true, width: w, height: png.height, gpu };
      (self as DedicatedWorkerGlobalScope).postMessage(out, [gpu.buffer]);
    } else {
      const ch = png.channels;
      const gpu = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        gpu[i * 4] = src[i * ch]!;
        gpu[i * 4 + 1] = src[i * ch + 1]!;
        gpu[i * 4 + 2] = src[i * ch + 2]!;
        gpu[i * 4 + 3] = 255;
      }
      const out: DecodeResponse = { id: req.id, ok: true, width: png.width, height: png.height, gpu };
      (self as DedicatedWorkerGlobalScope).postMessage(out, [gpu.buffer]);
    }
  } catch (e) {
    const out: DecodeResponse = { id: req.id, ok: false, error: String(e) };
    (self as DedicatedWorkerGlobalScope).postMessage(out);
  }
};
