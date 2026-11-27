import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createTranslator,
  getCachedEnglishMessages,
  type Language,
  LanguageContext,
  languageStorageKey,
  languageSwitchEnabled,
  loadEnglishMessages,
  readLanguage,
  useLanguage,
} from "./language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [enMessages, setEnMessages] = useState<Readonly<Record<string, string>> | null>(
    () => (readLanguage() === "en" ? getCachedEnglishMessages() : null),
  );

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "en"
      ? "MiniDraft — RoV Draft Simulator and AI Picks & Bans"
      : "MiniDraft — โปรแกรมจำลองดราฟต์ RoV & AI แนะนำ Pick/Ban";

    if (languageSwitchEnabled) {
      try {
        window.localStorage.setItem(languageStorageKey, language);
      } catch {
        // The selected language still applies until this page closes.
      }
    }
  }, [language]);

  useEffect(() => {
    if (!languageSwitchEnabled || language !== "en" || enMessages !== null) return;
    let cancelled = false;
    void loadEnglishMessages()
      .then((dict) => {
        if (!cancelled) setEnMessages(dict);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [language, enMessages]);

  const locale = useMemo(
    () => ({ language, setLanguage, t: createTranslator(language, enMessages) }),
    [language, enMessages],
  );

  return <LanguageContext.Provider value={locale}>{children}</LanguageContext.Provider>;
}

export function LanguageSwitch({ className = "inline-flex" }: { className?: string }) {
  const { language, setLanguage } = useLanguage();
  if (!languageSwitchEnabled) return null;

  return (
    <div
      role="group"
      aria-label={language === "en" ? "Language" : "ภาษา"}
      className={`relative shrink-0 self-start border border-line bg-bg ${className}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-1/2 border border-line-strong bg-panel-2 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none ${
          language === "en" ? "translate-x-full" : "translate-x-0"
        }`}
      />
      {(["th", "en"] as const).map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-label={option === "th" ? "ภาษาไทย" : "English"}
          aria-pressed={language === option}
          onClick={() => setLanguage(option)}
          className={`relative min-h-8 w-10 text-xs font-semibold focus-visible:z-10 focus-visible:outline focus-visible:outline-gold ${
            language === option ? "text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {option === "th" ? "ไทย" : "EN"}
        </button>
      ))}
    </div>
  );
}
