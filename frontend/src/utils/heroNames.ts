/**
 * Thai server display names for heroes whose canonical (global) name differs.
 * Canonical names are still used for API calls, data and the model.
 */
const TH_DISPLAY_NAMES: Record<string, string> = {
  Arthur: "Mortos",
  Brunhilda: "Celica",
  Richter: "Riktor",
};

export function displayName(name: string): string {
  return TH_DISPLAY_NAMES[name] ?? name;
}

/** True if the search query matches either the Thai display name or the canonical name. */
export function matchesHeroQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query) || displayName(name).toLowerCase().includes(query);
}
