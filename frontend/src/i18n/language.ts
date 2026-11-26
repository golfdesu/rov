import { createContext, useContext } from "react";

export type Language = "th" | "en";
type Value = string | number;
export type Translate = (message: string, ...values: Value[]) => string;
export type Message = string | [message: string, ...values: Value[]];

let cachedEnglishMessages: Readonly<Record<string, string>> | null = null;
let inflightEnglishPromise: Promise<Readonly<Record<string, string>>> | null = null;

export function getCachedEnglishMessages(): Readonly<Record<string, string>> | null {
  return cachedEnglishMessages;
}

export async function loadEnglishMessages(): Promise<Readonly<Record<string, string>>> {
  if (cachedEnglishMessages) return cachedEnglishMessages;
  if (inflightEnglishPromise) return inflightEnglishPromise;
  inflightEnglishPromise = import("./englishMessages")
    .then((mod) => {
      cachedEnglishMessages = mod.englishMessages;
      return mod.englishMessages;
    })
    .finally(() => {
      inflightEnglishPromise = null;
    });
  return inflightEnglishPromise;
}

export function translateMessage(t: Translate, message: Message): string {
  return typeof message === "string" ? t(message) : t(...message);
}

export const languageStorageKey = "minidraft_language";
export const languageSwitchEnabled = true;

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

export function createTranslator(
  language: Language,
  messages: Readonly<Record<string, string>> | null = cachedEnglishMessages,
): Translate {
  return (message, ...values) => {
    const text =
      languageSwitchEnabled && language === "en" && messages && Object.hasOwn(messages, message)
        ? messages[message]
        : message;
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
