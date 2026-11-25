/**
 * Which AI engine the library uses for generated text (the assistant's
 * synthesis and on-request translation).
 *
 * The default is a model running on this machine through Ollama. A cloud
 * provider is used only when someone at this machine chooses one and gives
 * it a key; passages are then sent to that provider, and every generated
 * answer says so. Environment variables (UWL_AI_*) override the saved file,
 * for servers configured by an operator.
 *
 * The key is kept in a file readable only by this user (mode 0600) in the
 * library folder. It is never sent back to a browser: the settings call
 * returns whether a key is set and its last four characters.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./db";

export type CloudPreset = { label: string; baseUrl: string; model: string; keyHint: string; docs: string };

export const CLOUD_PRESETS: Record<string, CloudPreset> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyHint: "sk-…", docs: "https://platform.openai.com/api-keys" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", keyHint: "sk-or-…", docs: "https://openrouter.ai/keys" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyHint: "gsk_…", docs: "https://console.groq.com/keys" },
  custom: { label: "Another OpenAI-compatible service", baseUrl: "", model: "", keyHint: "API key", docs: "" },
};

export type AiSettings = {
  provider: "local" | "cloud";
  preset: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

const DEFAULTS: AiSettings = { provider: "local", preset: "openai", baseUrl: "", model: "", apiKey: "" };

export function settingsFile(): string {
  return process.env.UWL_AI_SETTINGS_FILE || join(ROOT, "data", "ai-settings.json");
}

function cleanUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    // Plain http only to this machine: a key must not cross a network unencrypted.
    if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function cleanModel(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return name.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._:\/@-]*$/.test(name) ? name : "";
}

function cleanKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const key = value.trim();
  return key.length <= 400 && /^[\x21-\x7e]+$/.test(key) ? key : "";
}

function readFile(): Partial<AiSettings> {
  try {
    const file = settingsFile();
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) ?? {};
  } catch {
    return {};
  }
}

/** The settings in force: the saved file, with any UWL_AI_* variables on top. */
export function aiSettings(env: Record<string, string | undefined> = process.env): AiSettings {
  const saved = readFile();
  const preset = String(env.UWL_AI_PRESET ?? saved.preset ?? DEFAULTS.preset);
  const p = CLOUD_PRESETS[preset] ?? CLOUD_PRESETS.custom;
  const provider = (env.UWL_AI_PROVIDER ?? saved.provider) === "cloud" ? "cloud" : "local";
  return {
    provider,
    preset: CLOUD_PRESETS[preset] ? preset : "custom",
    baseUrl: cleanUrl(env.UWL_AI_BASE_URL ?? saved.baseUrl) || p.baseUrl,
    model: cleanModel(env.UWL_AI_MODEL ?? saved.model) || p.model,
    apiKey: cleanKey(env.UWL_AI_API_KEY ?? saved.apiKey),
  };
}

/** What a browser may see: never the key itself. */
export function publicSettings(s: AiSettings = aiSettings()) {
  const preset = CLOUD_PRESETS[s.preset];
  return {
    provider: s.provider,
    preset: s.preset,
    providerLabel: s.provider === "cloud" ? (preset?.label ?? "Cloud provider") : "Ollama on this computer",
    baseUrl: s.baseUrl,
    model: s.model,
    hasKey: !!s.apiKey,
    keyHint: s.apiKey ? `…${s.apiKey.slice(-4)}` : "",
    cloudReady: !!(s.baseUrl && s.model && s.apiKey),
    presets: Object.entries(CLOUD_PRESETS).map(([id, p]) => ({ id, ...p })),
    managedByEnvironment: !!process.env.UWL_AI_PROVIDER,
  };
}

/**
 * Save a change. `apiKey: ""` keeps the stored key; `clearKey: true` removes it.
 * Returns an error message for a value that cannot be used.
 */
export function saveAiSettings(input: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
  const current = { ...DEFAULTS, ...readFile() } as AiSettings;
  const next: AiSettings = { ...current };
  if (input.provider === "local" || input.provider === "cloud") next.provider = input.provider;
  if (typeof input.preset === "string" && CLOUD_PRESETS[input.preset]) next.preset = input.preset;
  if (input.baseUrl !== undefined) {
    const url = cleanUrl(input.baseUrl);
    if (input.baseUrl && !url) return { ok: false, message: "The address must start with https:// (or http:// for a service on this computer)." };
    next.baseUrl = url;
  }
  if (input.model !== undefined) {
    const model = cleanModel(input.model);
    if (input.model && !model) return { ok: false, message: "That model name is not valid." };
    next.model = model;
  }
  if (input.clearKey === true) next.apiKey = "";
  else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    const key = cleanKey(input.apiKey);
    if (!key) return { ok: false, message: "That key contains characters a key cannot have." };
    next.apiKey = key;
  }
  const file = settingsFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {}
  return { ok: true };
}
