/** Display styling for each enchantment faction, keyed by the catalog faction name. */
export const FACTION_INFO: Record<
  string,
  { nameTh: string; color: string; border: string; bg: string; activeBg: string; ring: string }
> = {
  Veda: {
    nameTh: "เวด้า (แครี่, เมจ)",
    color: "text-[#f1c40f]",
    border: "border-[#f1c40f]",
    bg: "bg-[#f1c40f]/10",
    activeBg: "bg-[#f1c40f]/20",
    ring: "ring-[#f1c40f]",
  },
  Lokheim: {
    nameTh: "ล็อคไฮม์ (ไฟต์เตอร์, แอสซาซิน)",
    color: "text-[#e74c3c]",
    border: "border-[#e74c3c]",
    bg: "bg-[#e74c3c]/10",
    activeBg: "bg-[#e74c3c]/20",
    ring: "ring-[#e74c3c]",
  },
  Afata: {
    nameTh: "อัฟฟาต้า (แทงค์, ซัพพอร์ต)",
    color: "text-[#2ecc71]",
    border: "border-[#2ecc71]",
    bg: "bg-[#2ecc71]/10",
    activeBg: "bg-[#2ecc71]/20",
    ring: "ring-[#2ecc71]",
  },
  "Origin Alliance": {
    nameTh: "พันธมิตรแห่งกำเนิด (อเนกประสงค์)",
    color: "text-[#3498db]",
    border: "border-[#3498db]",
    bg: "bg-[#3498db]/10",
    activeBg: "bg-[#3498db]/20",
    ring: "ring-[#3498db]",
  },
};

export const ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III" };
