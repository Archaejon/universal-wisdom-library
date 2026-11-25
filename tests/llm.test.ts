import { describe, expect, test } from "bun:test";
import { extractJson, Gate, BusyError, CancelledError } from "../server/llm";
import { batchPieces, chunkText, type Piece } from "../server/translate";
import { aiSettings, publicSettings, saveAiSettings } from "../server/ai-settings";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("the model gate", () => {
  test("one at a time, a short queue, then refusal", async () => {
    const gate = new Gate(1, 1);
    const first = await gate.acquire();
    let queuedAt = 0;
    const second = gate.acquire(undefined, (p) => (queuedAt = p));
    expect(queuedAt).toBe(1);
    await expect(gate.acquire()).rejects.toBeInstanceOf(BusyError);
    first();
    const release = await second;
    expect(gate.active).toBe(1);
    release();
    release(); // releasing twice frees only one slot
    expect(gate.active).toBe(0);
  });

  test("a cancelled request leaves the queue", async () => {
    const gate = new Gate(1, 2);
    const first = await gate.acquire();
    const controller = new AbortController();
    const waiting = gate.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(CancelledError);
    expect(gate.queued).toBe(0);
    first();
  });
});

describe("model JSON", () => {
  test("parses fenced or chatty answers", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"translations":[]} hope that helps')).toEqual({ translations: [] });
    expect(extractJson("no json")).toBeNull();
  });
});

describe("translation batches", () => {
  test("long passages split at sentence boundaries under the limit", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = chunkText(text, 120);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 120)).toBe(true);
    expect(parts.join(" ")).toBe(text);
  });

  test("batches respect both size and count", () => {
    const piece = (id: string, n: number): Piece => ({ id, reference: id, part: 0, parts: 1, text: "x".repeat(n) });
    const batches = batchPieces([piece("1", 300), piece("2", 300), piece("3", 300), piece("4", 10), piece("5", 10)], 650, 3);
    expect(batches.map((b) => b.map((p) => p.id))).toEqual([["1", "2"], ["3", "4", "5"]]);
  });
});

describe("AI settings", () => {
  test("default to the local model, keep the key out of what a browser sees, and store it privately", () => {
    const dir = mkdtempSync(join(tmpdir(), "uwl-ai-"));
    process.env.UWL_AI_SETTINGS_FILE = join(dir, "ai.json");
    try {
      expect(aiSettings({}).provider).toBe("local");
      expect(saveAiSettings({ provider: "cloud", preset: "groq", apiKey: "gsk_test_1234abcd" })).toEqual({ ok: true });
      const seen = publicSettings(aiSettings({}));
      expect(seen.provider).toBe("cloud");
      expect(seen.baseUrl).toBe("https://api.groq.com/openai/v1");
      expect(seen.hasKey).toBe(true);
      expect(seen.keyHint).toBe("…abcd");
      expect(JSON.stringify(seen)).not.toContain("gsk_test");
      expect(statSync(process.env.UWL_AI_SETTINGS_FILE).mode & 0o777).toBe(0o600);
      // An empty key keeps the stored one; clearKey removes it.
      saveAiSettings({ apiKey: "" });
      expect(aiSettings({}).apiKey).toBe("gsk_test_1234abcd");
      saveAiSettings({ clearKey: true });
      expect(JSON.parse(readFileSync(process.env.UWL_AI_SETTINGS_FILE, "utf8")).apiKey).toBe("");
    } finally {
      delete process.env.UWL_AI_SETTINGS_FILE;
    }
  });

  test("refuses to send a key over plain http to another machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "uwl-ai-"));
    process.env.UWL_AI_SETTINGS_FILE = join(dir, "ai.json");
    try {
      expect(saveAiSettings({ baseUrl: "http://example.com/v1" }).ok).toBe(false);
      expect(saveAiSettings({ baseUrl: "http://127.0.0.1:11434/v1" }).ok).toBe(true);
    } finally {
      delete process.env.UWL_AI_SETTINGS_FILE;
    }
  });
});

describe("translation answers", () => {
  test("a copy of the Hebrew is not accepted as English", async () => {
    const { isEnglishLike } = await import("../server/translate");
    expect(isEnglishLike("… תיקון חצות הזהיר לנו כ", "תיקון חצות הזהיר לנו כל")).toBe(false);
    expect(isEnglishLike("Concerning the midnight lament (Tikkun Chatzot)", "תיקון חצות")).toBe(true);
    expect(isEnglishLike("Anything", "Latin source")).toBe(true);
  });
});

describe("who may change the AI settings", () => {
  test("only a request straight from this machine counts as local", async () => {
    const { isLoopbackRequest, setPeerAddress } = await import("../server/util");
    const local = new Request("http://127.0.0.1/api/ai/settings");
    setPeerAddress(local, "127.0.0.1");
    expect(isLoopbackRequest(local)).toBe(true);
    const proxied = new Request("http://127.0.0.1/api/ai/settings", { headers: { "x-forwarded-for": "203.0.113.9" } });
    setPeerAddress(proxied, "127.0.0.1");
    expect(isLoopbackRequest(proxied)).toBe(false);
    const remote = new Request("http://example.org/api/ai/settings");
    setPeerAddress(remote, "203.0.113.9");
    expect(isLoopbackRequest(remote)).toBe(false);
    expect(isLoopbackRequest(new Request("http://x/"))).toBe(false);
  });
});
