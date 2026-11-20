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

const TH_SEARCH_ALIASES: Record<string, readonly string[]> = {
  Mortos: ["มอร์ตอส", "อาร์เธอร์", "อาเธอร์"],
  Riktor: ["ริคเตอร์", "ริกเตอร์"],
  Celica: ["เซลิก้า", "บรูนฮิลด้า"],
  Florentino: ["ฟลอเรนติโน", "ฟลอเรนติโน่", "ฟลอเรน"],
  Nakroth: ["นาครอท"],
  Krixi: ["คริกซี่"],
  Tulen: ["ทูเลน"],
  Hayate: ["ฮายาเตะ"],
  Violet: ["ไวโอเล็ต", "ไวโอ"],
  Valhein: ["แวน", "แวลไฮน์"],
  Thane: ["เทน"],
  Kaine: ["เคน", "แบทแมน"],
  Stuart: ["สจ๊วต", "โจ๊กเกอร์"],
  Helen: ["เฮเลน", "เพย์น่า"],
};

export function displayName(name: string): string {
  return TH_DISPLAY_NAMES[name] ?? name;
}

/** True if the search query matches the Thai server name, legacy global alias, or Thai search alias. */
export function matchesHeroQuery(name: string, query: string): boolean {
  const canonical = displayName(name);
  const alias = GLOBAL_ALIASES[name] ?? TH_DISPLAY_NAMES[name] ?? "";
  const thAliases = TH_SEARCH_ALIASES[canonical] ?? TH_SEARCH_ALIASES[name];
  return (
    name.toLowerCase().includes(query) ||
    canonical.toLowerCase().includes(query) ||
    alias.toLowerCase().includes(query) ||
    Boolean(thAliases?.some((th) => th.includes(query)))
  );
}
