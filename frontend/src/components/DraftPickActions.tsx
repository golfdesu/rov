import { ArrowLeftRight, MapPin, X } from "lucide-react";
import { useId } from "react";
import { useLanguage } from "../i18n/language";
import type { Hero } from "../types/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";
import { Modal } from "./Modal";
import { StableButtonLabel } from "./StableButtonLabel";

interface DraftPickActionsProps {
  heroName: string;
  hero?: Hero;
  pickNumber: number;
  onChoose: (action: "hero" | "lane") => void;
  onClose: () => void;
}

export function DraftPickActions({ heroName, hero, pickNumber, onChoose, onClose }: DraftPickActionsProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const actionClass = "flex min-h-11 w-full items-center gap-3 border border-line bg-bg px-3 text-left text-sm font-bold text-ink hover:border-gold/60 hover:text-gold";

  return (
    <Modal labelledBy={titleId} className="sm:max-w-sm" mobileSheet onClose={onClose}>
      {(requestClose) => (
        <>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="size-11 shrink-0 overflow-hidden rounded">
              <HeroPortrait name={heroName} hero={hero} />
            </div>
            <h2 id={titleId} className="min-w-0 flex-1 font-display text-sm font-bold text-ink">
              {t("แก้ Pick {0} ({1})", pickNumber, displayName(heroName))}
            </h2>
            <button
              type="button"
              aria-label={t("ปิด")}
              onClick={() => requestClose()}
              className="grid size-9 shrink-0 place-items-center text-muted hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="grid gap-2 p-4">
            <button type="button" onClick={() => requestClose(() => onChoose("hero"))} className={actionClass}>
              <ArrowLeftRight className="size-4 shrink-0 text-gold" />
              <StableButtonLabel message="เปลี่ยนฮีโร่" />
            </button>
            <button type="button" onClick={() => requestClose(() => onChoose("lane"))} className={actionClass}>
              <MapPin className="size-4 shrink-0 text-gold" />
              <StableButtonLabel message="เปลี่ยนเลน" />
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
