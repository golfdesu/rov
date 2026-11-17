import { LANE_SHORT, laneKey } from "../utils/draft";

interface LaneIconProps {
  lane?: string;
  className?: string;
}

/** Minimal tactical vector lane emblems modeled after RoV's 5 in-game position icons. */
export function LaneIcon({ lane, className = "h-4 w-4" }: LaneIconProps) {
  const key = laneKey(lane);
  if (!key) return null;
  const label = LANE_SHORT[key]?.th ?? key;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-label={label}
      className={`shrink-0 select-none ${className}`}
    >
      {key === "DS_Lane" && (
        <>
          <path d="M3.5 18.5V6A2.5 2.5 0 0 1 6 3.5H18.5L15.5 6.5H6.5V15.5Z" />
          <path d="M20.5 5.5V18A2.5 2.5 0 0 1 18 20.5H5.5L8.5 17.5H17.5V8.5Z" opacity="0.28" />
          <circle cx="10.6" cy="13.4" r="2.8" />
          <path d="M14.34 12.72A2.5 2.5 0 1 0 11.28 9.66A3.8 3.8 0 0 1 14.34 12.72Z" />
        </>
      )}
      {key === "Dragon_Lane" && (
        <>
          <path d="M3.5 18.5V6A2.5 2.5 0 0 1 6 3.5H18.5L15.5 6.5H6.5V15.5Z" opacity="0.28" />
          <path d="M20.5 5.5V18A2.5 2.5 0 0 1 18 20.5H5.5L8.5 17.5H17.5V8.5Z" />
          <circle cx="12" cy="12" r="3.2" />
        </>
      )}
      {key === "Mid" && (
        <>
          <path d="M3.5 15V6A2.5 2.5 0 0 1 6 3.5H15L12.2 6.3H6.3V12.2Z" opacity="0.28" />
          <path d="M20.5 9V18A2.5 2.5 0 0 1 18 20.5H9L11.8 17.7H17.7V11.8Z" opacity="0.28" />
          <path d="M3.5 17.8L17.8 3.5H20.5V6.2L6.2 20.5H3.5Z" />
        </>
      )}
      {key === "Jungle" && (
        <>
          <path d="M3.5 3.5H16.5L3.5 16.5Z" />
          <path d="M20.5 20.5H7.5L20.5 7.5Z" />
        </>
      )}
      {key === "Roam" && (
        <>
          <path d="M12 6.8L14.4 10.5L12 14.2L9.6 10.5Z" />
          <path d="M12 20.5L7.2 15.8L4.4 13.5L6.8 13.1L3.4 9.6L6.4 9.6L3.8 5.2C6.4 7.3 8.2 10.2 9.2 13.6L12 16.5L14.8 13.6C15.8 10.2 17.6 7.3 20.2 5.2L17.6 9.6L20.6 9.6L17.2 13.1L19.6 13.5L16.8 15.8Z" />
        </>
      )}
    </svg>
  );
}
