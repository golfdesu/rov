/** Badge for skills tied to a hero form (Yena blades, Liliana human/fox, Edras stance). */
export function getFormBadge(hero: string, slot: string): { label: string; style: string } | null {
  if (hero === "Yena") {
    if (["Skill 1", "Skill 2", "Ultimate"].includes(slot)) {
      return { label: "ดาบคู่", style: "border-[#48dbfb]/40 bg-[#48dbfb]/10 text-[#48dbfb]" };
    }
    if (["Skill 3", "Skill 4", "Skill 5"].includes(slot)) {
      return { label: "รวมดาบ", style: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]" };
    }
    if (slot === "Passive 2") {
      return { label: "รวมดาบ", style: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]" };
    }
  }
  if (hero === "Liliana") {
    if (["Skill 1", "Skill 2"].includes(slot)) {
      return { label: "มนุษย์", style: "border-[#48dbfb]/40 bg-[#48dbfb]/10 text-[#48dbfb]" };
    }
    if (["Skill 4", "Skill 5"].includes(slot)) {
      return { label: "จิ้งจอก", style: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]" };
    }
    if (slot === "Ultimate" || slot === "Skill 3") {
      return { label: "สลับร่าง", style: "border-gold/40 bg-gold/10 text-gold" };
    }
  }
  if (hero === "Edras") {
    if (slot.includes("Berserker")) {
      return { label: "Berserker", style: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]" };
    }
    return { label: "Demolisher", style: "border-[#48dbfb]/40 bg-[#48dbfb]/10 text-[#48dbfb]" };
  }
  return null;
}
