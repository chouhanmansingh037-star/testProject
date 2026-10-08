import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const CloseIcon = () => (
  <svg {...base}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const ExpandIcon = () => (
  <svg {...base}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);
export const InfoIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);
export const HomeIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="m3 11 9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </svg>
);
export const SendIcon = () => (
  <svg {...base}>
    <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />
  </svg>
);
export const StopIcon = () => (
  <svg {...base}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
export const ChatIcon = () => (
  <svg {...base} width={22} height={22}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z" />
  </svg>
);
export const BackIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

/** Friendly assistant avatar (header + cards). Pure SVG so there are no external image requests. */
export const Avatar = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Assistant avatar">
    <circle cx="24" cy="24" r="24" fill="#fff" />
    <circle cx="24" cy="21" r="9" fill="#f6c667" />
    <path d="M14 21a10 10 0 0 1 20 0c-4-1-7-4-10-6-3 3-6 5-10 6z" fill="#2b2f4a" />
    <circle cx="20.5" cy="22" r="1.2" fill="#2b2f4a" />
    <circle cx="27.5" cy="22" r="1.2" fill="#2b2f4a" />
    <path d="M21 26c1.5 1.4 4.5 1.4 6 0" stroke="#2b2f4a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    <path d="M10 44c1-8 7-11 14-11s13 3 14 11z" fill="#f2b705" />
  </svg>
);

export const ActionArt = ({ kind }: { kind: 'summary' | 'talk' | 'help' | 'teach' }) => {
  const paths: Record<typeof kind, string> = {
    summary: 'M7 4h7l5 5v11H7zM14 4v5h5M10 13h6M10 17h6',
    talk: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .8-1 1.7M12 17h.01',
    teach: 'M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 3 3 6 3s6-1.500 6-3v-4.500',
  };
  return (
    <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      <path d={paths[kind]} />
    </svg>
  );
};
