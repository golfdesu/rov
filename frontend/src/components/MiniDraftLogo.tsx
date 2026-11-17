import { useId } from "react";

interface MiniDraftLogoProps {
  className?: string;
}

/** RoV Arena crossed-swords & royal crown emblem without typography (1:1 parity with favicon.svg). */
export function MiniDraftLogo({ className = "h-7 w-7" }: MiniDraftLogoProps) {
  const uid = useId().replace(/:/g, "");
  const auraBlueId = `md-aura-b-${uid}`;
  const auraRedId = `md-aura-r-${uid}`;
  const crownGoldId = `md-crown-g-${uid}`;
  const hiltGoldId = `md-hilt-g-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={auraBlueId} cx="30%" cy="55%" r="48%">
          <stop offset="0%" stopColor="#3b9eff" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#3b9eff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={auraRedId} cx="70%" cy="55%" r="48%">
          <stop offset="0%" stopColor="#ff4d5e" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#ff4d5e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={crownGoldId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff0b3" />
          <stop offset="48%" stopColor="#f5c451" />
          <stop offset="100%" stopColor="#b87810" />
        </linearGradient>
        <linearGradient id={hiltGoldId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe598" />
          <stop offset="55%" stopColor="#f5c451" />
          <stop offset="100%" stopColor="#9e640b" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="14" fill="#070b14" />
      <rect width="64" height="64" rx="14" fill={`url(#${auraBlueId})`} />
      <rect width="64" height="64" rx="14" fill={`url(#${auraRedId})`} />
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="12"
        fill="none"
        stroke="#f5c451"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />

      <g transform="translate(32 40) rotate(-42)">
        <path
          d="M0 -24 L3.7 -17 L2.7 8 L-2.7 8 L-3.7 -17 Z"
          fill="#e8f3ff"
          stroke="#070b14"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M0 -24 L3.7 -17 L2.7 8 L0 8 Z" fill="#3b9eff" />
        <path
          d="M-9 7 L0 9.6 L9 7 L7.5 11.4 L0 12.8 L-7.5 11.4 Z"
          fill={`url(#${hiltGoldId})`}
          stroke="#070b14"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <rect x="-1.8" y="12.2" width="3.6" height="6.8" rx="0.8" fill="#1b263b" />
        <polygon points="0,18.5 3.6,21.5 0,24.5 -3.6,21.5" fill={`url(#${hiltGoldId})`} stroke="#070b14" strokeWidth="1" />
      </g>

      <g transform="translate(32 40) rotate(42)">
        <path
          d="M0 -24 L3.7 -17 L2.7 8 L-2.7 8 L-3.7 -17 Z"
          fill="#fff0f2"
          stroke="#070b14"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M0 -24 L3.7 -17 L2.7 8 L0 8 Z" fill="#ff4d5e" />
        <path
          d="M-9 7 L0 9.6 L9 7 L7.5 11.4 L0 12.8 L-7.5 11.4 Z"
          fill={`url(#${hiltGoldId})`}
          stroke="#070b14"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <rect x="-1.8" y="12.2" width="3.6" height="6.8" rx="0.8" fill="#1b263b" />
        <polygon points="0,18.5 3.6,21.5 0,24.5 -3.6,21.5" fill={`url(#${hiltGoldId})`} stroke="#070b14" strokeWidth="1" />
      </g>

      <path
        d="M19 22 L16.5 10.5 L25 16.2 L32 6.5 L39 16.2 L47.5 10.5 L45 22 Z"
        fill={`url(#${crownGoldId})`}
        stroke="#070b14"
        strokeWidth="2"
        strokeLinejoin="round"
        paintOrder="stroke fill"
      />
      <rect
        x="19"
        y="22.8"
        width="26"
        height="3.4"
        rx="1.2"
        fill={`url(#${crownGoldId})`}
        stroke="#070b14"
        strokeWidth="1.6"
        paintOrder="stroke fill"
      />
      <polygon points="32,12 34.8,15.8 32,19.6 29.2,15.8" fill="#3b9eff" stroke="#070b14" strokeWidth="1.1" />
    </svg>
  );
}
