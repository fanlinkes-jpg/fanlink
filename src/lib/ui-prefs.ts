import { useSyncExternalStore } from "react";
import { TRANSLATE_LANGUAGES, isTranslateLanguage, type TranslateLanguage } from "./translator.ts";

/** Idioma al que se traduce lo del fan. Por defecto español. */
export const COMPOSER_LANGUAGES = TRANSLATE_LANGUAGES;

export type ComposerLanguage = TranslateLanguage;

/** Cómo se enseña la traducción automática: bajo el original o en su lugar. */
export type TranslateMode = "below" | "replace";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const listeners = new Set<() => void>();

let userId = "local";
let language: ComposerLanguage = "es";
let sfw = false;
let autoTranslate = false;
let translateMode: TranslateMode = "below";
let hydrated = false;

function languageKey(id: string): string {
  return `fanlink.ui.${id}.language`;
}

function sfwKey(id: string): string {
  return `fanlink.ui.${id}.sfw`;
}

function translateAutoKey(id: string): string {
  return `fanlink.ui.${id}.translate.auto`;
}

function translateModeKey(id: string): string {
  return `fanlink.ui.${id}.translate.mode`;
}

export function readComposerLanguage(storage: StorageLike | null, id: string): ComposerLanguage {
  const raw = storage?.getItem(languageKey(id)) ?? null;
  return isTranslateLanguage(raw) ? raw : "es";
}

export function readTranslateAuto(storage: StorageLike | null, id: string): boolean {
  return storage?.getItem(translateAutoKey(id)) === "1";
}

export function readTranslateMode(storage: StorageLike | null, id: string): TranslateMode {
  return storage?.getItem(translateModeKey(id)) === "replace" ? "replace" : "below";
}

export function writeTranslateAuto(storage: StorageLike | null, id: string, next: boolean): void {
  storage?.setItem(translateAutoKey(id), next ? "1" : "0");
}

export function writeTranslateMode(storage: StorageLike | null, id: string, next: TranslateMode): void {
  storage?.setItem(translateModeKey(id), next);
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
  autoTranslate = readTranslateAuto(storage, userId);
  translateMode = readTranslateMode(storage, userId);
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
  if (!isTranslateLanguage(next)) return;
  language = next;
  writeComposerLanguage(browserStorage(), userId, next);
  emit();
}

export function autoTranslateEnabled(): boolean {
  hydrate();
  return autoTranslate;
}

export function setAutoTranslate(next: boolean): void {
  hydrate();
  autoTranslate = next;
  writeTranslateAuto(browserStorage(), userId, next);
  emit();
}

export function currentTranslateMode(): TranslateMode {
  hydrate();
  return translateMode;
}

export function setTranslateMode(next: TranslateMode): void {
  hydrate();
  translateMode = next === "replace" ? "replace" : "below";
  writeTranslateMode(browserStorage(), userId, translateMode);
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

export function useAutoTranslate(): boolean {
  return useSyncExternalStore(subscribe, autoTranslateEnabled, () => false);
}

export function useTranslateMode(): TranslateMode {
  return useSyncExternalStore(subscribe, currentTranslateMode, () => "below" as TranslateMode);
}

export function useSfw(): boolean {
  return useSyncExternalStore(subscribe, sfwEnabled, () => false);
}
