import { afterEach, describe, expect, test } from "bun:test";
import {
  cacheSynthesis,
  cachedSynthesis,
  clearSynthesisCache,
  generate,
  isModelInstalled,
  listModels,
  ollamaConfig,
  ollamaStatus,
  parseOllamaLine,
  sanitizeModelName,
} from "../server/ollama";
import { buildSynthesisPrompt, synthesisResponse } from "../server/assistant";
import { citationNumbers } from "../client/ai";
import type { SynthesisPlan } from "../server/assistant";

type FakeRequest = { method: string; path: string; body: any };
const requests: FakeRequest[] = [];
let fake: ReturnType<typeof Bun.serve> | null = null;

function startFake(behaviour: { models?: string[]; generate?: (body: any) => Response } = {}) {
  requests.length = 0;
  fake = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "POST" ? await req.json().catch(() => null) : null;
      requests.push({ method: req.method, path: url.pathname, body });
      if (url.pathname === "/api/tags") {
        const names = behaviour.models ?? ["llama3.1:8b", "qwen2.5:3b"];
        return Response.json({
          models: names.map((name) => ({
            name,
            size: 4_900_000_000,
            details: { parameter_size: "8.0B", quantization_level: "Q4_K_M" },
          })),
        });
      }
      if (url.pathname === "/api/generate") {
        if (behaviour.generate) return behaviour.generate(body);
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            // Deliberately split a JSON line across chunks.
            controller.enqueue(encoder.encode('{"model":"x","response":"The excer'));
            controller.enqueue(encoder.encode('pts differ [1].","done":false}\n'));
            controller.enqueue(
              encoder.encode('{"model":"x","response":" They both ask [2].","done":false}\n{"done":true,"eval_count":12}\n'),
            );
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return `http://127.0.0.1:${fake.port}`;
}

afterEach(() => {
  fake?.stop(true);
  fake = null;
});

const baseConfig = (url: string, extra: Record<string, string | undefined> = {}) =>
  ollamaConfig({
    UWL_OLLAMA_URL: url,
    UWL_OLLAMA_TIMEOUT_MS: "5000",
    ...extra,
  });

describe("Ollama configuration", () => {
  test("uses local, modest defaults and no external endpoint", () => {
    const config = ollamaConfig({});
    expect(config.baseUrl).toBe("http://127.0.0.1:11434");
    expect(config.enabled).toBe(true);
    expect(config.numCtx).toBe(4096);
    expect(config.numPredict).toBe(280);
    expect(config.concurrency).toBe(1);
    expect(config.keepAlive).toBe("5m");
  });

  test("reads overrides and clamps unsafe values", () => {
    const config = ollamaConfig({
      UWL_OLLAMA_URL: "http://192.168.1.9:11434/",
      UWL_OLLAMA_MODEL: "qwen2.5:3b",
      UWL_OLLAMA_ENABLED: "0",
      UWL_OLLAMA_NUM_CTX: "999999",
      UWL_OLLAMA_NUM_PREDICT: "1",
      UWL_OLLAMA_TIMEOUT_MS: "10",
      UWL_OLLAMA_CONCURRENCY: "9",
      UWL_OLLAMA_KEEP_ALIVE: "30s",
    });
    expect(config.baseUrl).toBe("http://192.168.1.9:11434");
    expect(config.model).toBe("qwen2.5:3b");
    expect(config.enabled).toBe(false);
    expect(config.numCtx).toBe(131_072);
    expect(config.numPredict).toBe(32);
    expect(config.timeoutMs).toBe(5_000);
    expect(config.concurrency).toBe(4);
    expect(config.keepAlive).toBe("30s");
  });

  test("rejects non-http base URLs rather than forwarding to them", () => {
    expect(ollamaConfig({ UWL_OLLAMA_URL: "file:///etc/passwd" }).baseUrl).toBe("http://127.0.0.1:11434");
    expect(ollamaConfig({ UWL_OLLAMA_URL: "not a url" }).baseUrl).toBe("http://127.0.0.1:11434");
  });

  test("accepts only plain model names", () => {
    expect(sanitizeModelName("llama3.1:8b")).toBe("llama3.1:8b");
    expect(sanitizeModelName("library/qwen2.5-coder:7b")).toBe("library/qwen2.5-coder:7b");
    expect(sanitizeModelName("../etc/passwd")).toBeNull();
    expect(sanitizeModelName("model\nkeep_alive:0")).toBeNull();
    expect(sanitizeModelName("")).toBeNull();
    expect(sanitizeModelName(42)).toBeNull();
  });

  test("matches installed models with and without :latest", () => {
    const models = [{ name: "llama3.1:8b" }];
    expect(isModelInstalled(models, "llama3.1:8b")).toBe(true);
    expect(isModelInstalled([{ name: "mistral:latest" }], "mistral")).toBe(true);
    expect(isModelInstalled(models, "qwen2.5:3b")).toBe(false);
  });
});

describe("Ollama status", () => {
  test("reports installed models, settings and the configured model", async () => {
    const url = startFake();
    const config = baseConfig(url, { UWL_OLLAMA_MODEL: "qwen2.5:3b" });
    const status = await ollamaStatus(config, { fresh: true });
    expect(status.available).toBe(true);
    expect(status.modelInstalled).toBe(true);
    expect(status.models.map((m) => m.name)).toEqual(["llama3.1:8b", "qwen2.5:3b"]);
    expect(status.models[0].parameterSize).toBe("8.0B");
    expect(status.settings.numPredict).toBe(280);
  });

  test("reports a missing model without pretending it is available", async () => {
    const url = startFake({ models: ["mistral:7b"] });
    const status = await ollamaStatus(baseConfig(url, { UWL_OLLAMA_MODEL: "llama3.1:8b" }), { fresh: true });
    expect(status.available).toBe(true);
    expect(status.modelInstalled).toBe(false);
  });

  test("a stopped daemon is an ordinary unavailable state with instructions", async () => {
    const status = await ollamaStatus(baseConfig("http://127.0.0.1:9"), { fresh: true });
    expect(status.available).toBe(false);
    expect(status.error).toContain("ollama serve");
    expect(status.models).toEqual([]);
  });

  test("disabled by configuration performs no network call", async () => {
    const url = startFake();
    const status = await ollamaStatus(baseConfig(url, { UWL_OLLAMA_ENABLED: "0" }), { fresh: true });
    expect(status.enabled).toBe(false);
    expect(status.available).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("caches a successful model list but never a failure", async () => {
    const url = startFake();
    await listModels(baseConfig(url), { fresh: true });
    await listModels(baseConfig(url));
    expect(requests.filter((r) => r.path === "/api/tags")).toHaveLength(1);
    const dead = "http://127.0.0.1:9";
    const first = await listModels(baseConfig(dead), { fresh: true });
    const second = await listModels(baseConfig(dead));
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
  });
});

describe("streamed generation", () => {
  test("parses NDJSON lines, including a line split across chunks", async () => {
    const url = startFake();
    const config = baseConfig(url);
    const events: any[] = [];
    for await (const event of generate(config, { model: "llama3.1:8b", system: "s", prompt: "p" })) {
      events.push(event);
    }
    const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    expect(text).toBe("The excerpts differ [1]. They both ask [2].");
    expect(events.at(-1)).toEqual({ type: "final", evalCount: 12 });
  });

  test("sends only this task's limits and a keep-alive, never a model download", async () => {
    const url = startFake();
    await Array.fromAsync(generate(baseConfig(url), { model: "llama3.1:8b", system: "sys", prompt: "question" }));
    const call = requests.find((r) => r.path === "/api/generate")!;
    expect(call.body.model).toBe("llama3.1:8b");
    expect(call.body.stream).toBe(true);
    expect(call.body.keep_alive).toBe("5m");
    expect(call.body.options).toEqual({ num_ctx: 4096, num_predict: 280, temperature: 0.2 });
    expect(call.body.system).toBe("sys");
    expect(call.body.prompt).toBe("question");
  });

  test("per-task options override the defaults", async () => {
    const url = startFake();
    await Array.fromAsync(
      generate(baseConfig(url), { model: "llama3.1:8b", system: "s", prompt: "p", options: { numPredict: 96, numCtx: 2048 } }),
    );
    const call = requests.find((r) => r.path === "/api/generate")!;
    expect(call.body.options.num_predict).toBe(96);
    expect(call.body.options.num_ctx).toBe(2048);
  });

  test("turns a missing model into an actionable message", async () => {
    const url = startFake({
      generate: () => Response.json({ error: 'model "llama9" not found, try pulling it first' }, { status: 404 }),
    });
    const events = await Array.fromAsync(generate(baseConfig(url), { model: "llama3.1:8b", system: "s", prompt: "p" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", code: "model_missing" });
    expect((events[0] as any).message).toContain("ollama pull");
  });

  test("a mid-stream error keeps the text already received", async () => {
    const url = startFake({
      generate: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('{"response":"Partial text","done":false}\n'));
              controller.enqueue(encoder.encode('{"error":"out of memory"}\n'));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    });
    const events = await Array.fromAsync(generate(baseConfig(url), { model: "llama3.1:8b", system: "s", prompt: "p" }));
    expect(events[0]).toEqual({ type: "delta", text: "Partial text" });
    expect(events[1]).toMatchObject({ type: "error", code: "model_error" });
  });

  test("an abort stops the stream instead of reporting a failure", async () => {
    const url = startFake({
      generate: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('{"response":"one","done":false}\n'));
              // Never closes: the reader must abort.
            },
          }),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    });
    const controller = new AbortController();
    const seen: string[] = [];
    for await (const event of generate(baseConfig(url), {
      model: "llama3.1:8b",
      system: "s",
      prompt: "p",
      signal: controller.signal,
    })) {
      if (event.type === "delta") {
        seen.push(event.text);
        controller.abort();
      } else {
        seen.push(event.type);
      }
    }
    expect(seen).toEqual(["one"]);
  });

  test("an answer with no text is an error, not an empty success", async () => {
    const url = startFake({
      generate: () =>
        new Response(new ReadableStream({ start: (c) => c.close() }), {
          headers: { "content-type": "application/x-ndjson" },
        }),
    });
    const events = await Array.fromAsync(generate(baseConfig(url), { model: "x", system: "s", prompt: "p" }));
    expect(events[0]).toMatchObject({ type: "error", code: "empty" });
  });

  test("parses the documented response shapes", () => {
    const config = ollamaConfig({});
    expect(parseOllamaLine('{"response":"a","done":false}', config)).toEqual({ type: "delta", text: "a" });
    expect(parseOllamaLine('{"done":true,"eval_count":7}', config)).toEqual({ type: "final", evalCount: 7 });
    expect(parseOllamaLine('{"error":"boom"}', config)).toMatchObject({ type: "error", code: "model_error" });
    expect(parseOllamaLine("not json", config)).toEqual({ type: "ignore" });
    expect(parseOllamaLine('{"done":false}', config)).toEqual({ type: "ignore" });
  });
});

describe("grounded synthesis prompt", () => {
  const quotation = (n: number, title: string, tradition: string, quote: string) => ({
    passageId: n,
    quote,
    work: { title, slug: title.toLowerCase().replace(/\s+/g, "-"), dateDisplay: "c. 400 BCE" },
    label: `${n}:1`,
    tradition: { name: tradition },
    edition: { title: "A translation", translator: "A Translator" },
    link: `/read/${n}`,
  });

  test("numbers the excerpts and supplies only their metadata", () => {
    const { system, prompt, sources } = buildSynthesisPrompt("What is duty?", [
      quotation(1, "Bhagavad Gita", "Hindu", "Do your work."),
      quotation(2, "Analects", "Confucian", "Ritual matters."),
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ n: 1, workTitle: "Bhagavad Gita", tradition: "Hindu", reference: "1:1" });
    expect(prompt).toContain('[1] Bhagavad Gita 1:1 — Hindu — c. 400 BCE — A translation, trans. A Translator');
    expect(prompt).toContain('"Do your work."');
    expect(prompt).toContain("Question: What is duty?");
    expect(system).toContain("only from the numbered excerpts");
    expect(system).toContain("[2]");
  });

  test("citation markers expand single, grouped and ranged forms", () => {
    expect(citationNumbers("3")).toEqual([3]);
    expect(citationNumbers("3, 4")).toEqual([3, 4]);
    expect(citationNumbers("3–5")).toEqual([3, 4, 5]);
    expect(citationNumbers("5-3")).toEqual([5]);
    expect(citationNumbers("1, 3–4")).toEqual([1, 3, 4]);
    expect(citationNumbers("2, 2")).toEqual([2]);
    expect(citationNumbers("3, text")).toEqual([3]);
    expect(citationNumbers("none")).toEqual([]);
    // A wide range is not expanded into a wall of numbers.
    expect(citationNumbers("1–30")).toEqual([1]);
  });

  test("empty-question whitespace is collapsed before it reaches the model", () => {
    const { prompt } = buildSynthesisPrompt("  What   is\n duty?  ", [quotation(1, "Work", "T", "Text")]);
    expect(prompt.startsWith("Question: What is duty?")).toBe(true);
  });
});

describe("synthesis event stream", () => {
  function planFor(url: string, cached: string | null = null): SynthesisPlan {
    const config = baseConfig(url);
    return {
      question: "What is duty?",
      model: "llama3.1:8b",
      system: "rules",
      prompt: "excerpts",
      sources: [
        {
          n: 1,
          passageId: 10,
          workTitle: "Bhagavad Gita",
          workSlug: "gita",
          reference: "2:47",
          tradition: "Hindu",
          edition: "A translation",
          translator: null,
          link: "/read/gita?ref=2.47",
        },
      ],
      cached,
      config,
    };
  }

  async function readEvents(res: Response): Promise<any[]> {
    const text = await res.text();
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  test("emits meta, deltas and a done event and caches the result", async () => {
    clearSynthesisCache();
    const url = startFake();
    const res = synthesisResponse(planFor(url));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const events = await readEvents(res);
    expect(events[0].type).toBe("meta");
    expect(events[0].sources).toHaveLength(1);
    expect(events[0].disclosure).toContain("on this machine");
    expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).toContain("excerpts differ");
    expect(events.at(-1)).toMatchObject({ type: "done", model: "llama3.1:8b", cached: false });
    expect(cachedSynthesis("llama3.1:8b", "What is duty?")).toContain("excerpts differ");
  });

  test("repeats a cached answer without contacting the model", async () => {
    clearSynthesisCache();
    cacheSynthesis("llama3.1:8b", "What is duty?", "Cached comparison [1].");
    const url = startFake();
    const events = await readEvents(synthesisResponse(planFor(url, "Cached comparison [1].")));
    expect(requests.filter((r) => r.path === "/api/generate")).toHaveLength(0);
    expect(events[0].cached).toBe(true);
    expect(events[1]).toEqual({ type: "delta", text: "Cached comparison [1]." });
    expect(events.at(-1)).toMatchObject({ type: "done", cached: true });
  });

  test("a model failure ends the stream with an error and keeps partial text", async () => {
    clearSynthesisCache();
    const url = startFake({
      generate: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('{"response":"Unfinished","done":false}\n'));
              controller.enqueue(encoder.encode('{"error":"context exhausted"}\n'));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    });
    const events = await readEvents(synthesisResponse(planFor(url)));
    expect(events[1]).toEqual({ type: "delta", text: "Unfinished" });
    expect(events.at(-1)).toMatchObject({ type: "error", partial: true });
    expect(cachedSynthesis("llama3.1:8b", "What is duty?")).toBeNull();
  });

  test("a busy machine refuses rather than starting a second generation", async () => {
    clearSynthesisCache();
    const url = startFake({
      generate: () =>
        new Response(new ReadableStream({ start: () => {} }), {
          headers: { "content-type": "application/x-ndjson" },
        }),
    });
    const config = baseConfig(url, { UWL_OLLAMA_CONCURRENCY: "1" });
    const first = synthesisResponse({ ...planFor(url), config });
    // Consume the first stream only enough to hold the slot.
    const reader = first.body!.getReader();
    await reader.read();
    const events = await readEvents(synthesisResponse({ ...planFor(url), config }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "ai_busy" });
    await reader.cancel();
  });
});
