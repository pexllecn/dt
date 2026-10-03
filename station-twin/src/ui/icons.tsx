/** A consistent line icon set: 24-unit grid, 1.6 stroke, round joins. No emojis anywhere. */
import type { SVGAttributes } from 'preact';

const P: Record<string, string> = {
  building: 'M4 21V7l8-4 8 4v14M4 21h16M9 21v-5h6v5M8 10h2M14 10h2M8 13h2M14 13h2',
  'arrow-up-right': 'M7 17L17 7M9 7h8v8',
  'arrow-down-left': 'M17 7L7 17M15 17H7V9',
  'arrow-down-right': 'M7 7l10 10M17 9v8H9',
  factory: 'M3 21V11l5 3V11l5 3V7l8 4v10H3zM7 17h2M12 17h2M17 17h2',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  battery: 'M3 8h15v8H3zM20 11v2M6 11v2M9 11v2',
  flame: 'M12 21c4 0 6-3 6-6 0-4-3-6-4-9-1 3-3 3-3 6-2-1-3-3-3-4-1 2-2 4-2 7 0 3 2 6 6 6z',
  wind: 'M3 8h11a3 3 0 10-3-3M3 12h16a3 3 0 11-3 3M3 16h8',
  'wind-low': 'M3 10h9a2.5 2.5 0 10-2.5-2.5M3 14h6',
  sunset: 'M3 18h18M12 14a4 4 0 00-4 4h8a4 4 0 00-4-4zM12 3v6M9 6l3 3 3-3M5.6 12.6l1.4 1.4M18.4 12.6L17 14',
  'circle-slash': 'M12 21a9 9 0 100-18 9 9 0 000 18zM5.6 5.6l12.8 12.8',
  'trending-up': 'M3 17l6-6 4 4 8-8M15 7h6v6',
  split: 'M12 3v6M12 15v6M5 12h4M15 12h4M9 9l-3-3M15 9l3-3M9 15l-3 3M15 15l3 3',
  'zap-off': 'M13 3L6 13h5l-1 8 7-10h-5l1-8zM3 3l18 18',
  'busbar-fault': 'M3 7h18M7 7v10M17 7v10M12 7l-2 5h4l-2 5',
  thermometer: 'M14 14.8V5a2 2 0 10-4 0v9.8a4 4 0 104 0zM12 9v7',
  'cloud-lightning': 'M7 17a5 5 0 01-.5-9.9A6 6 0 0118 9a4 4 0 01-.5 8M13 11l-3 5h4l-3 5',
  'rotate-ccw': 'M3 12a9 9 0 103-6.7M3 4v5h5',
  play: 'M7 4l13 8-13 8V4z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  x: 'M6 6l12 12M18 6L6 18',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.5',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  panel: 'M3 4h18v16H3zM9 4v16',
  home: 'M3 11l9-7 9 7M5 9v11h14V9',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.5M3 12h.5M3 18h.5',
  maximise: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  minimise: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  focus: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 15a3 3 0 100-6 3 3 0 000 6z',
};

export function Icon({ name, size = 16, ...rest }: { name: string; size?: number } & SVGAttributes<SVGSVGElement>) {
  const d = P[name] ?? P.info!;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={1.6} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...rest}>
      <path d={d} />
    </svg>
  );
}
