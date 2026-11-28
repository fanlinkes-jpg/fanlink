import assert from "node:assert/strict";
import test from "node:test";
import {
  TRANSLATE_LANGUAGES,
  TranslateError,
  baseLanguage,
  detectLanguage,
  downloadDetector,
  downloadPair,
  downloadWaiting,
  warmUpInGesture,
  fanLanguageOf,
  languageLabel,
  pairAvailability,
  prepareTranslator,
  resetTranslatorCaches,
  resolveSource,
  translateMany,
  translateNotice,
  translateText,
  translatorSupported,
  type TranslatorHost,
} from "./translator.ts";

type Calls = { create: string[]; translate: string[]; detect: string[]; creates: number };

/** Host falso con la forma de las APIs de Chrome. `packs` dice qué pares ya están descargados. */
function fakeHost(options: {
  packs?: string[];
  downloadable?: string[];
  unavailable?: string[];
  gesture?: boolean;
  detector?: "available" | "downloadable" | "none";
  detect?: (text: string) => Array<{ detectedLanguage: string; confidence: number }>;
  failCreate?: string;
} = {}): { host: TranslatorHost; calls: Calls; packs: Set<string> } {
  const packs = new Set(options.packs ?? []);
  const calls: Calls = { create: [], translate: [], detect: [], creates: 0 };
  let detectorReady = options.detector === "available";
  const host: TranslatorHost = {
    navigator: { userActivation: { isActive: options.gesture ?? false } },
    Translator: {
      availability: async ({ sourceLanguage, targetLanguage }) => {
        const key = `${sourceLanguage}>${targetLanguage}`;
        if (options.unavailable?.includes(key)) return "unavailable";
        if (packs.has(key)) return "available";
        return "downloadable";
      },
      create: async ({ sourceLanguage, targetLanguage, monitor }) => {
        const key = `${sourceLanguage}>${targetLanguage}`;
        calls.creates += 1;
        calls.create.push(key);
        if (options.failCreate) {
          const error = new Error("boom");
          error.name = options.failCreate;
          throw error;
        }
        if (!packs.has(key)) {
          const listeners: Array<(event: { loaded: number }) => void> = [];
          monitor?.({ addEventListener: (_type, listener) => { listeners.push(listener); } });
          for (const loaded of [0.25, 0.75, 1]) for (const listener of listeners) listener({ loaded });
          packs.add(key);
        }
        return { translate: async (text: string) => { calls.translate.push(`${key}:${text}`); return `[${targetLanguage}] ${text}`; } };
      },
    },
    LanguageDetector: options.detector === "none" ? undefined : {
      availability: async () => (detectorReady ? "available" : "downloadable"),
      create: async () => {
        detectorReady = true;
        return {
          detect: async (text: string) => {
            calls.detect.push(text);
            return (options.detect ?? (() => [{ detectedLanguage: "en", confidence: 0.95 }]))(text);
          },
        };
      },
    },
  };
  return { host, calls, packs };
}

test("sin Translator el navegador no es compatible y el aviso lo dice claro", async () => {
  resetTranslatorCaches();
  const host: TranslatorHost = {};
  assert.equal(translatorSupported(host), false);
  assert.equal(await pairAvailability(host, "en", "es"), "unsupported");
  await assert.rejects(() => translateText(host, "hello", { source: "en", target: "es" }), (error: unknown) => error instanceof TranslateError && error.code === "unsupported");
  assert.match(translateNotice("unsupported"), /no está disponible/);
  assert.doesNotMatch(translateNotice("unsupported"), /Chrome|gratis/i);
  assert.doesNotMatch(translateNotice("unsupported"), /Sin datos/);
});

test("un paquete por descargar no se baja sin gesto del usuario: la descarga espera al siguiente clic", async () => {
  resetTranslatorCaches();
  const { host, calls } = fakeHost({ gesture: false });
  await assert.rejects(() => prepareTranslator(host, "en", "es"), (error: unknown) => error instanceof TranslateError && error.code === "needs-download" && error.source === "en" && error.target === "es");
  assert.equal(calls.creates, 0);
  assert.equal(translateNotice("needs-download", "en", "es"), "", "sin texto de descarga");
  assert.equal(downloadWaiting(), true);
});

test("con un clic baja el paquete, informa del progreso y luego traduce sin gesto", async () => {
  resetTranslatorCaches();
  const { host, calls } = fakeHost({ gesture: false });
  const progress: number[] = [];
  await downloadPair(host, "en", "es", (fraction) => progress.push(fraction));
  assert.deepEqual(progress, [0.25, 0.75, 1]);
  assert.equal(await pairAvailability(host, "en", "es"), "available");
  const done = await translateText(host, "Hello there", { source: "en", target: "es" });
  assert.equal(done.text, "[es] Hello there");
  assert.equal(done.same, false);
  assert.deepEqual(calls.create, ["en>es"]);
});

test("si el gesto está activo, traducir también baja el paquete", async () => {
  resetTranslatorCaches();
  const { host, calls } = fakeHost({ gesture: true });
  const done = await translateText(host, "Buenos días", { source: "es", target: "pt" });
  assert.equal(done.text, "[pt] Buenos días");
  assert.deepEqual(calls.create, ["es>pt"]);
});

test("el mismo idioma no llama al traductor y los códigos regionales se normalizan", async () => {
  resetTranslatorCaches();
  const { host, calls } = fakeHost({ packs: ["pt>es"] });
  assert.equal(baseLanguage("pt-BR"), "pt");
  const same = await translateText(host, "Hola", { source: "es-ES", target: "es" });
  assert.equal(same.same, true);
  assert.equal(same.text, "Hola");
  const pt = await translateText(host, "Olá", { source: "pt-BR", target: "es" });
  assert.equal(pt.text, "[es] Olá");
  assert.equal(calls.create.length, 1);
});

test("el resultado y el traductor se reutilizan: el mismo texto no se traduce dos veces", async () => {
  resetTranslatorCaches();
  const { host, calls } = fakeHost({ packs: ["en>es"] });
  await translateText(host, "How are you?", { source: "en", target: "es" });
  await translateText(host, "How are you?", { source: "en", target: "es" });
  await translateText(host, "See you soon", { source: "en", target: "es" });
  assert.equal(calls.creates, 1);
  assert.equal(calls.translate.length, 2);
});

test("el idioma de origen se detecta con confianza, y si es dudoso o el texto corto vale el del fan", async () => {
  resetTranslatorCaches();
  const confident = fakeHost({ packs: ["de>es"], detector: "available", detect: () => [{ detectedLanguage: "de", confidence: 0.97 }] });
  assert.equal(await resolveSource(confident.host, "Wie geht es dir heute?", null, "en"), "de");
  const doubtful = fakeHost({ detector: "available", detect: () => [{ detectedLanguage: "nl", confidence: 0.2 }] });
  assert.equal(await resolveSource(doubtful.host, "Wie geht es dir heute?", null, "en"), "en");
  const short = fakeHost({ detector: "available" });
  assert.equal(await resolveSource(short.host, "ok", null, "pt"), "pt");
  assert.equal(short.calls.detect.length, 0);
  assert.equal(await resolveSource(short.host, "ok", "de", "pt"), "de");
  const none = fakeHost({ detector: "none" });
  await assert.rejects(() => resolveSource(none.host, "Wie geht es dir heute?", null, null), (error: unknown) => error instanceof TranslateError && error.code === "detect-failed");
});

test("el detector sin descargar pide un gesto, y downloadDetector lo deja listo con un clic", async () => {
  resetTranslatorCaches();
  const { host } = fakeHost({ detector: "downloadable", gesture: false });
  await assert.rejects(() => detectLanguage(host, "Hello my friend"), (error: unknown) => error instanceof TranslateError && error.code === "needs-download");
  assert.equal(await downloadDetector(host), true);
  assert.deepEqual(await detectLanguage(host, "Hello my friend"), { language: "en", confidence: 0.95 });
});

test("un par que Chrome no ofrece da un aviso propio, y un fallo de creación no deja el traductor cacheado", async () => {
  resetTranslatorCaches();
  const { host } = fakeHost({ unavailable: ["de>pt"] });
  await assert.rejects(() => translateText(host, "Hallo", { source: "de", target: "pt" }), (error: unknown) => error instanceof TranslateError && error.code === "pair-unavailable");
  assert.match(translateNotice("pair-unavailable", "de", "pt"), /DE a PT/);
  const failing = fakeHost({ packs: ["en>es"], failCreate: "SomeError" });
  await assert.rejects(() => prepareTranslator(failing.host, "en", "es"), (error: unknown) => error instanceof TranslateError && error.code === "failed");
  await assert.rejects(() => prepareTranslator(failing.host, "en", "es"), (error: unknown) => error instanceof TranslateError);
  assert.equal(failing.calls.creates, 2);
  const denied = fakeHost({ gesture: true, failCreate: "NotAllowedError" });
  await assert.rejects(() => prepareTranslator(denied.host, "en", "es"), (error: unknown) => error instanceof TranslateError && error.code === "needs-download");
});

test("varios párrafos salen en orden con un solo origen, y vacíos no se traducen", async () => {
  resetTranslatorCaches();
  const { host, calls } = fakeHost({ packs: ["en>es"] });
  const done = await translateMany(host, ["Title", "First paragraph", "", "Last one"], { source: "en", target: "es" });
  assert.deepEqual(done.texts, ["[es] Title", "[es] First paragraph", "", "[es] Last one"]);
  assert.equal(done.same, false);
  assert.equal(calls.translate.length, 3);
});

test("el idioma del fan sale de sus mensajes y vale cualquier idioma de la lista", async () => {
  resetTranslatorCaches();
  const lines: Record<string, string> = { hello: "en", hola: "es", ciao: "it", "good morning my dear": "en", "buenos días mi amor": "es" };
  const { host } = fakeHost({
    detector: "available",
    detect: (text) => [{ detectedLanguage: lines[text] ?? "en", confidence: 0.9 }],
  });
  assert.equal(await fanLanguageOf(host, ["good morning my dear", "buenos días mi amor", "good morning my dear"]), "en");
  assert.equal(await fanLanguageOf(host, ["ciao"]), "it");
  const unknown = fakeHost({ detector: "available", detect: () => [{ detectedLanguage: "xx", confidence: 0.9 }] });
  assert.equal(await fanLanguageOf(unknown.host, ["???"]), null);
  assert.equal(await fanLanguageOf(host, []), null);
  const doubtful = fakeHost({ detector: "available", detect: () => [{ detectedLanguage: "en", confidence: 0.3 }] });
  assert.equal(await fanLanguageOf(doubtful.host, ["hello there friend"]), null);
});

test("traducir lo que escribe el chatter: del suyo al idioma del fan, sin enviar nada", async () => {
  resetTranslatorCaches();
  const { host, calls } = fakeHost({ gesture: true, detector: "available", detect: () => [{ detectedLanguage: "es", confidence: 0.99 }] });
  const out = await translateText(host, "Hola cariño, ¿cómo estás?", { source: null, fallbackSource: "es", target: "en", gesture: true });
  assert.equal(out.source, "es");
  assert.equal(out.target, "en");
  assert.equal(out.text, "[en] Hola cariño, ¿cómo estás?");
  assert.deepEqual(calls.create, ["es>en"]);
});

test("la lista de idiomas es amplia, empieza por español y normaliza códigos", () => {
  assert.equal(TRANSLATE_LANGUAGES[0]?.id, "es");
  assert.ok(TRANSLATE_LANGUAGES.length >= 30);
  assert.equal(new Set(TRANSLATE_LANGUAGES.map((item) => item.id)).size, TRANSLATE_LANGUAGES.length);
  assert.equal(languageLabel("fr"), "Francés");
  assert.equal(languageLabel("pt-BR"), "Portugués");
  assert.equal(baseLanguage("iw"), "he");
  assert.equal(baseLanguage("zh-TW"), "zh-Hant");
  assert.equal(baseLanguage("zh-Hans-CN"), "zh");
  assert.equal(baseLanguage("pt_BR"), "pt");
});

test("con gesto, create se llama de forma síncrona, antes de cualquier await", () => {
  resetTranslatorCaches();
  const { host, calls } = fakeHost({ gesture: true, detector: "downloadable" });
  const pending = prepareTranslator(host, "en", "es");
  assert.equal(calls.creates, 1, "create ya se ha llamado sin esperar nada");
  void pending.catch(() => undefined);
  const detecting = detectLanguage(host, "Hello my friend");
  void detecting.catch(() => undefined);
});

test("sin gesto el par queda esperando, y el primer gesto lo crea en el acto, con el detector", async () => {
  resetTranslatorCaches();
  const gestureHost = fakeHost({ gesture: false, detector: "downloadable" });
  await assert.rejects(() => translateText(gestureHost.host, "Hello my friend", { source: null, target: "es" }), (error: unknown) => error instanceof TranslateError && error.code === "needs-download");
  assert.equal(gestureHost.calls.creates, 0);
  assert.equal(downloadWaiting(), true);
  (gestureHost.host.navigator as { userActivation: { isActive: boolean } }).userActivation.isActive = true;
  assert.equal(warmUpInGesture(gestureHost.host), true);
  assert.equal(downloadWaiting(), false);
  assert.equal(warmUpInGesture(gestureHost.host), false, "una sola vez");
  const done = await translateText(gestureHost.host, "Hello my friend", { source: null, target: "es" });
  assert.equal(done.text, "[es] Hello my friend");
});
