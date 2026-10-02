/**
 * The 3D station application: a full-bleed stage with UI floating over it.
 * Query parameters (for capture and review): capture, backend=webgl|webgpu, tier=high|medium|low,
 * theme=control, time=HH:MM, scenario=a,b, select=ID, view=tx,ty,tz,fx,fy,fz, frames=N.
 */
import '../ui/theme.css';
import { effect } from '@preact/signals';
import { render } from 'preact';
import { Engine } from '../sim/engine.ts';
import type { ComponentId } from '../sim/types.ts';
import { Stage, type Tier } from '../scene/stage.ts';
import { attachLabels } from '../ui/labels.ts';
import { Dock } from '../ui/Dock.tsx';
import { Inspector } from '../ui/Inspector.tsx';
import { Badge, Confirm, Debug, DockToggle, Keys, Log, Method, Toast } from '../ui/Overlays.tsx';
import { TopStrip } from '../ui/TopStrip.tsx';
import { localClient, workerClient, type SimClient } from './client.ts';
import { clock, confirmReq, debugOpen, dockOpen, methodOpen, selected, snap, theme, toast } from './store.ts';

const params = new URLSearchParams(location.search);
const capture = params.has('capture');
if (capture) document.documentElement.classList.add('capture');

function App({ client, stage }: { client: SimClient; stage: Stage }) {
  return (
    <>
      <TopStrip client={client} />
      <Dock client={client} />
      <DockToggle />
      <Inspector client={client} onFrame={(id) => stage.flyTo(id, true)} />
      <Toast />
      <Log />
      <Badge />
      {!capture && <Keys />}
      <Debug stats={() => stage.getStats()} />
      <Method />
      <Confirm />
    </>
  );
}

async function boot(): Promise<void> {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<div style="text-align:center">Building Clonmore<div class="bar2"><i></i></div></div>';
  document.body.appendChild(loading);

  const canvas = document.createElement('canvas');
  canvas.id = 'stage';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Three-dimensional view of Clonmore station. Click equipment to inspect it.');
  document.body.prepend(canvas);
  const backend = (params.get('backend') as 'webgpu' | 'webgl' | null) ?? 'auto';
  const tier = (params.get('tier') as Tier | null) ?? 'high';
  const stage = new Stage({ canvas, backend, tier, capture });
  await new Promise((r) => setTimeout(r, 30));
  await stage.init();

  // Simulation: worker for live use, main-thread engine for deterministic capture.
  let client: SimClient;
  if (capture) {
    const engine = new Engine();
    for (const s of (params.get('scenario') ?? '').split(',').filter(Boolean)) engine.command({ type: 'scenario', id: s as never });
    const time = params.get('time');
    if (time) { const [h, m] = time.split(':').map(Number); engine.runUntil((h! * 60 + (m ?? 0)) * 60); }
    for (const op of (params.get('ops') ?? '').split(',').filter(Boolean)) {
      const [kind, id, device, action] = op.split(':');
      if (kind === 'operate') engine.command({ type: 'operate', id: id as ComponentId, device: device as never, action: action as 'open' | 'close' });
    }
    client = localClient(engine);
    clock.value = { ...clock.value, paused: true };
  } else {
    client = workerClient();
  }

  const ui = document.createElement('div');
  ui.className = 'ui';
  document.body.appendChild(ui);
  const labelLayer = document.createElement('div');
  labelLayer.className = 'labels';
  ui.appendChild(labelLayer);
  const leader = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leader.setAttribute('class', 'leader');
  const leaderLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  leaderLine.setAttribute('fill', 'none');
  leaderLine.setAttribute('stroke', 'currentColor');
  leaderLine.setAttribute('stroke-width', '1');
  leaderLine.setAttribute('opacity', '0.55');
  leader.appendChild(leaderLine);
  ui.appendChild(leader);
  const appRoot = document.createElement('div');
  appRoot.style.display = 'contents';
  ui.appendChild(appRoot);
  render(<App client={client} stage={stage} />, appRoot);

  // Signals to the stage.
  effect(() => { const s = snap.value; if (s) stage.setState(s); });
  effect(() => { document.documentElement.dataset.theme = theme.value; stage.setTheme(theme.value); leader.style.color = theme.value === 'control' ? '#e8ecf1' : '#14181d'; });
  effect(() => stage.select(selected.value));
  stage.onPick = (id) => {
    selected.value = id;
    if (id) stage.flyTo(id);
  };

  const updateLabels = attachLabels(stage, labelLayer, () => snap.value, () => selected.value, (id) => { selected.value = id; stage.flyTo(id); });
  stage.onFrame = () => {
    updateLabels();
    const id = selected.value;
    const card = document.querySelector('.insp') as HTMLElement | null;
    if (id && card) {
      const [p] = stage.project([id]);
      const r = card.getBoundingClientRect();
      if (p && p.visible) {
        const cx = r.left;
        const cy = r.top + 28;
        leaderLine.setAttribute('points', `${p.x},${p.y} ${cx - 24},${cy} ${cx},${cy}`);
        leader.style.display = '';
      } else leader.style.display = 'none';
    } else leader.style.display = 'none';
  };

  // Keyboard (presenter keys from the plan, those available in milestone 3).
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (confirmReq.value) { if (e.key === 'Escape') confirmReq.value = null; return; }
    switch (e.key) {
      case ' ': e.preventDefault(); client.setClock({ paused: !clock.value.paused }); break;
      case 's': case 'S': dockOpen.value = !dockOpen.value; break;
      case 't': case 'T': theme.value = theme.value === 'daylight' ? 'control' : 'daylight'; break;
      case 'd': case 'D': debugOpen.value = !debugOpen.value; break;
      case 'm': case 'M': methodOpen.value = !methodOpen.value; break;
      case 'h': case 'H': selected.value = null; stage.overview(); break;
      case 'f': case 'F': if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); break;
      case 'r': case 'R': confirmReq.value = { title: 'Reset to baseline?', body: 'The station returns to 12:00 on a normal day.', action: 'Reset', run: () => void client.command({ type: 'scenario', id: 'reset' }).then((r) => (toast.value = { result: r, key: Date.now() })) }; break;
      case 'Escape': if (methodOpen.value) methodOpen.value = false; else selected.value = null; break;
    }
  });

  if (params.get('theme') === 'control') theme.value = 'control';
  const sel = params.get('select') as ComponentId | null;
  if (sel) selected.value = sel;
  if (params.has('dock') && params.get('dock') === '0') dockOpen.value = false;
  const view = params.get('view');
  if (view) {
    const [tx, ty, tz, fx, fy, fz] = view.split(',').map(Number) as [number, number, number, number, number, number];
    stage.view([tx, ty, tz], [fx, fy, fz], false);
  }
  if (params.has('method')) methodOpen.value = true;

  loading.classList.add('done');
  setTimeout(() => loading.remove(), 500);
  if (capture) {
    await stage.renderFrames(Number(params.get('frames') ?? 16), Number(params.get('dt') ?? 1 / 30));
    (window as unknown as { __stats: unknown }).__stats = stage.getStats();
    document.body.dataset.ready = '1';
    return;
  }
  stage.start();
  document.body.dataset.ready = '1';
}

void boot();
