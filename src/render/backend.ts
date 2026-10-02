import type { Backend } from '@/app/store';

export interface Capability {
  backend: Backend | null;
  reason?: string;
}

/** Choose WebGPU when an adapter is available, else WebGL2; ?backend=webgl forces the fallback. */
export async function detectCapability(): Promise<Capability> {
  const forced = new URLSearchParams(location.search).get('backend');
  const webgl2 = (() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  })();
  if (forced !== 'webgl' && 'gpu' in navigator) {
    try {
      const gpu = (navigator as Navigator & { gpu: { requestAdapter(o?: object): Promise<unknown> } }).gpu;
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) return { backend: 'webgpu' };
    } catch {
      /* fall through */
    }
  }
  if (webgl2) return { backend: 'webgl' };
  return { backend: null, reason: 'This browser supports neither WebGPU nor WebGL2.' };
}
