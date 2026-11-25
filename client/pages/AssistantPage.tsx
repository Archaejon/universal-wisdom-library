import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "../router";
import { api } from "../api";
import { Badge, CopyButton, ErrorState, Icon, PageIntro } from "../components";
import { clearAskContext, loadAskContext, type AskContextDraft } from "../selection";
import { AiSettingsPanel, useAiSettings } from "../ai-settings";
import {
  checkEngine,
  citationNumbers,
  loadAiPrefs,
  releaseModel,
  saveAiPrefs,
  streamSynthesis,
  type AiPrefs,
  type EngineStatus,
  type SynthesisSource,
} from "../ai";

const SUGGESTIONS = [
  "How should a person respond to suffering?",
  "What does mercy require of a person?",
  "What is the nature of the self?",
  "How should speech be truthful?",
  "How do traditions speak about death?",
  "What is the ultimate reality?",
];

const CONTEXT_SUGGESTIONS = [
  "What does this mean?",
  "Where else is this idea found?",
  "How have commentators read this?",
  "How do other traditions speak of this?",
];

type Scope = { kind: "all" } | { kind: "work" } | { kind: "tradition"; slug: string; name: string };
type AskRequest = { scope: { work?: string; tradition?: string }; context?: { work: string; reference: string; selection: string } };
type HistoryEntry = { id: number; question: string; answer: any; request: AskRequest; context: AskContextDraft | null };

const TIER_TONES: Record<string, "accent" | "blue" | "green" | "muted" | "neutral"> = {
  scripture: "accent",
  commentary: "blue",
  law: "green",
  thought: "neutral",
  other: "muted",
};

function scopeRequest(scope: Scope, context: AskContextDraft | null): AskRequest["scope"] {
  if (scope.kind === "work" && context) return { work: context.work };
  if (scope.kind === "tradition") return { tradition: scope.slug };
  return {};
}

const COMMENTARY_LABELS: Record<string, string> = {
  traditional: "Traditional commentary",
  academic: "Academic scholarship",
  modern_religious: "Modern religious interpretation",
  editorial: "Editorial note",
};

function humanSize(bytes?: number): string {
  if (!bytes) return "";
  const gb = bytes / 1_073_741_824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1_048_576)} MB`;
}

export function AssistantPage() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [context, setContext] = useState<AskContextDraft | null>(() => loadAskContext());
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [traditions, setTraditions] = useState<{ slug: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ai, setAi] = useState<AiPrefs>(() => loadAiPrefs());
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineError, setEngineError] = useState("");
  const nextId = useRef(1);
  const inFlight = useRef(false);

  useEffect(() => {
    saveAiPrefs(ai);
  }, [ai]);

  useEffect(() => {
    api<{ traditions: any[] }>("/api/traditions")
      .then((d) => setTraditions((d.traditions ?? []).filter((t: any) => Number(t.passages) > 0).map((t: any) => ({ slug: t.slug, name: t.name }))))
      .catch(() => setTraditions([]));
  }, []);

  const dropContext = () => {
    clearAskContext();
    setContext(null);
    if (scope.kind === "work") setScope({ kind: "all" });
  };

  const check = useCallback(async (fresh: boolean) => {
    setEngineBusy(true);
    setEngineError("");
    try {
      const status = await checkEngine(fresh);
      setEngine(status);
      if (status.available) {
        const names = status.models.map((m) => m.name);
        setAi((prev) => {
          if (prev.model && names.includes(prev.model)) return prev;
          const pick = names.includes(status.model) ? status.model : names[0];
          return pick ? { ...prev, model: pick } : prev;
        });
      }
    } catch (e: any) {
      setEngineError(e?.message ?? "Could not reach the local model server.");
    } finally {
      setEngineBusy(false);
    }
  }, []);

  const submit = async (q: string) => {
    const value = q.trim();
    // A ref guard, not just the state flag: two submits in one tick must not
    // produce two retrievals and two synthesis streams.
    if (value.length < 3 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const model = ai.model;
    try {
      const request: AskRequest = {
        scope: scopeRequest(scope, context),
        ...(context ? { context: { work: context.work, reference: context.reference, selection: context.selection } } : {}),
      };
      const answer = await api<any>("/api/assistant/ask", { method: "POST", body: { question: value, ...request } });
      setHistory((h) => [{ id: nextId.current++, question: value, answer, request, context }, ...h]);
      setQuestion("");
      // A model name may not have been chosen yet on a machine that was never
      // checked; the server falls back to its configured default.
      if (ai.enabled && !model) void check(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const { settings: aiSettings, setSettings: setAiSettings } = useAiSettings();
  const cloud = aiSettings?.provider === "cloud";

  const toggleAi = () => {
    if (ai.enabled) {
      setAi({ ...ai, enabled: false });
      if (!cloud) void releaseModel(ai.model);
    } else {
      setAi({ ...ai, enabled: true });
      if (!cloud) void check(false);
    }
  };

  return (
    <div className="container page assistant-page">
      <PageIntro
        eyebrow="Study assistant"
        title="Ask the corpus, not a chatbot"
        lede="Answers are retrieved from the indexed passages and cited by edition. A local model can optionally write the synthesis from those same passages — on your machine, only when you ask, and off by default."
      >
        <div className="assistant-disclosure">
          <Badge tone="warn">{cloud ? "Retrieval first; cloud AI only when you turn it on" : "Retrieval first, no external AI"}</Badge>
          <p>
            The retrieval engine quotes passages with their edition and labels its own synthesis as interpretation.
            Local generation is optional, never required, and cannot answer beyond the retrieved excerpts.
          </p>
        </div>

        <div className="assistant-local">
          <div className="assistant-local-head">
            <Badge tone={ai.enabled ? "accent" : "muted"}>
              {cloud ? (ai.enabled ? "Cloud model on" : "Cloud model off") : ai.enabled ? "Local model on" : "Local model off"}
            </Badge>
            {cloud ? (
              <p>
                Optional. {aiSettings?.model} at {aiSettings?.providerLabel} can write the synthesis from the retrieved excerpts.
                When it is on, the question and those excerpts are sent to {aiSettings?.providerLabel}. Nothing is sent until you ask.
              </p>
            ) : (
              <p>
                Optional. A model served by Ollama on this computer can write the synthesis from the retrieved excerpts.
                Nothing is generated until you ask, no model is downloaded automatically, and ordinary answers never wait for it.
              </p>
            )}
          </div>
          <div className="assistant-local-actions">
            <button className="button small" onClick={toggleAi}>{ai.enabled ? "Turn off" : cloud ? "Use cloud model" : "Use local model"}</button>
            {!cloud && (
              <button className="button ghost small" onClick={() => check(true)} disabled={engineBusy}>
                {engineBusy ? "Checking…" : engine ? "Check again" : "Check model"}
              </button>
            )}
            {!cloud && ai.enabled && engine?.available && engine.models.length > 1 && (
              <label className="assistant-local-model">
                <span>Model</span>
                <select
                  value={ai.model || engine.model}
                  onChange={(e) => setAi({ ...ai, model: e.target.value })}
                >
                  {engine.models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}{m.parameterSize ? ` · ${m.parameterSize}` : ""}{m.sizeBytes ? ` · ${humanSize(m.sizeBytes)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {engineError && <p className="assistant-local-note error-note">{engineError}</p>}
          {!cloud && engine && !engine.available && (
            <p className="assistant-local-note">
              {engine.error} The retrieval answer still works; only the generated synthesis is unavailable.
            </p>
          )}
          {!cloud && engine?.available && !engine.modelInstalled && (
            <p className="assistant-local-note">
              No model matching the server default is installed. Choose one below, or run <code>ollama pull {engine.model}</code>.
            </p>
          )}
          {!cloud && engine?.available && (
            <p className="assistant-local-note">
              {engine.models.length} model{engine.models.length === 1 ? "" : "s"} installed · {engine.baseUrl} · {engine.settings.numCtx}-token context, {engine.settings.numPredict}-token answer limit · unloads after {engine.settings.keepAlive} idle. Turning this off releases it from memory.
            </p>
          )}
          {aiSettings && (
            <details className="ai-settings-details">
              <summary>AI settings: which model writes{aiSettings.provider === "cloud" ? ` (${aiSettings.providerLabel})` : " (this computer)"}</summary>
              <AiSettingsPanel
                key={`${aiSettings.provider}:${aiSettings.preset}:${aiSettings.hasKey}`}
                settings={aiSettings}
                onSaved={(next) => {
                  setAiSettings(next);
                  setEngine(null);
                }}
              />
            </details>
          )}
        </div>
      </PageIntro>

      {context && (
        <section className="ask-context" aria-label="Passage you are asking about">
          <div className="ask-context-head">
            <span className="eyebrow">Asking about</span>
            <Link to={`/read/${context.work}?ref=${encodeURIComponent(context.reference)}`}>
              {context.workTitle} {context.label}
            </Link>
            <button className="button ghost small" onClick={dropContext} aria-label="Stop asking about this passage">
              <Icon name="close" size={14} /> Remove
            </button>
          </div>
          <blockquote dir="auto">{context.selection}</blockquote>
          <p className="muted small">
            The selection goes with your question. The answer quotes it first and looks for related passages using its words.
          </p>
        </section>
      )}

      <div className="ask-scope chip-row small" role="radiogroup" aria-label="Where to look">
        <span className="eyebrow">Look in</span>
        <button role="radio" aria-checked={scope.kind === "all"} className={scope.kind === "all" ? "chip active" : "chip"} onClick={() => setScope({ kind: "all" })}>
          The whole library
        </button>
        {context && (
          <button role="radio" aria-checked={scope.kind === "work"} className={scope.kind === "work" ? "chip active" : "chip"} onClick={() => setScope({ kind: "work" })}>
            {context.workTitle}
          </button>
        )}
        {context?.tradition && (
          <button
            role="radio"
            aria-checked={scope.kind === "tradition" && scope.slug === context.tradition.slug}
            className={scope.kind === "tradition" && scope.slug === context.tradition.slug ? "chip active" : "chip"}
            onClick={() => setScope({ kind: "tradition", slug: context.tradition!.slug, name: context.tradition!.name })}
          >
            {context.tradition.name}
          </button>
        )}
        {traditions.length > 0 && (
          <select
            className={scope.kind === "tradition" && scope.slug !== context?.tradition?.slug ? "ask-scope-select active" : "ask-scope-select"}
            aria-label="One tradition"
            value={scope.kind === "tradition" ? scope.slug : ""}
            onChange={(e) => {
              const t = traditions.find((x) => x.slug === e.target.value);
              setScope(t ? { kind: "tradition", slug: t.slug, name: t.name } : { kind: "all" });
            }}
          >
            <option value="">One tradition…</option>
            {traditions.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        )}
      </div>

      <form
        className="assistant-form"
        onSubmit={(e) => { e.preventDefault(); submit(question); }}
      >
        <label className="field">
          <span>Your question</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. How do different traditions describe compassion?"
          />
        </label>
        <div className="assistant-form-foot">
          <span className="muted small">{question.length}/500 · answers are limited to the indexed corpus</span>
          <button className="button primary" disabled={busy || question.trim().length < 3}>{busy ? "Retrieving…" : "Ask the library"}</button>
        </div>
      </form>

      <div className="suggested-questions">
        <span className="eyebrow">Try</span>
        {(context ? CONTEXT_SUGGESTIONS : SUGGESTIONS).map((s) => (
          <button key={s} className="chip" onClick={() => { setQuestion(s); submit(s); }} disabled={busy}>{s}</button>
        ))}
      </div>

      {error && <ErrorState message={error} />}

      <div className="assistant-history">
        {history.map((entry) => (
          <AnswerBlock key={entry.id} entry={entry} ai={ai} onEngineIssue={() => check(true)} />
        ))}
      </div>

      {history.length === 0 && !busy && (
        <section className="assistant-about">
          <h2>How to read an answer</h2>
          <div className="three-col">
            <div>
              <h3>Quotations</h3>
              <p>Each quotation is copied from a named edition. Where it is shortened, that is stated. Links open the exact passage in the reader.</p>
            </div>
            <div>
              <h3>Synthesis</h3>
              <p>The retrieval summary is deterministic. If local AI is on, a model on your computer rewrites it from the same excerpts and cites them by number; that text is generated, not a source claim.</p>
            </div>
            <div>
              <h3>Gaps</h3>
              <p>If retrieval finds nothing, neither the assistant nor the local model will answer. It does not fill gaps with invented quotations or references.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

type Generation = {
  status: "idle" | "streaming" | "done" | "error" | "stopped";
  text: string;
  error?: string;
  code?: string;
  sources?: SynthesisSource[];
  disclosure?: string;
  model?: string;
  ms?: number;
  cached?: boolean;
  queued?: string;
  fitted?: { quoteChars: number; dropped: number } | null;
};

function AnswerBlock({ entry, ai, onEngineIssue }: { entry: HistoryEntry; ai: AiPrefs; onEngineIssue: () => void }) {
  const a = entry.answer;
  const [gen, setGen] = useState<Generation>({ status: "idle", text: "" });
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  const run = useCallback(() => {
    if (!a.grounded) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGen({ status: "streaming", text: "" });
    streamSynthesis({
      question: entry.question,
      model: ai.model,
      extra: entry.request,
      signal: controller.signal,
      onEvent: (event) => {
        if (controller.signal.aborted) return;
        if (event.type === "meta") {
          setGen((g) => ({ ...g, sources: event.sources, disclosure: event.disclosure, model: event.model, fitted: event.fitted ?? null }));
        } else if (event.type === "queued") {
          setGen((g) => ({ ...g, queued: event.message }));
        } else if (event.type === "delta") {
          setGen((g) => ({ ...g, queued: undefined, text: g.text + event.text }));
        } else if (event.type === "done") {
          setGen((g) => ({ ...g, status: "done", ms: event.ms, cached: event.cached, model: event.model }));
        } else if (event.type === "error") {
          setGen((g) => ({ ...g, status: "error", error: event.message, code: event.code }));
        }
      },
    }).catch((err: any) => {
      if (controller.signal.aborted) return;
      setGen((g) => ({ ...g, status: "error", error: err?.message ?? "The local model request failed.", code: err?.code }));
    });
  }, [a.grounded, entry.question, ai.model]);

  useEffect(() => {
    if (!ai.enabled || !a.grounded || startedRef.current) return;
    startedRef.current = true;
    run();
    return () => abortRef.current?.abort();
    // Started once per answer: a later model change applies to new questions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.enabled]);

  const stop = () => {
    abortRef.current?.abort();
    setGen((g) => ({ ...g, status: "stopped" }));
  };

  const retry = () => {
    startedRef.current = true;
    run();
  };

  const modelActive = ai.enabled && a.grounded;
  const showingModel = modelActive && gen.status !== "idle";
  const disclosure = gen.disclosure ?? (ai.model ? `Synthesis is written on this machine by ${ai.model} through Ollama; nothing is sent to an external AI provider.` : null);

  return (
    <article className="answer-block">
      <header className="answer-question">
        <span className="eyebrow">Question</span>
        <h2>{entry.question}</h2>
        {(a.context || a.scope?.label) && (
          <p className="muted small answer-scope">
            {a.context && <>About {a.context.label ? `${entry.context?.workTitle ?? ""} ${a.context.label}`.trim() : "your selection"}. </>}
            {a.scope?.label && <>Searched within {a.scope.label}.</>}
          </p>
        )}
      </header>

      <div className="answer-disclosure">
        <Icon name="quote" size={16} />
        <span>{showingModel ? disclosure : a.engine?.disclosure}</span>
      </div>

      {!a.grounded ? (
        <div className="answer-ungrounded">
          <h3>No grounded answer</h3>
          <p>{a.message}</p>
          {a.limitations?.length > 0 && (
            <ul className="limitation-list">
              {a.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}
            </ul>
          )}
          <div className="button-row">
            <Link className="button" to="/themes">Browse themes</Link>
            <Link className="button ghost" to="/search">Search the corpus directly</Link>
          </div>
        </div>
      ) : (
        <>
          <section className="answer-synthesis">
            <div className="synthesis-head">
              <h3>Interpretive synthesis</h3>
              {showingModel ? (
                <Badge tone="muted" title="Generated on this machine from the retrieved excerpts. Not the work of the authors named.">
                  {gen.status === "streaming" ? "Local model · writing" : gen.status === "stopped" ? "Local model · stopped" : gen.status === "error" ? "Local model · failed" : "Local model · generated, not a source claim"}
                </Badge>
              ) : (
                <Badge tone="muted">Generated by retrieval assistant · not a source claim</Badge>
              )}
            </div>

            {showingModel ? (
              <ModelSynthesis
                gen={gen}
                sourceCount={a.quotations.length}
                onStop={stop}
                onRetry={retry}
                fallback={a.synthesis?.text ?? ""}
                onEngineIssue={onEngineIssue}
              />
            ) : (
              String(a.synthesis?.text ?? "").split(/\n{2,}/).map((p: string, i: number) => <p key={i}>{p}</p>)
            )}
          </section>

          <section className="answer-quotations">
            <h3>Quotations from the corpus</h3>
            <p className="muted small">Exact excerpts from the editions named. A quotation is evidence of what this edition says, not of what an entire tradition teaches.</p>
            {a.tiers?.length > 0 && (
              <p className="answer-tiers small">
                {a.tiers.map((t: any) => (
                  <span key={t.tier}>
                    <Badge tone={TIER_TONES[t.tier] ?? "muted"}>{t.label}</Badge> {t.count}
                  </span>
                ))}
                <span className="muted">Slots are shared out by kind of text, so one kind cannot fill the answer.</span>
              </p>
            )}
            {a.quotations.map((q: any, i: number) => (
              <article key={i} className={q.isContext ? "answer-quote context" : "answer-quote"}>
                <div className="answer-quote-head">
                  {q.isContext && <Badge tone="warn">You asked about this</Badge>}
                  {q.tierLabel && <Badge tone={TIER_TONES[q.tier] ?? "muted"}>{q.tierLabel}</Badge>}
                  <Badge tone="neutral">{q.tradition.name}</Badge>
                  <span className="muted small">{q.work.dateDisplay}</span>
                </div>
                <blockquote>{q.quote}</blockquote>
                <p className="answer-citation">
                  <strong>{q.work.title}</strong> {q.label} · {q.edition.title}
                  {q.edition.translator ? `, trans. ${q.edition.translator}` : ""}
                  {q.edition.publicationYear ? ` (${q.edition.publicationYear})` : ""}
                </p>
                <p className="small muted">
                  {q.isContext
                    ? q.verified
                      ? "Your selection, found in this edition."
                      : "Your selection, as shown in the reader."
                    : q.shortened
                      ? "Excerpt; the full passage is longer."
                      : "Complete passage as imported."}
                  {q.edition.source?.name ? ` Source: ${q.edition.source.name}.` : ""}
                  {q.edition.license?.name ? ` ${q.edition.license.name}.` : ""}
                </p>
                <p className="result-why">{q.reason ?? q.why}</p>
                <div className="button-row">
                  <Link className="button small" to={q.link}>Read in context <Icon name="arrow-right" size={14} /></Link>
                  <CopyButton small text={`${q.work.title} ${q.label}. ${q.edition.title}${q.edition.translator ? `, trans. ${q.edition.translator}` : ""}. ${window.location.origin}/read/${q.work.slug}?ref=${encodeURIComponent(q.reference)}`} label="Copy citation" />
                </div>
              </article>
            ))}
          </section>

          {a.interpretations?.entries?.length > 0 && (
            <section className="answer-interpretations">
              <h3>Interpretations</h3>
              <p className="muted small">{a.interpretations.note}</p>
              {a.interpretations.entries.map((c: any, i: number) => (
                <article key={i} className="answer-interpretation">
                  <Badge tone={c.contentType === "academic" ? "blue" : "neutral"}>{COMMENTARY_LABELS[c.contentType] ?? c.contentType}</Badge>
                  <p className="commentary-meta">{c.author}{c.dateDisplay ? ` · ${c.dateDisplay}` : ""}{c.interpretiveTradition ? ` · ${c.interpretiveTradition}` : ""}</p>
                  <p>{c.text}</p>
                  <p className="small muted">Source: {c.source || "not recorded"}{c.provenanceNote ? ` · ${c.provenanceNote}` : ""}</p>
                  <Link className="text-link" to={`/read/${c.work.slug}?ref=${encodeURIComponent(c.reference)}#commentary`}>Open passage commentary</Link>
                </article>
              ))}
            </section>
          )}

          <section className="answer-limitations">
            <h3>What this answer cannot tell you</h3>
            <ul>
              {a.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}
            </ul>
          </section>

          <section className="answer-citations">
            <h3>Citations</h3>
            <ol>
              {a.citations.map((c: any, i: number) => (
                <li key={i}>
                  {c.work} {c.reference}. <em>{c.edition}</em>{c.translator ? `, trans. ${c.translator}` : ""}.
                  {c.source ? ` ${c.source}.` : ""}{c.license ? ` ${c.license}.` : ""}
                </li>
              ))}
            </ol>
            <p className="small muted">Corpus: {a.corpus.passages} passages from {a.corpus.works} works across {a.corpus.traditions} traditions. {a.corpusLabel}.</p>
          </section>
        </>
      )}
    </article>
  );
}

function ModelSynthesis({
  gen,
  sourceCount,
  onStop,
  onRetry,
  fallback,
  onEngineIssue,
}: {
  gen: Generation;
  sourceCount: number;
  onStop: () => void;
  onRetry: () => void;
  fallback: string;
  onEngineIssue: () => void;
}) {
  const streaming = gen.status === "streaming";
  const unavailable = gen.code === "ai_unavailable" || gen.code === "ai_disabled" || gen.code === "model_missing";

  return (
    <div className="model-synthesis">
      {gen.text && <SynthesisText text={gen.text} sources={gen.sources} />}

      {streaming && (
        <div className="model-status">
          {gen.queued && !gen.text ? <span className="muted small">{gen.queued}</span> : gen.text ? <span className="muted small">{gen.model ?? "Local model"} is writing…</span> : (
            <span className="muted small">
              {sourceCount} passages retrieved. Writing from them now — the first answer may wait while the model loads into memory.
            </span>
          )}
          <button className="button ghost small" onClick={onStop}>Stop</button>
        </div>
      )}

      {gen.fitted && (
        <p className="muted small">
          The excerpts were shortened{gen.fitted.dropped ? ` and the last ${gen.fitted.dropped} left out` : ""} to fit the model's context window.
        </p>
      )}
      {gen.status === "done" && (
        <p className="model-foot">
          {gen.cached ? "Repeated from this session's cache · " : ""}
          {gen.ms ? `${(gen.ms / 1000).toFixed(1)}s · ` : ""}
          {gen.text.split(/\s+/).filter(Boolean).length} words · written by {gen.model ?? "the local model"}
          {" · "}
          <button className="link-button" onClick={onRetry}>Write again</button>
        </p>
      )}

      {gen.status === "stopped" && (
        <div className="model-status">
          <span className="muted small">Stopped. Nothing further was generated.</span>
          <button className="button ghost small" onClick={onRetry}>Start again</button>
        </div>
      )}

      {gen.status === "error" && (
        <div className="model-error" role="alert">
          <p><strong>The local model could not finish.</strong> {gen.error}</p>
          <div className="button-row">
            <button className="button small" onClick={onRetry}>Try again</button>
            {unavailable && <button className="button ghost small" onClick={onEngineIssue}>Check model</button>}
          </div>
          <p className="muted small">The retrieval answer is unaffected; the summary below is the deterministic one.</p>
        </div>
      )}

      {(gen.status === "error" || gen.status === "stopped") && fallback && (
        <div className="model-fallback">
          <h4>Retrieval summary</h4>
          {fallback.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}
    </div>
  );
}

/** Renders model prose, turning supplied excerpt numbers (and ranges) into links. */
function SynthesisText({ text, sources }: { text: string; sources?: SynthesisSource[] }) {
  const byNumber = new Map((sources ?? []).map((s) => [s.n, s]));
  return (
    <>
      {text.split(/\n{2,}/).map((paragraph, i) => (
        <p key={i}>
          {paragraph.split(/(\[\d+(?:\s*(?:,|–|-)\s*\d+)*\])/g).map((part, j) => {
            const match = /^\[([^\]]+)\]$/.exec(part);
            const found = match
              ? citationNumbers(match[1])
                  .map((n) => byNumber.get(n))
                  .filter((s): s is SynthesisSource => !!s)
              : [];
            if (found.length === 0) return part;
            return (
              <span key={j} className="synthesis-refs">
                {found.map((source, k) => (
                  <span key={source.n}>
                    {k > 0 && " "}
                    <Link to={source.link} className="synthesis-ref" title={`${source.workTitle} ${source.reference}`}>
                      {source.n}
                    </Link>
                  </span>
                ))}
              </span>
            );
          })}
        </p>
      ))}
    </>
  );
}
