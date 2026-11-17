import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const register = JSON.parse(readFileSync(join(ROOT, "data/registry/acquisition.json"), "utf8")) as {
  targets: {
    slug: string;
    title: string;
    status: string;
    languages: string[];
    source_leads: { source: string; url: string; note: string }[];
    rights_note: string;
  }[];
};

const STATUSES = new Set(["wanted", "located", "rights_blocked", "imported"]);

describe("acquisition register", () => {
  test("has unique slugs and the required fields", () => {
    expect(register.targets.length).toBeGreaterThan(0);
    const slugs = new Set<string>();
    for (const target of register.targets) {
      expect(target.slug.length).toBeGreaterThan(0);
      expect(target.title.length).toBeGreaterThan(0);
      expect(STATUSES.has(target.status)).toBe(true);
      expect(target.languages.length).toBeGreaterThan(0);
      expect(target.rights_note.length).toBeGreaterThan(20);
      expect(slugs.has(target.slug)).toBe(false);
      slugs.add(target.slug);
    }
  });

  test("every lead names a source and an HTTPS address", () => {
    for (const target of register.targets) {
      expect(target.source_leads.length).toBeGreaterThan(0);
      for (const lead of target.source_leads) {
        expect(lead.source.length).toBeGreaterThan(0);
        expect(lead.url.startsWith("https://")).toBe(true);
        expect(lead.note.length).toBeGreaterThan(10);
      }
    }
  });
});
