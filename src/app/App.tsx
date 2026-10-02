import { useEffect, useState } from 'react';
import { detectCapability, type Capability } from '@/render/backend';
import { useWorld } from './store';
import { useKeys } from './useKeys';
import { Stage } from './Stage';
import { Masthead } from '@/ui/Masthead';
import { StatusPill } from '@/ui/StatusPill';
import { DataBadge } from '@/ui/DataBadge';
import { TimeScrubber } from '@/ui/TimeScrubber';
import { DebugOverlay } from '@/ui/DebugOverlay';
import { FallbackCard } from '@/ui/FallbackCard';
import { LoadingVeil } from '@/ui/LoadingVeil';
import { BenchPanel } from '@/ui/BenchPanel';

export function App() {
  const [cap, setCap] = useState<Capability | null>(null);
  const theme = useWorld((s) => s.theme);
  const timeRate = useWorld((s) => s.timeRate);
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

  if (!cap) return null;
  if (!cap.backend) return <FallbackCard reason={cap.reason ?? ''} />;

  return (
    <div className="relative h-full w-full">
      <Stage backend={cap.backend} />
      <LoadingVeil />
      <Masthead />
      <StatusPill
        state={timeRate !== 0 ? { label: 'TIME-LAPSE · RUNNING', tone: 'running' } : { label: 'WORLD PREVIEW · PAUSED', tone: 'paused' }}
      />
      <DebugOverlay />
      <BenchPanel />
      <TimeScrubber />
      <DataBadge />
    </div>
  );
}
