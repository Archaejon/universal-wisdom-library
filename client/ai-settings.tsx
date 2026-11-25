import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { Badge, Icon, useToast } from "./components";

/**
 * Which model writes the library's generated text, as the server reports it.
 * The key itself never comes back: only whether one is set and its last four
 * characters.
 */
export type AiSettingsView = {
  provider: "local" | "cloud";
  preset: string;
  providerLabel: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyHint: string;
  cloudReady: boolean;
  presets: { id: string; label: string; baseUrl: string; model: string; keyHint: string; docs: string }[];
  managedByEnvironment: boolean;
  canEdit: boolean;
};

type Overview = {
  loaded: { name: string; sizeBytes: number; vramBytes: number; expiresAt: string | null; contextLength: number | null }[] | null;
  queue: { active: number; waiting: number; limit: number };
  local: { numCtx: number; keepAlive: string };
};

export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const reload = useCallback(() => {
    api<AiSettingsView>("/api/ai/settings")
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);
  useEffect(reload, [reload]);
  return { settings, setSettings, reload };
}

const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

function untilLabel(iso: string | null) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "unloading";
  const min = Math.round(ms / 60_000);
  return min < 1 ? "unloads in under a minute" : `unloads in ${min} min`;
}

function LoadedModels() {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const load = useCallback(() => {
    api<Overview>("/api/ai/engine")
      .then(setData)
      .catch(() => setData(null));
  }, []);
  useEffect(load, [load]);

  const free = async () => {
    setBusy(true);
    try {
      const r = await api<{ unloaded: string[] }>("/api/ai/free", { method: "POST", body: {} });
      push(r.unloaded.length ? `Freed the memory held by ${r.unloaded.join(", ")}.` : "No model was holding memory.", "success");
      load();
    } catch (e: any) {
      push(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  return (
    <div className="ai-loaded">
      <h4>In memory now</h4>
      {data.loaded === null ? (
        <p className="muted small">Ollama is not answering, so nothing is loaded.</p>
      ) : data.loaded.length === 0 ? (
        <p className="muted small">No model is loaded. The first answer loads one, which takes a few seconds.</p>
      ) : (
        <ul>
          {data.loaded.map((m) => (
            <li key={m.name}>
              <strong>{m.name}</strong> · {gb(m.sizeBytes)}
              {m.vramBytes ? ` (${gb(m.vramBytes)} on the graphics card)` : " (in main memory)"}
              {m.contextLength ? ` · ${m.contextLength.toLocaleString()}-token window` : ""} · {untilLabel(m.expiresAt)}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        {data.queue.active ? `Writing ${data.queue.active} answer${data.queue.active === 1 ? "" : "s"}` : "Idle"}
        {data.queue.waiting ? `, ${data.queue.waiting} waiting` : ""}. One answer is written at a time; a model stays loaded for {data.local.keepAlive} after its last use.
      </p>
      <div className="button-row">
        <button className="button small" onClick={free} disabled={busy || !data.loaded?.length}>
          {busy ? "Freeing…" : "Free memory now"}
        </button>
        <button className="button ghost small" onClick={load}>Refresh</button>
      </div>
    </div>
  );
}

export function AiSettingsPanel({ settings, onSaved }: { settings: AiSettingsView; onSaved: (s: AiSettingsView) => void }) {
  const [provider, setProvider] = useState(settings.provider);
  const [preset, setPreset] = useState(settings.preset);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { push } = useToast();

  const chosen = settings.presets.find((p) => p.id === preset);
  const choosePreset = (id: string) => {
    setPreset(id);
    const p = settings.presets.find((x) => x.id === id);
    if (p && p.baseUrl) setBaseUrl(p.baseUrl);
    if (p && p.model) setModel(p.model);
  };

  const save = async (e: FormEvent, extra: Record<string, unknown> = {}) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const next = await api<AiSettingsView>("/api/ai/settings", {
        method: "POST",
        body: { provider, preset, baseUrl, model, apiKey: key, ...extra },
      });
      setKey("");
      onSaved(next);
      push(next.provider === "cloud" ? `Generated text now comes from ${next.providerLabel}.` : "Generated text now comes from the model on this computer.", "success");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !settings.canEdit || settings.managedByEnvironment;
  return (
    <form className="ai-settings" onSubmit={save}>
      <fieldset disabled={readOnly || saving}>
        <legend className="sr-only">Which model writes</legend>
        <label className={provider === "local" ? "ai-choice on" : "ai-choice"}>
          <input type="radio" name="ai-provider" checked={provider === "local"} onChange={() => setProvider("local")} />
          <span>
            <strong>A model on this computer</strong> (Ollama). Nothing leaves this machine. Needs Ollama and a model it has downloaded.
          </span>
        </label>
        <label className={provider === "cloud" ? "ai-choice on" : "ai-choice"}>
          <input type="radio" name="ai-provider" checked={provider === "cloud"} onChange={() => setProvider("cloud")} />
          <span>
            <strong>A cloud service</strong> (OpenAI, OpenRouter, Groq or another OpenAI-compatible service). Faster on a computer without a
            graphics card, but the passages it writes from are sent to that service.
          </span>
        </label>

        {provider === "cloud" && (
          <div className="ai-cloud">
            <p className="ai-warning">
              <Icon name="external" size={14} /> When you ask for a synthesis or a translation, the passages involved are sent to the service
              you choose, under its terms. Nothing is sent until you ask.
            </p>
            <label className="field">
              <span>Service</span>
              <select value={preset} onChange={(e) => choosePreset(e.target.value)}>
                {settings.presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Address</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" inputMode="url" autoComplete="off" />
            </label>
            <label className="field">
              <span>Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={chosen?.model || "model name"} autoComplete="off" />
            </label>
            <label className="field">
              <span>API key {settings.hasKey && <Badge tone="green">saved {settings.keyHint}</Badge>}</span>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={settings.hasKey ? "Leave empty to keep the saved key" : chosen?.keyHint || "API key"}
                autoComplete="off"
              />
            </label>
            <p className="muted small">
              The key is kept in a file in the library folder that only your user account can read, and is never shown again.
              {chosen?.docs && (
                <>
                  {" "}
                  <a href={chosen.docs} target="_blank" rel="noreferrer">Get a key from {chosen.label} <Icon name="external" size={12} /></a>
                </>
              )}
            </p>
          </div>
        )}

        {error && <p className="error-note">{error}</p>}
        {!readOnly && (
          <div className="button-row">
            <button className="button primary small" type="submit">{saving ? "Saving…" : "Save"}</button>
            {settings.hasKey && (
              <button className="button ghost small" type="button" onClick={(e) => save(e as unknown as FormEvent, { clearKey: true })}>
                Remove the saved key
              </button>
            )}
          </div>
        )}
      </fieldset>
      {settings.managedByEnvironment && <p className="muted small">These settings are fixed by the server's configuration (UWL_AI_*).</p>}
      {!settings.canEdit && !settings.managedByEnvironment && (
        <p className="muted small">Only someone at the computer running the library, or an administrator, can change these settings.</p>
      )}
      {settings.provider === "local" && <LoadedModels />}
    </form>
  );
}
