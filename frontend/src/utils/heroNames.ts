/**
 * Thai server names (Mortos, Celica, Riktor) are now the canonical default across the system.
 * Legacy Global/Liquipedia aliases map to Thai server names if ever encountered.
 */
const TH_DISPLAY_NAMES: Record<string, string> = {
  Arthur: "Mortos",
  Brunhilda: "Celica",
  Richter: "Riktor",
};

const GLOBAL_ALIASES: Record<string, string> = {
  Mortos: "Arthur",
  Celica: "Brunhilda",
  Riktor: "Richter",
};

export function displayName(name: string): string {
  return TH_DISPLAY_NAMES[name] ?? name;
}

/** True if the search query matches either the Thai server name or legacy global alias. */
export function matchesHeroQuery(name: string, query: string): boolean {
  const alias = GLOBAL_ALIASES[name] ?? TH_DISPLAY_NAMES[name] ?? "";
  return (
    name.toLowerCase().includes(query) ||
    displayName(name).toLowerCase().includes(query) ||
    alias.toLowerCase().includes(query)
  );
}
