import { BookOpen, Bot, Crown, Layers, ShieldAlert, Sparkles, Trophy, Users, X } from "lucide-react";
import { useId, useState } from "react";
import { useLanguage } from "../i18n/language";
import { Modal } from "./Modal";
import { StableButtonLabel } from "./StableButtonLabel";

type GuideTabKey = "draft" | "ai" | "scrim" | "tips";

interface GuideCardItem {
  title: string;
  body: string;
  highlight?: boolean;
}

const GUIDE_TABS: { key: GuideTabKey; label: string; icon: typeof Layers }[] = [
  { key: "draft", label: "บอร์ดดราฟต์ & ซีรีส์", icon: Layers },
  { key: "ai", label: "ผู้ช่วย AI & ฝึกดราฟต์", icon: Bot },
  { key: "scrim", label: "สถิติ, Pool & ทีม", icon: Trophy },
  { key: "tips", label: "ระดับบัญชี & สิทธิ์", icon: Crown },
];

const GUIDE_SECTIONS: Record<"draft" | "ai" | "scrim", GuideCardItem[]> = {
  draft: [
    {
      title: "เริ่มซีรีส์ใหม่ / เจอทีมใหม่",
      body: 'กดปุ่ม "แมตช์ใหม่" มุมขวาบนของบอร์ด เพื่อตั้งชื่อทัวร์นาเมนต์และชื่อทีมใหม่ ระบบจะแยกประวัติและรีเซ็ต Global Ban ให้อัตโนมัติโดยไม่ปนกับแมตช์เดิม',
      highlight: true,
    },
    {
      title: "เปลี่ยนเกมในซีรีส์เดิม (Game 1–7)",
      body: "กดเลขเกม G1–G7 ด้านบนบอร์ด ระบบจะซิงก์ Global Ban จากเกมก่อนหน้าอัตโนมัติ และใน Game 7 Ultimate Battle จะรีเซ็ต Global Ban ทั้งสองฝั่ง",
    },
    {
      title: "สลับฝั่ง Blue / Red",
      body: 'กดปุ่ม "สลับฝั่ง" เพื่อสลับฝั่งทีม ฮีโร่ที่แต่ละทีมเคยใช้จะย้ายฝั่งตามทีมไปอัตโนมัติ หากมีฮีโร่บนบอร์ดแล้วสามารถเลือกสลับเฉพาะชื่อทีมหรือสลับพร้อมฮีโร่ได้',
    },
    {
      title: "บันทึกผลเกม & ดูประวัติ",
      body: 'ดราฟต์ครบ 10 ตัวแล้วกด "บันทึกผลเกม" พร้อมเลือกทีมชนะ เพื่อเก็บลงประวัติและนำไปคำนวณในหน้าสถิติซ้อมทีม',
    },
    {
      title: "ตั้งค่า Global Ban เอง",
      body: 'กดปุ่ม "Global Ban" เพื่อเพิ่มหรือลบฮีโร่ที่ถูกใช้ไปแล้วล่วงหน้า เหมาะสำหรับเริ่มดราฟต์กลางซีรีส์ เช่น เริ่มที่ Game 3',
    },
  ],
  ai: [
    {
      title: "ผู้ช่วย AI บนบอร์ด",
      body: "แนะนำตัว Pick และ Ban พร้อมประเมินโอกาสชนะตามลำดับดราฟต์จริงและ Global Ban สามารถเปิดหรือปิดผู้ช่วย AI ได้จากปุ่มด้านบนบอร์ด",
    },
    {
      title: "ฝึกดราฟต์ vs AI",
      body: 'เข้าแท็บ "ฝึกดราฟต์ vs AI" เพื่อซ้อมดราฟต์แข่งกับบอทได้ตั้งแต่ BO1 ถึง BO7 เลือกฝั่ง Blue หรือ Red และย้อนดูประวัติการซ้อมได้',
    },
    {
      title: "แก้ไขช่องที่เลือกไปแล้ว",
      body: "คลิกที่ช่อง Pick หรือ Ban บนบอร์ดเพื่อเปลี่ยนตัวฮีโร่ได้ทันทีโดยไม่ต้องเริ่มใหม่ทั้งเกม",
    },
  ],
  scrim: [
    {
      title: "สถิติซ้อมทีม",
      body: 'เข้าแท็บ "สถิติซ้อมทีม" เพื่อวิเคราะห์เกมที่บันทึกไว้ครบ 4 หมวด (ภาพรวมและฟอร์ม, ดราฟต์และ Pick/Ban, ตารางฮีโร่และเมต้า, คอมโบและ Matchups) พร้อมส่งออกใบสรุปสเกาต์เป็น PDF ขนาด A4 หากยังไม่มีข้อมูลสามารถกดดูลีกตัวอย่างได้',
    },
    {
      title: "Hero Pools ราย 5 เลน",
      body: 'เปิดเมนูมุมขวาบนแล้วเลือก "Hero Pools" เพื่อบันทึกพูลฮีโร่ของทีมตัวเองหรือคู่แข่ง เมื่อชื่อทีมบนบอร์ดตรงกัน ระบบจะแสดงจุดแจ้งเตือนฮีโร่ใน Pool ให้อัตโนมัติ',
    },
    {
      title: "พื้นที่แชร์ทีม",
      body: 'สำหรับแพ็ก Duo และ Business สามารถชวนโค้ชหรือเพื่อนร่วมทีมด้วยรหัสเชิญในหน้า "โปรไฟล์" เพื่อใช้ประวัติการดราฟต์และ Hero Pools ร่วมกัน',
    },
  ],
};

const ACCOUNT_TIERS: { tier: string; detail: string; accentClass: string }[] = [
  {
    tier: "Guest",
    detail: "บันทึกประวัติในเครื่องนี้ได้สูงสุด 3 เกม",
    accentClass: "border-line-strong text-muted",
  },
  {
    tier: "Free",
    detail: "ซิงก์คลาวด์ได้สูงสุด 14 เกม และสร้าง Hero Pools ได้ 2 ทีม",
    accentClass: "border-line-strong text-ink",
  },
  {
    tier: "Pro / Duo / Business",
    detail: "บันทึกได้สูงสุด 500 เกม, Hero Pools 50 ชุด, ปลดล็อกสถิติซ้อมทีมและส่งออก PDF (Duo/Business เพิ่มพื้นที่แชร์ทีม)",
    accentClass: "border-gold/50 text-gold",
  },
];

interface UserGuideModalProps {
  onClose: () => void;
}

/** Quick-start user guide modal covering series controls, AI assistant, analytics, Hero Pools, shortcuts, and tiers. */
export function UserGuideModal({ onClose }: UserGuideModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const [activeTab, setActiveTab] = useState<GuideTabKey>("draft");

  return (
    <Modal labelledBy={titleId} className="max-w-2xl" mobileSheet onClose={onClose}>
      {(requestClose) => (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <BookOpen className="h-4 w-4 shrink-0 text-gold" />
              <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink sm:text-base">
                {t("คู่มือการใช้งาน")}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => requestClose()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink"
              aria-label={t("ปิด")}
            >
              <X size={18} />
            </button>
          </div>

          <div className="border-b border-line bg-panel-2/40 px-4 py-2.5 sm:px-5">
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" role="tablist" aria-label={t("หมวดคู่มือการใช้งาน")}>
              {GUIDE_TABS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(item.key)}
                    className={`inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 border px-2.5 py-1.5 text-center font-display text-xs font-semibold transition-colors sm:justify-start sm:px-3 ${
                      active
                        ? "border-gold/70 bg-gold/15 text-gold"
                        : "border-line-strong bg-panel text-muted hover:border-gold/40 hover:text-ink"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 leading-tight">{t(item.label)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-h-[72dvh] min-w-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3.5 sm:px-5 sm:py-4">
            {activeTab !== "tips" ? (
              <div className="space-y-2.5">
                {GUIDE_SECTIONS[activeTab].map((item) => (
                  <section
                    key={item.title}
                    className={`border p-3 sm:p-3.5 ${
                      item.highlight
                        ? "border-gold/45 bg-gold/5"
                        : "border-line bg-panel-2/50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {item.highlight ? (
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                      ) : activeTab === "draft" ? (
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-dim" aria-hidden="true" />
                      ) : activeTab === "ai" ? (
                        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-dim" aria-hidden="true" />
                      ) : (
                        <Users className="mt-0.5 h-4 w-4 shrink-0 text-dim" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 className={`font-display text-xs font-bold sm:text-sm ${item.highlight ? "text-gold" : "text-ink"}`}>
                          {t(item.title)}
                        </h3>
                        <p className="text-xs leading-relaxed text-muted sm:text-[13px]">
                          {t(item.body)}
                        </p>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <section className="border border-line bg-panel-2/50 p-3 sm:p-3.5">
                <h3 className="mb-2.5 font-display text-xs font-bold text-ink sm:text-sm">
                  {t("สิทธิ์การใช้งานแต่ละระดับ")}
                </h3>
                <div className="space-y-2">
                  {ACCOUNT_TIERS.map((row) => (
                    <div key={row.tier} className="border border-line bg-bg/60 p-2.5">
                      <span className={`inline-block border px-1.5 py-0.5 font-mono text-[11px] font-bold ${row.accentClass}`}>
                        {row.tier}
                      </span>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted sm:text-[13px]">
                        {t(row.detail)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end border-t border-line bg-panel-2/40 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={() => requestClose()}
              className="min-h-9 border border-gold bg-gold px-4 py-1.5 font-display text-xs font-bold text-bg transition-colors hover:bg-gold/90"
            >
              <StableButtonLabel message="เข้าใจแล้ว" />
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
