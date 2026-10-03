import { Canvas, extend, useFrame, useThree, type ThreeToJSXElements } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { frameStats, useWorld, type Backend } from './store';
import { WorldRuntime } from '@/scene/WorldRuntime';
import { ExploreControls, type ControlsHandle } from './ExploreControls';
import { installWebGPUCompat } from '@/render/compat';
import { BenchDriver } from './BenchDriver';
import { startSimulation } from '@/sim/client';
import { bridge } from './bridge';
import { broadcastFrame } from '@/cave/cave';
import { world } from '@/scene/world/uniforms';

const benchMode = new URLSearchParams(location.search).has('bench');
const adaptive = !benchMode && new URLSearchParams(location.search).get('quality') !== 'fixed';

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}
extend(THREE as unknown as Parameters<typeof extend>[0]);

// Debug: log each node-material build (which object, which material, when) to find
// compilation stalls. Only with ?debugbuild.
if (new URLSearchParams(location.search).has('debugbuild')) {
  const proto = THREE.NodeMaterial.prototype as unknown as { setup(b: unknown): unknown };
  const orig = proto.setup;
  const log: string[] = ((window as unknown as { __builds: string[] }).__builds = []);
  proto.setup = function (this: unknown, builder: unknown) {
    const b = builder as { object?: { name?: string; type?: string }; material?: { type?: string }; context?: unknown; renderer?: unknown };
    log.push(`${(performance.now() / 1000).toFixed(1)}s ${b.object?.name || b.object?.type} ${b.material?.type}`);
    return orig.call(this, builder);
  };
}

function World({ controls }: { controls: React.RefObject<ControlsHandle | null> }) {
  const { gl, scene, camera } = useThree();
  const setDpr = useThree((s) => s.setDpr);
  const adapt = useRef({ low: 0, high: 0 });
  const runtime = useRef<WorldRuntime | null>(null);
  const setReady = useWorld((s) => s.setReady);
  const fpsAcc = useRef({ t: 0, n: 0 });

  useEffect(() => {
    startSimulation();
    let disposed = false;
    WorldRuntime.create(gl as unknown as THREE.WebGPURenderer, scene as unknown as THREE.Scene, camera as THREE.PerspectiveCamera, (m) =>
      setReady(false, m),
    )
      .then((rt) => {
        if (disposed) return rt.dispose();
        runtime.current = rt;
        controls.current?.setTerrain(rt.terrain);
        bridge.camera = camera as THREE.PerspectiveCamera;
        bridge.heightAt = (x, z) => rt.terrain.heightAt(x, z);
        bridge.pickBranch = (px, py, w, h) =>
          rt.network ? rt.network.pick(px, py, w, h, camera as THREE.PerspectiveCamera, world.exaggeration.value, Math.max(1, camera.position.y)) : -1;
        setReady(true);
      })
      .catch((e) => {
        console.error(e);
        setReady(false, `Could not load the world: ${String(e)}`);
      });
    return () => {
      disposed = true;
      runtime.current?.dispose();
      runtime.current = null;
    };
  }, [gl, scene, camera, setReady, controls]);

  useFrame((_, rawDelta) => {
    // Never negative (a clock change), never a huge jump (a background tab).
    const delta = Math.max(0, Math.min(rawDelta, 0.1));
    const rt = runtime.current;
    const s = useWorld.getState();
    if (s.timeRate !== 0) s.setHours(s.hours + s.timeRate * delta);
    if (!rt) return;
    const target = controls.current?.target();
    if (target) {
      rt.setFocus(target);
      broadcastFrame(camera as THREE.PerspectiveCamera, target);
    }
    const c0 = performance.now();
    rt.update(s, delta);
    const c1 = performance.now();
    rt.render(gl as unknown as THREE.WebGPURenderer);
    // Main-thread cost per frame (exponential average): world update, and render submission.
    frameStats.updateMs += (c1 - c0 - frameStats.updateMs) * 0.05;
    frameStats.submitMs += (performance.now() - c1 - frameStats.submitMs) * 0.05;
    const info = (gl as unknown as THREE.WebGPURenderer).info;
    frameStats.drawCalls = info.render.drawCalls;
    frameStats.triangles = info.render.triangles;
    const acc = fpsAcc.current;
    acc.t += Math.max(0, rawDelta);
    acc.n += 1;
    if (acc.t > 0.5) {
      frameStats.fps = acc.n / acc.t;
      frameStats.frameMs = (acc.t / acc.n) * 1000;
      // Adaptive resolution: keep the frame rate up on weaker GPUs by lowering the pixel ratio,
      // and give it back when there is headroom. Off for the benchmark and with ?quality=fixed.
      if (adaptive) {
        const a = adapt.current;
        a.low = frameStats.fps < 40 ? a.low + acc.t : 0;
        a.high = frameStats.fps > 57 ? a.high + acc.t : 0;
        const cur = gl.getPixelRatio();
        const max = Math.min(window.devicePixelRatio || 1, 2);
        if (a.low >= 3 && cur > 1) {
          setDpr(Math.max(1, cur - 0.5));
          a.low = 0;
        } else if (a.high >= 12 && cur < max) {
          setDpr(Math.min(max, cur + 0.25));
          a.high = 0;
        }
        frameStats.dpr = gl.getPixelRatio();
      }
      acc.t = 0;
      acc.n = 0;
    }
  }, 1);

  return null;
}

export function Stage({ backend }: { backend: Backend }) {
  const controls = useRef<ControlsHandle | null>(null);
  const quality = useWorld((s) => s.quality);
  return (
    <Canvas
      className="absolute inset-0"
      dpr={quality === 'high' ? [1, 2] : 1}
      shadows={false}
      flat
      camera={{ fov: 36, near: 10, far: 6_000_000, position: [0, 600_000, 600_000] }}
      gl={async (props) => {
        installWebGPUCompat();
        const renderer = new THREE.WebGPURenderer({
          ...(props as unknown as THREE.WebGPURendererParameters),
          antialias: false,
          forceWebGL: backend === 'webgl',
          reversedDepthBuffer: true,
          powerPreference: 'high-performance',
        });
        await renderer.init();
        return renderer as unknown as never;
      }}
    >
      <ExploreControls ref={controls} />
      <World controls={controls} />
      {benchMode && <BenchDriver controls={controls} />}
    </Canvas>
  );
}
