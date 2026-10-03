import type React from 'react';
import { FACES, type Face } from './cave';

/**
 * Rehearsal view of the immersive rig: the five faces unfolded as a cross, each a live face
 * window, with the master below. In the room, each face runs full screen on its own projector.
 */
export function CavePreview() {
  const src = (face: Face | 'master') => `${location.pathname}?cave=${face}${face === 'master' ? '&mode=director' : ''}`;
  const cell = 'relative aspect-square border hairline overflow-hidden';
  const frame = (face: Face) => (
    <div className={cell} key={face}>
      <iframe title={`${face} face`} src={src(face)} className="absolute inset-0 h-full w-full" />
      <span className="figure absolute left-2 top-1 text-[10px] uppercase tracking-[0.16em] text-ink-soft">{face}</span>
    </div>
  );
  const blank = <div />;
  const byFace = Object.fromEntries(FACES.map((f) => [f, frame(f)])) as Record<Face, React.ReactElement>;
  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-auto p-6">
      <div>
        <h1 className="caption text-[26px] text-ink">Immersive rig preview</h1>
        <p className="mt-1 max-w-[880px] text-[12px] leading-relaxed text-ink-soft">
          Four walls and a floor, each a 90 degree view from the same eye. In the room, open each face full screen on its own display with <span className="figure">?cave=front</span>,{' '}
          <span className="figure">left</span>, <span className="figure">right</span>, <span className="figure">back</span> and <span className="figure">floor</span>, and drive them from{' '}
          <span className="figure">?cave=master</span> on the same machine. Faces follow the master’s position, heading, clock, theme and scenario.
        </p>
      </div>
      <div className="grid w-[min(100%,1080px)] grid-cols-4 gap-1">
        {blank}
        {byFace.back}
        {blank}
        {blank}
        {byFace.left}
        {byFace.floor}
        {byFace.right}
        {blank}
        {blank}
        {byFace.front}
        {blank}
        {blank}
      </div>
      <div className="relative aspect-video w-[min(100%,1080px)] border border-ink">
        <iframe title="master" src={src('master')} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
}
