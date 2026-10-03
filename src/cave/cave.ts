import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import { useWorld } from '@/app/store';
import { useSim } from '@/sim/client';
import type { SimInputs } from '@/sim/protocol';
import { useUi } from '@/ui/uiStore';

/**
 * Immersive rig: four walls and a floor (a CAVE). One browser window per face, each a 90 degree
 * view from a shared eye, driven by a master window over a BroadcastChannel on the same machine.
 *
 *   master:  /?cave=master            (the presenter's normal view; broadcasts)
 *   faces:   /?cave=front | left | right | back | floor
 *   preview: /?cave=preview           (all five faces in a cross, for rehearsal)
 *
 * Walls keep the horizon level and turn with the master's heading; the floor looks straight
 * down with the master's forward direction at the top of the image.
 */
export type Face = 'front' | 'left' | 'right' | 'back' | 'floor';
export const FACES: Face[] = ['front', 'left', 'right', 'back', 'floor'];

const param = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('cave');
export const caveFace: Face | null = (FACES as string[]).includes(param ?? '') ? (param as Face) : null;
export const caveMaster = param === 'master';
export const cavePreview = param === 'preview';

interface FrameMsg {
  t: 'frame';
  pos: [number, number, number];
  target: [number, number, number];
  hours: number;
  theme: 'specimen' | 'control';
}
interface StateMsg {
  t: 'state';
  inputs: SimInputs;
  selectedBranch: string | null;
  windOn: boolean;
}
type Msg = FrameMsg | StateMsg;

const channel = typeof BroadcastChannel !== 'undefined' && (caveMaster || caveFace) ? new BroadcastChannel('cognitive-grid-twin-cave') : null;
let last: FrameMsg | null = null;
let lastSent = 0;

/** Master: send camera and clock (at most 30 times a second) and state on change. */
export function broadcastFrame(camera: PerspectiveCamera, target: Vector3) {
  if (!channel || !caveMaster) return;
  const now = performance.now();
  if (now - lastSent < 33) return;
  lastSent = now;
  const w = useWorld.getState();
  const msg: FrameMsg = { t: 'frame', pos: camera.position.toArray() as [number, number, number], target: target.toArray() as [number, number, number], hours: w.hours, theme: w.theme };
  channel.postMessage(msg);
}

if (channel && caveMaster) {
  const sendState = () => {
    const ui = useUi.getState();
    channel.postMessage({ t: 'state', inputs: useSim.getState().inputs, selectedBranch: ui.selectedBranch, windOn: ui.windOn } satisfies StateMsg);
  };
  useSim.subscribe((s, p) => s.inputs !== p.inputs && sendState());
  useUi.subscribe((s, p) => (s.selectedBranch !== p.selectedBranch || s.windOn !== p.windOn) && sendState());
  // Faces that join later ask for the state.
  channel.addEventListener('message', (e: MessageEvent<{ t: string }>) => e.data.t === 'hello' && sendState());
}

if (channel && caveFace) {
  channel.addEventListener('message', (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (m.t === 'frame') {
      last = m;
      const w = useWorld.getState();
      if (Math.abs(w.hours - m.hours) > 1e-3) w.setHours(m.hours);
      if (w.theme !== m.theme) w.setTheme(m.theme);
    } else if (m.t === 'state') {
      useSim.getState().setInputs(m.inputs);
      useUi.getState().set({ selectedBranch: m.selectedBranch, windOn: m.windOn });
    }
  });
  channel.postMessage({ t: 'hello' });
}

const fwd = new Vector3();
const dir = new Vector3();
const up = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Face window: place the camera at the master's eye, looking along this face. Returns the target. */
export function applyFace(camera: PerspectiveCamera, aspect: number): Vector3 | null {
  if (!caveFace || !last) return null;
  camera.position.fromArray(last.pos);
  fwd.fromArray(last.target).sub(camera.position);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = new Vector3().crossVectors(fwd, UP).normalize();
  if (caveFace === 'floor') {
    dir.set(0, -1, 0);
    up.copy(fwd);
  } else {
    dir.copy(caveFace === 'front' ? fwd : caveFace === 'back' ? fwd.clone().negate() : caveFace === 'left' ? right.clone().negate() : right);
    up.copy(UP);
  }
  camera.up.copy(up);
  camera.lookAt(dir.clone().add(camera.position));
  // 90 degrees across the face whatever the projector's aspect ratio.
  const fov = (2 * Math.atan(1 / Math.max(aspect, 1e-3)) * 180) / Math.PI;
  if (Math.abs(camera.fov - fov) > 0.01 || Math.abs(camera.aspect - aspect) > 1e-3) {
    camera.fov = fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  return new Vector3().fromArray(last.target);
}
