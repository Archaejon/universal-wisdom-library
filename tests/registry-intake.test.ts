import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRegistrySource } from "../server/registry";

const directory = mkdtempSync(join(tmpdir(), "uwl-registry-"));
const file = join(directory, "sources.json");
const original = {
  version: "1.6.0",
  note: "Test registry.",
  sources: [
    {
      source_id: "existing-source",
      source_name: "An existing source",
      traditions_covered: ["judaism"],
      languages: ["en"],
      content_types: ["primary_text"],
      ingestion_status: "active",
      approval_status: "approved",
      priority: 1,
    },
  ],
};
writeFileSync(file, `${JSON.stringify(original, null, 2)}\n`, "utf8");

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("registry intake file", () => {
  test("appends a discovery without touching the existing entries", () => {
    const entry = {
      source_id: "new-source",
      source_name: "A newly found source",
      base_url: "https://example.org/texts",
      organisation: "Example",
      traditions_covered: ["christianity"],
      schools_covered: [],
      languages: ["grc"],
      source_type: "digital library",
      content_types: ["primary_text"],
      api_documentation_url: "",
      download_url: "",
      access_method: "web pages",
      licence_url: "",
      licence_status: "not_verified",
      commercial_use_allowed: null,
      redistribution_allowed: null,
      attribution_requirements: "",
      authentication_required: null,
      rate_limits: "",
      ingestion_status: "discovered",
      last_verified_at: null,
      source_reliability_notes: "Found through the intake form.",
      editorial_notes: "",
      priority: 2,
      approval_status: "pending",
      review_note: "Recorded through the registry intake form.",
    };
    expect(appendRegistrySource(entry, file)).toBe(true);

    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written.version).toBe("1.6.0");
    expect(written.note).toBe("Test registry.");
    expect(written.sources).toHaveLength(2);
    expect(written.sources[0]).toEqual(original.sources[0]);
    expect(written.sources[1]).toEqual(entry);
    // The pipeline reads ingestion_status, approval_status and priority by these
    // exact names; a discovery must not arrive pre-approved.
    expect(written.sources[1].approval_status).toBe("pending");
    expect(written.sources[1].ingestion_status).toBe("discovered");
  });

  test("refuses an ID that is already in the file", () => {
    const before = readFileSync(file, "utf8");
    expect(appendRegistrySource({ source_id: "existing-source", source_name: "Duplicate" }, file)).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("keeps the file parseable and newline-terminated", () => {
    const text = readFileSync(file, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).toContain('\n  "sources": [');
  });
});
