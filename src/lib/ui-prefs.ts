import { useSyncExternalStore } from "react";

export const COMPOSER_LANGUAGES = [
  { id: "es", label: "Español" },
  { id: "en", label: "Inglés" },
] as const;

export type ComposerLanguage = (typeof COMPOSER_LANGUAGES)[number]["id"];

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const listeners = new Set<() => void>();

let userId = "local";
let language: ComposerLanguage = "es";
let sfw = false;
let hydrated = false;

function languageKey(id: string): string {
  return `fanlink.ui.${id}.language`;
}

function sfwKey(id: string): string {
  return `fanlink.ui.${id}.sfw`;
}

export function readComposerLanguage(storage: StorageLike | null, id: string): ComposerLanguage {
  const raw = storage?.getItem(languageKey(id)) ?? null;
  return raw === "en" ? "en" : "es";
}

export function readSfw(storage: StorageLike | null, id: string): boolean {
  return storage?.getItem(sfwKey(id)) === "1";
}

export function writeComposerLanguage(storage: StorageLike | null, id: string, next: ComposerLanguage): void {
  storage?.setItem(languageKey(id), next);
}

export function writeSfw(storage: StorageLike | null, id: string, next: boolean): void {
  storage?.setItem(sfwKey(id), next ? "1" : "0");
}

/** Difumina solo mientras SFW está activo y ese medio no se ha destapado. */
export function mediaBlurred(enabled: boolean, revealed: boolean): boolean {
  return enabled && !revealed;
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const storage = browserStorage();
  language = readComposerLanguage(storage, userId);
  sfw = readSfw(storage, userId);
  paintSfw();
}

function paintSfw(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.sfw = sfw ? "1" : "0";
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function bindUiUser(id: string | null): void {
  const next = id?.trim() || "local";
  if (next === userId && hydrated) return;
  userId = next;
  hydrated = false;
  hydrate();
  emit();
}

export function composerLanguage(): ComposerLanguage {
  hydrate();
  return language;
}

export function setComposerLanguage(next: ComposerLanguage): void {
  hydrate();
  if (next !== "es" && next !== "en") return;
  language = next;
  writeComposerLanguage(browserStorage(), userId, next);
  emit();
}

export function sfwEnabled(): boolean {
  hydrate();
  return sfw;
}

export function setSfwEnabled(next: boolean): void {
  hydrate();
  sfw = next;
  writeSfw(browserStorage(), userId, next);
  paintSfw();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useComposerLanguage(): ComposerLanguage {
  return useSyncExternalStore(subscribe, composerLanguage, () => "es" as ComposerLanguage);
}

export function useSfw(): boolean {
  return useSyncExternalStore(subscribe, sfwEnabled, () => false);
}
