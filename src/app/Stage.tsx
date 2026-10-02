import { Canvas, extend, useFrame, useThree, type ThreeToJSXElements } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { frameStats, useWorld, type Backend } from './store';
import { WorldRuntime } from '@/scene/WorldRuntime';
import { ExploreControls, type ControlsHandle } from './ExploreControls';
import { installWebGPUCompat } from '@/render/compat';
import { BenchDriver } from './BenchDriver';
import { startSimulation } from '@/sim/client';

const benchMode = new URLSearchParams(location.search).has('bench');

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}
extend(THREE as unknown as Parameters<typeof extend>[0]);

function World({ controls }: { controls: React.RefObject<ControlsHandle | null> }) {
  const { gl, scene, camera } = useThree();
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

  useFrame((_, delta) => {
    const rt = runtime.current;
    const s = useWorld.getState();
    if (s.timeRate !== 0) s.setHours(s.hours + s.timeRate * delta);
    if (!rt) return;
    const target = controls.current?.target();
    if (target) rt.setFocus(target);
    rt.update(s, Math.min(delta, 0.1));
    rt.render(gl as unknown as THREE.WebGPURenderer);
    const info = (gl as unknown as THREE.WebGPURenderer).info;
    frameStats.drawCalls = info.render.drawCalls;
    frameStats.triangles = info.render.triangles;
    const acc = fpsAcc.current;
    acc.t += delta;
    acc.n += 1;
    if (acc.t > 0.5) {
      frameStats.fps = acc.n / acc.t;
      frameStats.frameMs = (acc.t / acc.n) * 1000;
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
