# Optional local AI (Ollama)

The study assistant works without any AI model. Its retrieval answer — passages, editions and citations — is produced deterministically by the local search index. A model served by [Ollama](https://ollama.com) can *optionally* rewrite the synthesis paragraph from those same retrieved passages. Local AI is off by default and nothing contacts Ollama unless a reader turns it on and asks a question.

The rest of the library (library shelves, reader, search, themes, compare, provenance, study features) never imports the AI layer and never waits for it.

## Where AI is used, and where it is not

| Feature | AI | Why |
| --- | --- | --- |
| `GET /api/assistant/ask` — retrieval, quotations, citations | no | FTS retrieval and template assembly are faster, deterministic and auditable. |
| `POST /api/assistant/synthesise` — the synthesis paragraph | optional | A local model can compare six retrieved excerpts more fluently than a template, while staying inside them. |
| Library, reader, search, themes, compare, provenance | no | Ordinary SQL and rendering already do these jobs. |
| Chapter summaries, passage glosses, chat | deliberately omitted | The reader is a verbatim text surface; generated prose there would blur the line between a source and a model's paraphrase. |

One capability keeps the integration small. The service in `server/ollama.ts` is task-agnostic, so another capability can reuse it without a second client, model list, cache or concurrency guard.

## Architecture

```
client/pages/AssistantPage.tsx   toggle, model picker, streamed synthesis, Stop/Retry
client/ai.ts                     preference (localStorage), status check, NDJSON reader
        │  POST /api/assistant/synthesise (NDJSON)
server/api.ts                    auth-independent rate limit, route
server/assistant.ts              retrieval → grounded prompt → event stream → cache
server/ollama.ts                 config, /api/tags, /api/generate streaming, limits, cache
        │  HTTP on loopback
Ollama daemon (127.0.0.1:11434)
```

### Request lifecycle

1. The reader asks a question. The page first calls the existing retrieval endpoint; the answer, quotations and citations render immediately. No model is involved.
2. If local AI is on, the page opens `POST /api/assistant/synthesise`. The server re-runs the same deterministic retrieval, so the prompt and the quotations on screen describe the same passages.
3. Pre-flight checks run **before** any stream is opened: AI enabled, daemon reachable, chosen model installed, machine not already generating, and at least one passage retrieved. Failures are ordinary HTTP errors (409/503/422/429) with actionable messages, so the UI can fall back to the retrieval summary.
4. The server streams NDJSON: `meta` (model, numbered sources, disclosure), `delta`s, then `done` or `error`. `Content-Type: application/x-ndjson`, `Cache-Control: no-store`.
5. Ollama is asked for `stream: true` with task-specific limits. Client disconnects abort the upstream request, so the model stops writing.
6. A complete answer is cached in memory for 15 minutes (max 30 entries), keyed by model + question. The page also deduplicates: one synthesis per answer, one question per submit.

### Prompting and guardrails

`SYNTHESIS_SYSTEM` in `server/assistant.ts` restricts the model to the supplied excerpts, requires `[n]` citations, forbids invented quotations and references, forbids harmonising traditions, and caps the answer at two paragraphs and 170 words. The prompt contains only:

- the question (max 500 characters), and
- up to six excerpts (≤ 480 characters each) with work, reference, tradition, date and edition metadata.

The model never sees the database, the conversation history, or other users' data. Its output is rendered as text through React (escaped), and `[n]` markers become links only when *n* was actually supplied — grouped (`[2, 3]`) and ranged (`[3-5]`) markers are expanded, but an invented number stays visible as plain text rather than becoming a citation.

## Configuration

All settings are environment variables read on the server. Defaults assume a local daemon and a modest, already-installed model.

| Variable | Default | Meaning |
| --- | --- | --- |
| `UWL_OLLAMA_ENABLED` | `1` | `0` disables the local-model routes entirely; retrieval is unaffected. |
| `UWL_OLLAMA_URL` | `http://127.0.0.1:11434` | Daemon origin, server-side only. Non-HTTP values fall back to the default. |
| `UWL_OLLAMA_MODEL` | `llama3.1:8b` | Default model. The UI lists installed models and lets the reader choose another; an uninstalled choice is refused with the `ollama pull` command. |
| `UWL_OLLAMA_TIMEOUT_MS` | `120000` | Total generation timeout (5 s–10 min). On expiry the upstream request is aborted. |
| `UWL_OLLAMA_NUM_CTX` | `4096` | Context window. Six excerpts plus instructions fit comfortably; do not raise it without reason, since it costs VRAM. |
| `UWL_OLLAMA_NUM_PREDICT` | `280` | Answer token limit (≈170 words). |
| `UWL_OLLAMA_TEMPERATURE` | `0.2` | Low temperature for a comparison note. |
| `UWL_OLLAMA_KEEP_ALIVE` | `5m` | How long Ollama keeps the model in memory after a request. |
| `UWL_OLLAMA_CONCURRENCY` | `1` | Simultaneous generations on this server. Extra requests get a clear "already writing" error instead of queueing GPU work. |

Example:

```bash
UWL_OLLAMA_MODEL=qwen2.5:3b UWL_OLLAMA_KEEP_ALIVE=2m UWL_OLLAMA_NUM_PREDICT=200 PORT=4173 bun run dev
```

Check what is installed first with `ollama list`. Smaller quantised models (`:3b`, `q4`) are a reasonable default on laptops; larger models raise quality and memory use. The app never downloads a model: `ollama pull <model>` is always an explicit human action. The UI's **Check model** button reports the daemon URL, installed models and the active limits.

### Resource behaviour

- No request at server start, page load or navigation. The model list is read only when the reader opens the local-model controls or asks a question.
- Settings are per-task, not global: 4096 context and 280 output tokens, not model defaults.
- One generation at a time by default; duplicate submissions are blocked in the UI and by the server.
- `keep_alive` unloads the model after five idle minutes. Turning local AI off sends `keep_alive: 0` so the memory is released immediately.
- Successful answers are cached in memory; a repeated question costs no inference. The cache is not persisted and is cleared on restart.
- No polling, no retries against a failing daemon, no background warm-up.

## Privacy

- Inference stays on the machine running the server (loopback by default). No external AI provider is contacted; there is no API key and no SDK.
- Prompts are not logged. Errors logged to the server console contain no prompt text.
- Answers are not persisted, except the question and citation list already recorded by the existing `assistant_queries` audit table (no generated prose).
- The preference (on/off, chosen model) is stored in `localStorage` only.
- The browser never talks to Ollama. It talks to this app, which talks to the daemon. That matters when the app is not on the same machine as the browser.

## Deployment model

The integration is server-side by design. `localhost:11434` from a browser means *the visitor's* computer, not the server's, so a browser-only integration would not work for readers of a hosted copy.

- **Local/self-hosted (supported default):** run the app and Ollama on the same machine; the daemon stays bound to loopback.
- **Remote server:** the server needs its own Ollama, which is expensive and shared; do not enable it casually. Point `UWL_OLLAMA_URL` only at a daemon the server can reach privately.
- **Never expose Ollama publicly.** `11434` has no authentication. This app does not proxy arbitrary prompts: its route performs retrieval itself, accepts only a question and a model name, enforces a same-origin mutation check, a rate limit, one concurrent generation, fixed prompt limits and no model download. It is an app endpoint, not a general inference proxy — but it is still unauthenticated for readers, so treat a multi-tenant deployment as requiring authentication in front of it.

## Files

| File | Change |
| --- | --- |
| `server/ollama.ts` | New: config, `/api/tags`, `/api/generate` streaming, error mapping, concurrency, cache, release. |
| `server/assistant.ts` | Retrieval extracted for reuse; grounded prompt, pre-flight checks, NDJSON stream, release. |
| `server/api.ts` | `GET /api/assistant/engine`, `POST /api/assistant/synthesise`, `POST /api/assistant/release`. |
| `client/ai.ts` | New: preference storage, status check, stream reader. |
| `client/pages/AssistantPage.tsx` | Off-by-default controls, streamed synthesis, Stop/Retry/Check, deterministic fallback. |
| `client/styles.css` | Local-model panel, model status, error and fallback states. |
| `tests/ollama.test.ts` | New: 25 tests over config, parsing, a fake daemon, cancellation, citation markers, prompt and event stream. |

No dependencies were added: the Ollama HTTP API is called with `fetch`.

## Verification

Automated (`bun test`, 68 tests): config clamps and URL validation, model-name sanitising, `:latest` matching, status with/without a daemon, no network call when disabled, cache-of-success-only, NDJSON parsing across chunk boundaries, per-task limits, model-missing mapping, mid-stream error with partial text, abort, empty answer, citation-marker expansion, prompt construction and the full event stream including cached and busy paths.

Manual, against a real Ollama and `llama3.1:8b`:

- app starts with Ollama stopped; `GET /api/assistant/ask` still answers in ~0.1–2 s;
- `/api/assistant/engine` reports the daemon and model, and the UI shows URL, context and answer limits;
- `POST /api/assistant/synthesise` streamed a 678-character grounded comparison in 29.5 s, with six source numbers and no error events; a repeat returned the cached text in 0.11 s;
- a second request during generation received `429 ai_busy`;
- killing the client aborted the upstream generation (verified against a recorder daemon);
- with `UWL_OLLAMA_URL` pointing at a closed port, the page shows an actionable error, keeps the retrieval summary and offers **Try again** / **Check model**;
- page load and normal navigation issue zero Ollama requests (verified with a recording daemon);
- no React or console errors; the 503 from the intentional outage test is the only network error logged.

Not verified: visual screenshots (the preview webview would not composite in this environment), and multi-user or remote-server behaviour.

## Remaining limitations

- A local model can still misread an excerpt; its prose is labelled as generated and the verbatim quotations sit beside it.
- The cache lives in the `synthesis_cache` table, so it survives a restart and is shared between processes; it still expires after fifteen minutes and keeps at most thirty answers.
- The rate limiter counts in the `rate_limits` table and is shared between processes. The concurrency guard is still per process, because it tracks streams open inside one server.
- Model quality varies. The prompt discourages harmonising traditions, but small models sometimes generalise; readers are told to prefer the quotations.
- Retrieval takes four of its six passages from locally held texts and two from the indexed streamed shelves (Sefaria, hadith, Qur'an, SuttaCentral, OpenITI, ctext). A streamed passage contributes the excerpt indexed for search, not a local copy, so its quotation is shorter than the chapter; Sefaria's live search is still outside the assistant.
