/**
 * three r186 always passes `swizzle: 'rgba'` when creating texture views. Chromium builds from
 * 2025 typed that member as a dictionary and throw on the string. 'rgba' is the identity, so
 * removing it is always safe. Installed once before the renderer initialises.
 */
export function installWebGPUCompat(): void {
  const g = globalThis as unknown as { GPUTexture?: { prototype: { createView(d?: object): unknown } } };
  const proto = g.GPUTexture?.prototype;
  if (!proto || (proto as { __cgtPatched?: boolean }).__cgtPatched) return;
  const original = proto.createView;
  proto.createView = function (this: unknown, desc?: { swizzle?: unknown }) {
    if (desc && desc.swizzle === 'rgba') {
      const { swizzle: _ignored, ...rest } = desc;
      void _ignored;
      return original.call(this, rest);
    }
    return original.call(this, desc);
  };
  (proto as { __cgtPatched?: boolean }).__cgtPatched = true;
}
