import { useEffect, useState } from 'react';
import { detectCapability, type Capability } from '@/render/backend';
import { frameStats, useWorld } from './store';
import { useKeys } from './useKeys';
import { useSim } from '@/sim/client';
import { scenarios } from '@/sim/scenarios';
import { Stage } from './Stage';
import { Masthead } from '@/ui/Masthead';
import { DataBadge } from '@/ui/DataBadge';
import { TimeScrubber } from '@/ui/TimeScrubber';
import { DebugOverlay } from '@/ui/DebugOverlay';
import { FallbackCard } from '@/ui/FallbackCard';
import { LoadingVeil } from '@/ui/LoadingVeil';
import { BenchPanel } from '@/ui/BenchPanel';
import { StatsRow } from '@/ui/StatsRow';
import { SystemPill } from '@/ui/SystemPill';
import { SpecimenPanel } from '@/ui/SpecimenPanel';
import { AgentFeed } from '@/ui/AgentFeed';
import { AuditLog, Recommendations } from '@/ui/Recommendations';
import { Inspector } from '@/ui/Inspector';
import { Glyphs } from '@/ui/Glyphs';
import { Picker } from '@/ui/Picker';
import { Toast } from '@/ui/Toast';
import { Governance, Notes } from '@/ui/Notes';
import { Toolbar } from '@/ui/Toolbar';
import { EvidencePack, HeroPanel } from '@/ui/Hero';
import { DirectorBar, DirectorRuntime } from '@/director/Director';
import { useDirector } from '@/director/store';
import { bridge } from './bridge';
import { useUi } from '@/ui/uiStore';
import { CorridorLabels, CorridorsPanel } from '@/ui/Corridors';
import { ToolDock } from '@/ui/ToolDock';
import { Narration } from '@/ui/Narration';
import { caveFace, caveMaster, cavePreview } from '@/cave/cave';
import { CavePreview } from '@/cave/CavePreview';

// Test and rehearsal hook: the stores, read-only by convention.
Object.assign(window as unknown as Record<string, unknown>, { __twin: { useWorld, useSim, useUi, useDirector, bridge, frameStats } });

export function App() {
  const [cap, setCap] = useState<Capability | null>(null);
  const theme = useWorld((s) => s.theme);
  const ready = useWorld((s) => s.ready);
  const bench = new URLSearchParams(location.search).has('bench');
  const setBackend = useWorld((s) => s.setBackend);
  useKeys();

  useEffect(() => {
    void detectCapability().then((c) => {
      setCap(c);
      if (c.backend) setBackend(c.backend);
    });
  }, [setBackend]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The world (sun, season, labels) follows the scenario's date.
  useEffect(
    () =>
      useSim.subscribe((s, prev) => {
        if (s.inputs.scenario !== prev.inputs.scenario || !prev.meta) useWorld.setState({ date: scenarios[s.inputs.scenario].date });
      }),
    [],
  );

  if (cavePreview) return <CavePreview />;
  if (!cap) return null;
  if (!cap.backend) return <FallbackCard reason={cap.reason ?? ''} />;

  if (caveFace) {
    // Immersive face: the scene only. The honesty badge stays on the front wall.
    return (
      <div className="relative h-full w-full">
        <Stage backend={cap.backend} />
        <LoadingVeil />
        {caveFace === 'front' && <DataBadge />}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Stage backend={cap.backend} />
      <LoadingVeil />
      <Masthead />
      <Picker />
      {ready && !bench && <Glyphs />}
      <SystemPill />
      {caveMaster && <p className="figure pointer-events-none absolute right-8 top-[64px] z-40 text-[10px] uppercase tracking-[0.16em] text-ink-soft">immersive master · driving faces</p>}
      <DebugOverlay />
      <BenchPanel />
      <StatsRow />
      <TimeScrubber />
      {ready && !bench && (
        <>
          <DirectorRuntime />
          <DirectorBar />
          <Toolbar />
          <SpecimenPanel />
          <Inspector />
          <Recommendations />
          <HeroPanel />
          <CorridorsPanel />
          <CorridorLabels />
          <ToolDock />
          <Narration />
          <Toast />
          <Notes />
          <AgentFeed />
          <Governance />
          <AuditLog />
          <EvidencePack />
        </>
      )}
      <DataBadge />
    </div>
  );
}
