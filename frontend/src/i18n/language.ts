import { createContext, useContext } from "react";
import { englishMessages } from "./englishMessages";

export type Language = "th" | "en";
type Value = string | number;
export type Translate = (message: string, ...values: Value[]) => string;
export type Message = string | [message: string, ...values: Value[]];

export function translateMessage(t: Translate, message: Message): string {
  return typeof message === "string" ? t(message) : t(...message);
}

export const languageStorageKey = "minidraft_language";
export const languageSwitchEnabled = import.meta.env.VITE_DRAFT_ONLY !== "true";

export function readLanguage(): Language {
  try {
    return languageSwitchEnabled && window.localStorage.getItem(languageStorageKey) === "en" ? "en" : "th";
  } catch {
    return "th";
  }
}

const formatMessage: Translate = (message, ...values) =>
  message.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? placeholder : String(value);
  });

export function createTranslator(language: Language): Translate {
  return (message, ...values) => {
    const text = languageSwitchEnabled && language === "en" && Object.hasOwn(englishMessages, message) ? englishMessages[message] : message;
    return values.length ? formatMessage(text, ...values) : text;
  };
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

export const LanguageContext = createContext<LanguageContextValue>({
  language: "th",
  setLanguage: () => {},
  t: formatMessage,
});

export function useLanguage() {
  return useContext(LanguageContext);
}
