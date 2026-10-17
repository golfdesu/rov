/**
 * Returns an SVG avatar data URI for heroes lacking images
 * or when an image fails to load.
 */
export function getHeroFallbackImage(name: string): string {
  const initials =
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || name.slice(0, 2).toUpperCase();

  // Consistent background color hash from name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ["%23132241", "%231a1f3d", "%23221a33", "%23142a33", "%232a1f1a", "%231f2a1a"];
  const bg = colors[Math.abs(hash) % colors.length];

  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="144" viewBox="0 0 256 144"><rect width="256" height="144" fill="${bg}"/><text x="128" y="86" font-family="'Chakra Petch',system-ui,sans-serif" font-size="44" font-weight="700" fill="%238190b0" text-anchor="middle">${encodeURIComponent(initials)}</text></svg>`;
}
