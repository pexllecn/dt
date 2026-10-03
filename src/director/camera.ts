import gsap from 'gsap';
import { Vector3 } from 'three/webgpu';
import { bridge } from '@/app/bridge';
import { itmToScene, sceneToItm } from '@/lib/geo';

/** A camera framing: orbit target (ITM metres), distance (m), polar and azimuth (degrees). */
export interface Shot {
  e: number;
  n: number;
  dist: number;
  polar: number;
  az: number;
}

// Wall-clock timing: a slow frame must not stretch a camera move (GSAP would otherwise treat
// it as lag and slow the tween down).
gsap.ticker.lagSmoothing(0);

const DEG = Math.PI / 180;
const tmp = new Vector3();
let tween: gsap.core.Tween | null = null;

function ground(e: number, n: number): number {
  const [x, z] = itmToScene(e, n);
  return bridge.heightAt ? Math.max(0, bridge.heightAt(x, z)) : 0;
}

function apply(s: Shot) {
  const c = bridge.controls;
  if (!c) return;
  const [x, z] = itmToScene(s.e, s.n);
  const g = ground(s.e, s.n);
  const p = s.polar * DEG;
  const a = s.az * DEG;
  void c.setLookAt(x + s.dist * Math.sin(p) * Math.sin(a), g + s.dist * Math.cos(p), z + s.dist * Math.sin(p) * Math.cos(a), x, g, z, false);
}

/** Current framing read back from the controls. */
export function currentShot(): Shot | null {
  const c = bridge.controls;
  if (!c) return null;
  c.getTarget(tmp);
  const itm = sceneToItm(tmp.x, tmp.z);
  return { e: itm.e, n: itm.n, dist: c.distance, polar: c.polarAngle / DEG, az: c.azimuthAngle / DEG };
}

/**
 * Fly to a framing with GSAP. Long moves rise and fall (a hop proportional to the ground covered)
 * so the viewer keeps their bearings; azimuth takes the short way round.
 */
export function flyTo(to: Shot, seconds: number): Promise<void> {
  const from = currentShot();
  tween?.kill();
  if (!from || seconds <= 0) {
    apply(to);
    return Promise.resolve();
  }
  let daz = ((((to.az - from.az) % 360) + 540) % 360) - 180;
  if (Math.abs(daz) < 1e-3) daz = 0;
  const travel = Math.hypot(to.e - from.e, to.n - from.n);
  const hop = Math.min(400_000, travel * 0.55) * (travel > Math.max(from.dist, to.dist) * 0.6 ? 1 : 0);
  const state = { t: 0 };
  return new Promise((resolve) => {
    tween = gsap.to(state, {
      t: 1,
      duration: seconds,
      ease: 'power2.inOut',
      onUpdate: () => {
        const t = state.t;
        // Distance interpolates in log space so zooms feel even at every scale.
        const dist = Math.exp(Math.log(from.dist) + (Math.log(to.dist) - Math.log(from.dist)) * t) + hop * Math.sin(Math.PI * t);
        apply({
          e: from.e + (to.e - from.e) * t,
          n: from.n + (to.n - from.n) * t,
          dist,
          polar: from.polar + (to.polar - from.polar) * t,
          az: from.az + daz * t,
        });
      },
      onComplete: () => resolve(),
      onInterrupt: () => resolve(),
    });
  });
}

export function stopCamera() {
  tween?.kill();
  tween = null;
}
