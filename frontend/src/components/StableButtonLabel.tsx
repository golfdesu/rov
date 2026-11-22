import { createTranslator, type Language, type Message, type Translate, translateMessage, useLanguage } from "../i18n/language";

const translateToThai = createTranslator("th");
const translateToEnglish = createTranslator("en");

interface StableButtonLabelProps {
  message: Message;
  alternatives?: readonly Message[];
  suffixes?: readonly Message[];
  className?: string;
}

function formatLabel(translate: Translate, message: Message, suffixes: readonly Message[]): string {
  return translateMessage(translate, message) + suffixes.map((part) => translateMessage(translate, part)).join("");
}

/** Keeps the button the same size for each translation and listed state. */
export function StableButtonLabel({ message, alternatives = [], suffixes = [], className = "inline-grid" }: StableButtonLabelProps) {
  const { t } = useLanguage();
  const label = formatLabel(t, message, suffixes);
  const variants = new Map<string, Language | undefined>();
  for (const variant of [message, ...alternatives]) {
    const thai = formatLabel(translateToThai, variant, suffixes);
    const english = formatLabel(translateToEnglish, variant, suffixes);
    variants.set(thai, thai === english ? undefined : "th");
    if (thai !== english) variants.set(english, "en");
  }

  return (
    <span className={`min-w-0 max-w-full ${className}`}>
      {[...variants].map(([variant, language]) => (
        <span
          key={variant}
          lang={language}
          aria-hidden={variant !== label}
          className={`col-start-1 row-start-1 self-center ${variant === label ? "" : "invisible"}`}
        >
          {variant}
        </span>
      ))}
    </span>
  );
}
