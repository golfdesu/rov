import type { Hero } from "../types/draft";
import { displayName } from "../utils/heroNames";
import { getHeroFallbackImage } from "../utils/imageFallback";

interface HeroPortraitProps {
  name: string;
  hero?: Hero;
  className?: string;
  /** CSS object-position, splash art usually reads best slightly above center */
  position?: string;
}

export function HeroPortrait({ name, hero, className = "", position = "50% 20%" }: HeroPortraitProps) {
  return (
    <img
      src={hero?.image_url || getHeroFallbackImage(displayName(name))}
      alt={displayName(name)}
      loading="lazy"
      draggable={false}
      style={{ objectPosition: position }}
      className={`h-full w-full object-cover ${className}`}
      onError={(e) => {
        const img = e.currentTarget;
        const fallback = getHeroFallbackImage(displayName(name));
        if (img.src !== fallback) img.src = fallback;
      }}
    />
  );
}
