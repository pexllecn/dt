/** Fullscreen for the whole application, with the prefixed calls older Safari still needs. */
import { signal } from '@preact/signals';

type Doc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type El = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as Doc;
const current = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

export const fullscreen = signal(!!current());
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { fullscreen.value = !!current(); });

export const fullscreenSupported = !!(document.documentElement.requestFullscreen || (document.documentElement as El).webkitRequestFullscreen);

export function toggleFullscreen(): void {
  const el = document.documentElement as El;
  try {
    if (current()) void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.());
    else void (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.());
  } catch {
    // Refused (for example inside a frame without permission): the button simply does nothing.
  }
}
