import { readFileSync } from "node:fs";
import { getStreamChapter } from "../../server/stream";

const slugs = ["udana", "therigatha", "buddhacarita", "bodhicaryavatara", "apostolic-fathers", "dionysius-areopagite", "anselm", "cloud-of-unknowing", "imitation-of-christ"];
for (const slug of slugs) {
  const work = JSON.parse(readFileSync(`data/corpus/works/${slug}.json`, "utf8"));
  const picks = [0, Math.floor(work.chapters.length / 2), work.chapters.length - 1];
  for (const index of picks) {
    const chapter = work.chapters[index];
    const expected = work.passages.filter((p: any) => p.chapterRef === chapter.ref).length;
    const result = await getStreamChapter(slug, chapter, expected);
    const edition = result?.editions[0];
    const segments = edition?.segments ?? [];
    const ok = segments.length === expected;
    console.log(`${ok ? "OK " : "BAD"} ${slug} [${chapter.ref}] ${chapter.label.slice(0, 48)} ${segments.length}/${expected}`);
    if (!ok || process.env.VERBOSE) console.log("    first:", (segments[0] ?? edition?.error ?? "").slice(0, 110), "| last:", (segments.at(-1) ?? "").slice(0, 90));
  }
}
