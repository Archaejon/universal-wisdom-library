import { getDb } from "./db";
import type { User } from "./auth";
import { getStreamChapter, providerLabel, streamWork, type StreamedChapter } from "./stream";

type Row = Record<string, any>;
type ChapterOverlay = {
  chapter: StreamedChapter;
  /** passage reference -> edition slug -> text */
  texts: Map<string, Map<string, string>>;
};

function editionRow(r: Row) {
  return {
    id: r.edition_id,
    slug: r.edition_slug,
    title: r.edition_title,
    editionType: r.edition_type,
    translator: r.translator,
    publisher: r.publisher,
    publicationYear: r.publication_year,
    structureScheme: r.structure_scheme,
    rightsStatus: r.rights_status,
    notes: r.edition_notes,
    isSample: !!r.is_sample,
    language: {
      code: r.language_code,
      name: r.language_name,
      nativeName: r.language_native,
      direction: r.direction,
    },
    source: r.source_slug
      ? { slug: r.source_slug, name: r.source_name, provider: r.source_provider, url: r.source_url, status: r.source_status, accessNotes: r.access_notes, retrievedAt: r.retrieved_at }
      : null,
    license: r.license_code
      ? {
          code: r.license_code,
          name: r.license_name,
          url: r.license_url,
          redistributionAllowed: !!r.redistribution_allowed,
          attributionRequired: !!r.attribution_required,
          shareAlike: !!r.share_alike,
          notes: r.license_notes,
        }
      : null,
    attribution: r.attribution_text,
  };
}

const TEXT_SELECT = `
  SELECT pt.passage_id, pt.content, pt.word_count, e.id AS edition_id, e.slug AS edition_slug, e.title AS edition_title,
         e.edition_type, e.translator, e.publisher, e.publication_year, e.structure_scheme, e.rights_status,
         e.attribution_text, e.notes AS edition_notes, e.is_sample,
         l.code AS language_code, l.name AS language_name, l.native_name AS language_native, l.direction,
         so.slug AS source_slug, so.name AS source_name, so.provider AS source_provider, so.url AS source_url,
         so.status AS source_status, so.access_notes, so.retrieved_at,
         li.code AS license_code, li.name AS license_name, li.url AS license_url,
         li.redistribution_allowed, li.attribution_required, li.share_alike, li.notes AS license_notes
  FROM passage_texts pt
  JOIN editions e ON e.id = pt.edition_id
  JOIN languages l ON l.code = e.language_code
  LEFT JOIN sources so ON so.id = e.source_id
  LEFT JOIN licenses li ON li.id = e.license_id
`;

function getTexts(passageId: number) {
  return (getDb().query(`${TEXT_SELECT} WHERE pt.passage_id = ? ORDER BY e.edition_type DESC, l.code`).all(passageId) as Row[]).map(
    (r) => ({ ...editionRow(r), text: r.content, wordCount: r.word_count }),
  );
}

// Edition metadata for a work, without its text. A streamed work has these
// rows but no passage_texts: the text arrives from the hosting project.
const EDITIONS_SELECT = `
  SELECT e.id AS edition_id, e.slug AS edition_slug, e.title AS edition_title,
         e.edition_type, e.translator, e.publisher, e.publication_year, e.structure_scheme, e.rights_status,
         e.attribution_text, e.notes AS edition_notes, e.is_sample,
         l.code AS language_code, l.name AS language_name, l.native_name AS language_native, l.direction,
         so.slug AS source_slug, so.name AS source_name, so.provider AS source_provider, so.url AS source_url,
         so.status AS source_status, so.access_notes, so.retrieved_at,
         li.code AS license_code, li.name AS license_name, li.url AS license_url,
         li.redistribution_allowed, li.attribution_required, li.share_alike, li.notes AS license_notes
  FROM editions e
  JOIN languages l ON l.code = e.language_code
  LEFT JOIN sources so ON so.id = e.source_id
  LEFT JOIN licenses li ON li.id = e.license_id
  WHERE e.work_id = ?
`;

function workEditions(workId: number) {
  return getDb().query(`${EDITIONS_SELECT} ORDER BY e.edition_type DESC, l.code`).all(workId) as Row[];
}

function streamedText(chapter: StreamedChapter | undefined, reference: string, slug: string) {
  if (!chapter) return "";
  const edition = chapter.editions.find((e) => e.slug === slug);
  const index = chapter.aligned ? Number(reference.split(".").pop()) - 1 : -1;
  if (!edition || index < 0) return "";
  return edition.segments[index] ?? "";
}

// Merge local copies with streamed text. For a streamed work every edition is
// built from catalogue metadata plus the upstream segments for this chapter.
function textsFor(
  workId: number,
  passageId: number,
  reference: string,
  overlay?: ChapterOverlay,
) {
  if (!overlay) return getTexts(passageId);
  const local = new Map(getTexts(passageId).map((t) => [t.slug, t]));
  const merged: any[] = [];
  for (const row of workEditions(workId)) {
    if (local.has(row.edition_slug)) {
      merged.push(local.get(row.edition_slug));
      continue;
    }
    const served = overlay.chapter.editions.find((e) => e.slug === row.edition_slug);
    const text = overlay.texts.get(reference)?.get(row.edition_slug) ?? "";
    if (!text) continue;
    const edition = editionRow(row);
    // Sefaria identifies a pinned edition by its version title; if it served a
    // different one, say so rather than mislabel the text. The synthetic
    // editions for SuttaCentral and AlQuran Cloud take their title from the
    // catalogue, which is already the human-readable name.
    if (
      overlay.chapter.provider === "sefaria" &&
      served?.versionTitle &&
      served.versionTitle !== row.edition_title
    ) {
      edition.title = served.versionTitle;
      edition.attribution = `Live edition served by ${providerLabel(overlay.chapter.provider)}: ${served.versionTitle}`;
    }
    if (served?.license) edition.rightsStatus = served.license;
    merged.push({ ...edition, text, wordCount: text.split(/\s+/).filter(Boolean).length });
  }
  return merged;
}

function buildOverlay(chapter: StreamedChapter, passages: Row[]): ChapterOverlay {
  const texts = new Map<string, Map<string, string>>();
  for (const edition of chapter.editions) {
    if (!edition.segments.length) continue;
    passages.forEach((passage, index) => {
      const text = edition.segments[index];
      if (!text) return;
      if (!texts.has(passage.reference)) texts.set(passage.reference, new Map());
      texts.get(passage.reference)!.set(edition.slug, text);
    });
  }
  return { chapter, texts };
}

function streamingMeta(overlay: ChapterOverlay | undefined) {
  if (!overlay) return null;
  const { chapter } = overlay;
  return {
    provider: chapter.provider,
    providerLabel: providerLabel(chapter.provider),
    upstream: chapter.upstream,
    upstreamRef: chapter.upstreamRef,
    upstreamUrl: chapter.upstreamUrl,
    fetchedAt: chapter.fetchedAt,
    cached: chapter.cached,
    aligned: chapter.aligned,
    notice: chapter.notice,
  };
}

function getCommentary(passageId: number) {
  const rows = getDb()
    .query(
      `SELECT c.*, l.name AS language_name, so.name AS source_name, li.name AS license_name, li.code AS license_code
       FROM commentaries c LEFT JOIN languages l ON l.code = c.language_code
       LEFT JOIN sources so ON so.id = c.source_id LEFT JOIN licenses li ON li.id = c.license_id
       WHERE c.passage_id = ? AND c.review_status = 'published'
       ORDER BY CASE c.content_type WHEN 'traditional' THEN 0 WHEN 'academic' THEN 1 WHEN 'modern_religious' THEN 2 WHEN 'editorial' THEN 3 ELSE 4 END, c.id`,
    )
    .all(passageId) as Row[];
  return rows.map((c) => ({
    id: c.id,
    contentType: c.content_type,
    author: c.author_display,
    interpretiveTradition: c.interpretive_tradition,
    dateDisplay: c.date_display,
    content: c.content,
    isQuotation: !!c.is_quotation,
    provenanceNote: c.provenance_note,
    language: c.language_name,
    source: c.source_name,
    license: { code: c.license_code, name: c.license_name },
    isSample: !!c.is_sample,
  }));
}

function getThemes(passageId: number) {
  return getDb()
    .query(
      `SELECT th.slug, th.name, pt.note, pt.relevance FROM passage_themes pt JOIN themes th ON th.id = pt.theme_id
       WHERE pt.passage_id = ? ORDER BY th.sort_order`,
    )
    .all(passageId) as Row[];
}

function getRelationships(passageId: number) {
  const rows = getDb()
    .query(
      `SELECT r.*, fp.reference AS from_reference, fp.label AS from_label, fw.slug AS from_work_slug, fw.title AS from_work_title,
              ft.slug AS from_tradition_slug, ft.name AS from_tradition_name,
              tp.reference AS to_reference, tp.label AS to_label, tw.slug AS to_work_slug, tw.title AS to_work_title,
              tt.slug AS to_tradition_slug, tt.name AS to_tradition_name
       FROM text_relationships r
       LEFT JOIN passages fp ON fp.id = r.from_passage_id LEFT JOIN works fw ON fw.id = r.from_work_id
       LEFT JOIN traditions ft ON ft.id = fw.tradition_id
       LEFT JOIN passages tp ON tp.id = r.to_passage_id LEFT JOIN works tw ON tw.id = r.to_work_id
       LEFT JOIN traditions tt ON tt.id = tw.tradition_id
       WHERE (r.from_passage_id = ? OR r.to_passage_id = ?) AND r.review_status = 'published'
       ORDER BY CASE r.relationship_type WHEN 'citation' THEN 0 WHEN 'quotation' THEN 1 WHEN 'historical_influence' THEN 2
                WHEN 'parallel_narrative' THEN 3 WHEN 'translation' THEN 4 WHEN 'shared_theme' THEN 5 ELSE 6 END, r.id`,
    )
    .all(passageId, passageId) as Row[];
  return rows.map((r) => {
    const otherIsTo = r.from_passage_id === passageId;
    return {
      id: r.id,
      type: r.relationship_type,
      confidence: r.confidence,
      description: r.description,
      evidence: r.evidence,
      other: otherIsTo
        ? { work: r.to_work_slug, workTitle: r.to_work_title, reference: r.to_reference, label: r.to_label, tradition: r.to_tradition_name }
        : { work: r.from_work_slug, workTitle: r.from_work_title, reference: r.from_reference, label: r.from_label, tradition: r.from_tradition_name },
    };
  });
}

// The host did not answer. Say so rather than showing an empty page or
// substituting text from somewhere else.
function streamUnavailable(header: any, stream: { provider: string; upstream: string }) {
  return {
    type: "stream_unavailable" as const,
    work: header,
    provider: providerLabel(stream.provider),
    upstream: stream.upstream,
    message: `${providerLabel(stream.provider)} did not return this chapter. The library does not hold a local copy, so there is nothing to fall back to.`,
  };
}

function workHeader(workId: number) {
  return getDb()
    .query(
      `SELECT w.slug, w.title, w.original_title, w.transliteration, w.date_display, w.category, w.subcategory,
              COALESCE((SELECT p.ref_scheme FROM passages p WHERE p.work_id = w.id LIMIT 1), '') AS ref_scheme,
              w.availability_note, w.featured, w.featured_note,
              t.slug AS tradition_slug, t.name AS tradition_name, s.name AS school_name,
              a.name AS author_name, a.is_attributed AS author_attributed
       FROM works w JOIN traditions t ON t.id = w.tradition_id
       LEFT JOIN schools s ON s.id = w.school_id LEFT JOIN authors a ON a.id = w.author_id WHERE w.id = ?`,
    )
    .get(workId);
}

export async function getReader(workSlug: string, rawRef: string | undefined, versionSlug: string | undefined, user: User | null) {
  const db = getDb();
  const work = db.query("SELECT id FROM works WHERE slug = ?").get(workSlug) as Row | null;
  if (!work) return null;
  const header = workHeader(work.id);
  const allPassages = db
    .query("SELECT id, reference, label, chapter_ref, sort_order FROM passages WHERE work_id = ? ORDER BY sort_order")
    .all(work.id) as Row[];
  if (allPassages.length === 0) {
    return {
      type: "unavailable" as const,
      work: header,
      message:
        (header as Row).availability_note ||
        "No permitted edition of this work has been imported. The catalogue record is shown without text.",
    };
  }
  const normalised = (rawRef ?? "").replace(/:/g, ".").trim();
  const exact = allPassages.find((p) => p.reference === normalised);
  const chapters = [...new Set(allPassages.map((p) => p.chapter_ref ?? "1"))];
  const chapterLabels = new Map<string, string>(
    (db
      .query(
        "SELECT reference, label FROM text_units WHERE edition_id IN (SELECT id FROM editions WHERE work_id = ?) ORDER BY edition_id, sequence",
      )
      .all(work.id) as Row[]).map((row) => [String(row.reference), String(row.label)]),
  );
  const chapterList = chapters.map((c) => ({ ref: c, label: chapterLabels.get(c) ?? `Chapter ${c}` }));
  const chapterRef = exact ? exact.chapter_ref : normalised && chapters.includes(normalised) ? normalised : null;
  const stream = streamWork(workSlug);
  const overlays = new Map<string, ChapterOverlay | null>();

  // A streamed work fetches each chapter from its host at most once per
  // request; the server-wide cache in stream.ts absorbs repeat readers.
  async function loadChapter(ref: string): Promise<ChapterOverlay | null> {
    if (!stream) return null;
    if (overlays.has(ref)) return overlays.get(ref) ?? null;
    const rows = allPassages.filter((p) => (p.chapter_ref ?? "1") === ref);
    const fetched = await getStreamChapter(
      workSlug,
      { ref, label: chapterLabels.get(ref) ?? `Chapter ${ref}`, labels: rows.map((p) => String(p.label)) },
      rows.length,
    );
    const overlay = fetched ? buildOverlay(fetched, rows) : null;
    overlays.set(ref, overlay);
    return overlay;
  }

  const chapterView = async (ref: string) => {
    const chapterRows = allPassages.filter((p) => (p.chapter_ref ?? "1") === ref);
    const chapterIdx = chapters.indexOf(ref);
    const overlay = await loadChapter(ref);
    if (stream && !overlay) return streamUnavailable(header, stream);
    // A provider may address only part of a chapter: Heritage reads verses one
    // at a time against a metered key, so Śānti Parva's 12,866 verses are read
    // 120 at a time. Listing the verses it did not read would offer rows that can
    // never carry text and turn one page into megabytes of them; the chapter's
    // notice says what the chapter holds and where the rest is read.
    const served = overlay?.chapter.servedVerses;
    const rows = served && served < chapterRows.length ? chapterRows.slice(0, served) : chapterRows;
    // Every edition that supplies text somewhere in the chapter, for the
    // reader's edition choice. Collected while the rows are built.
    const editions = new Map<string, Record<string, any>>();
    const passages = rows.map((p) => {
      const texts = textsFor(work.id, p.id, p.reference, overlay ?? undefined);
      for (const t of texts) {
        if (!editions.has(t.slug)) {
          const { text: _text, ...edition } = t;
          editions.set(t.slug, edition);
        }
      }
      const chosen = versionSlug ? texts.find((t) => t.slug === versionSlug) : undefined;
      const preferred = chosen ?? texts.find((t) => t.language.code === "en") ?? texts[0];
      // Original-language text sits beside the translation when the
      // holding project supplies both. Each pane keeps its own edition and
      // source, so a verse is never shown without its attribution. A chosen
      // edition (?version=) takes the side it belongs to.
      const original =
        (chosen?.editionType === "original" ? chosen : undefined) ??
        texts.find((t) => t.editionType === "original") ??
        texts.find((t) => t.language.code !== "en") ??
        null;
      const translation =
        (chosen && chosen.editionType !== "original" && chosen.slug !== original?.slug ? chosen : undefined) ??
        texts.find((t) => t.editionType === "translation" && t.language.code === "en") ??
        texts.find((t) => t.language.code === "en") ??
        null;
      const parallel = !!original && !!translation && original.slug !== translation.slug;
      return {
        id: p.id,
        reference: p.reference,
        label: p.label,
        text: preferred?.text ?? "",
        edition: preferred ?? null,
        editions: texts.length,
        original,
        translation,
        parallel,
      };
    });
    return {
      type: "chapter" as const,
      work: header,
      chapter: {
        ref,
        label: chapterLabels.get(ref) ?? `Chapter ${ref}`,
        total: rows.length,
        passages,
      },
      chapters: chapterList,
      navigation: {
        prev: chapterIdx > 0 ? { type: "chapter", ref: chapters[chapterIdx - 1] } : null,
        next: chapterIdx < chapters.length - 1 ? { type: "chapter", ref: chapters[chapterIdx + 1] } : null,
      },
      versions: [...editions.values()],
      streaming: streamingMeta(overlay ?? undefined),
      parallelNote: "Original and translation are separate editions from the holding project; each pane names its own source.",
    };
  };

  // Opening a work without a reference should show its first chapter, not a
  // single isolated verse. A single-passage work still falls through below.
  if (!exact && (chapterRef || !normalised) && allPassages.length > 1) {
    return await chapterView(chapterRef ?? chapters[0]);
  }

  const passage = exact ?? allPassages[0];
  if (!exact && normalised) {
    return {
      type: "not_found" as const,
      work: header,
      message: `The reference “${rawRef}” was not found in ${(header as Row).title}.`,
      suggestions: allPassages.slice(0, 6).map((p) => ({ reference: p.reference, label: p.label })),
    };
  }
  const idx = allPassages.findIndex((p) => p.id === passage.id);
  const overlay = await loadChapter(passage.chapter_ref ?? "1");
  if (stream && !overlay) return streamUnavailable(header, stream);
  const texts = textsFor(work.id, passage.id, passage.reference, overlay ?? undefined);
  const current =
    texts.find((t) => t.slug === versionSlug) ??
    texts.find((t) => t.language.code === "en") ??
    texts.find((t) => t.editionType === "original") ??
    texts[0];
  const chapterPassages = allPassages.filter((p) => (p.chapter_ref ?? "1") === (passage.chapter_ref ?? "1"));
  const chapterIdx = chapters.indexOf(passage.chapter_ref ?? "1");

  let viewer: any = null;
  if (user) {
    const bookmark = db.query("SELECT id FROM bookmarks WHERE user_id = ? AND passage_id = ?").get(user.id, passage.id);
    const notes = db
      .query("SELECT id, body, is_private, updated_at FROM notes WHERE user_id = ? AND passage_id = ? ORDER BY updated_at DESC")
      .all(user.id, passage.id);
    const progress = db.query("SELECT percent, last_viewed_at FROM reading_progress WHERE user_id = ? AND work_id = ?").get(user.id, work.id);
    viewer = { bookmarked: !!bookmark, notes, progress: progress ?? null, authenticated: true };
  }

  return {
    type: "passage" as const,
    work: header,
    passage: { id: passage.id, reference: passage.reference, label: passage.label, chapterRef: passage.chapter_ref, sortOrder: passage.sort_order },
    versions: texts,
    currentVersion: current?.slug ?? null,
    streaming: streamingMeta(overlay ?? undefined),
    commentary: getCommentary(passage.id),
    themes: getThemes(passage.id),
    relationships: getRelationships(passage.id),
    chapter: {
      ref: passage.chapter_ref ?? "1",      label: chapterLabels.get(passage.chapter_ref ?? "1") ?? `Chapter ${passage.chapter_ref ?? "1"}`,
      total: chapterPassages.length,
        passages: chapterPassages.map((p) => ({ reference: p.reference, label: p.label, current: p.id === passage.id })),
      },      chapters: chapterList,
      navigation: {
        prev: idx > 0 ? { reference: allPassages[idx - 1].reference, label: allPassages[idx - 1].label } : null,
      next: idx < allPassages.length - 1 ? { reference: allPassages[idx + 1].reference, label: allPassages[idx + 1].label } : null,
      prevChapter: chapterIdx > 0 ? { ref: chapters[chapterIdx - 1] } : null,
      nextChapter: chapterIdx < chapters.length - 1 ? { ref: chapters[chapterIdx + 1] } : null,
    },
    viewer,
  };
}

export function resolvePassageKeys(keys: string[]) {
  const db = getDb();
  const out: { passageId: number; work: string; reference: string; label: string; workTitle: string; tradition: string; text: string; edition: any }[] = [];
  for (const key of keys) {
    const [workSlug, ...rest] = key.split(":");
    const reference = rest.join(":").replace(/:/g, ".");
    const row = db
      .query(
        `SELECT p.id, p.reference, p.label, w.slug AS work_slug, w.title AS work_title, t.name AS tradition
         FROM passages p JOIN works w ON w.id = p.work_id JOIN traditions t ON t.id = w.tradition_id
         WHERE w.slug = ? AND p.reference = ?`,
      )
      .get(workSlug, reference) as Row | null;
    if (!row) continue;
    const texts = getTexts(row.id);
    const preferred = texts.find((t) => t.language.code === "en") ?? texts[0];
    out.push({
      passageId: row.id,
      work: row.work_slug,
      reference: row.reference,
      label: row.label,
      workTitle: row.work_title,
      tradition: row.tradition,
      text: preferred?.text ?? "",
      edition: preferred ?? null,
    });
  }
  return out;
}

export async function getCompare(params: URLSearchParams, user: User | null) {
  const db = getDb();
  const overlayCache = new Map<string, ChapterOverlay | null>();
  async function overlayFor(workSlug: string, chapterRef: string) {
    if (!streamWork(workSlug)) return null;
    const key = `${workSlug}:${chapterRef}`;
    if (overlayCache.has(key)) return overlayCache.get(key) ?? null;
    const passages = db
      .query("SELECT id, reference, label FROM passages WHERE work_id = (SELECT id FROM works WHERE slug = ?) AND chapter_ref = ? ORDER BY sort_order")
      .all(workSlug, chapterRef) as Row[];
    const label =
      (db
        .query(
          "SELECT label FROM text_units WHERE reference = ? AND edition_id IN (SELECT id FROM editions WHERE work_id = (SELECT id FROM works WHERE slug = ?)) LIMIT 1",
        )
        .get(chapterRef, workSlug) as Row | null)?.label ?? `Chapter ${chapterRef}`;
    const fetched = await getStreamChapter(workSlug, { ref: chapterRef, label, labels: passages.map((p) => String(p.label)) }, passages.length);
    const overlay = fetched ? buildOverlay(fetched, passages) : null;
    overlayCache.set(key, overlay);
    return overlay;
  }
  const token = params.get("c");
  let collection: Row | null = null;
  let items: Row[] = [];
  if (token) {
    collection = db.query("SELECT * FROM collections WHERE share_token = ?").get(token) as Row | null;
    if (!collection) return { error: "not_found" as const };
    if (!collection.is_public && (!user || collection.user_id !== user.id)) return { error: "forbidden" as const };
    items = db
      .query("SELECT passage_id, annotation, edition_id FROM collection_items WHERE collection_id = ? ORDER BY position")
      .all(collection.id) as Row[];
  }
  const keys = (params.get("p") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  const resolved: any[] = [];
  if (items.length) {
    for (const item of items) {
      const row = db
        .query(
          `SELECT p.id, p.reference, p.label, p.chapter_ref, w.id AS work_id, w.slug AS work_slug, w.title AS work_title, w.date_display,
                  t.name AS tradition, s.name AS school
           FROM passages p JOIN works w ON w.id = p.work_id JOIN traditions t ON t.id = w.tradition_id
           LEFT JOIN schools s ON s.id = w.school_id WHERE p.id = ?`,
        )
        .get(item.passage_id) as Row | null;
      if (!row) continue;
      const overlay = await overlayFor(row.work_slug, row.chapter_ref ?? "1");
      const texts = textsFor(row.work_id, row.id, row.reference, overlay ?? undefined);
      const preferred = item.edition_id
        ? texts.find((t) => t.id === item.edition_id) ?? texts[0]
        : texts.find((t) => t.language.code === "en") ?? texts[0];
      resolved.push({
        passageId: row.id,
        work: row.work_slug,
        workTitle: row.work_title,
        reference: row.reference,
        label: row.label,
        tradition: row.tradition,
        school: row.school,
        dateDisplay: row.date_display,
        text: preferred?.text ?? "",
        edition: preferred ?? null,
        versions: texts.map((t) => ({ slug: t.slug, language: t.language, editionType: t.editionType, title: t.title })),
        annotation: item.annotation ?? "",
        streaming: streamingMeta(overlay ?? undefined),
        commentaryCount: (db.query("SELECT COUNT(*) AS n FROM commentaries WHERE passage_id = ?").get(row.id) as Row).n,
        themes: getThemes(row.id).map((t) => ({ slug: t.slug, name: t.name })),
      });
    }
  } else {
    for (const key of keys) {
      const [workSlug, ...rest] = key.split(":");
      const reference = rest.join(":").replace(/:/g, ".");
      const row = db
        .query(
          `SELECT p.id, p.reference, p.label, p.chapter_ref, w.id AS work_id, w.slug AS work_slug, w.title AS work_title, w.date_display,
                  t.name AS tradition, s.name AS school
           FROM passages p JOIN works w ON w.id = p.work_id JOIN traditions t ON t.id = w.tradition_id
           LEFT JOIN schools s ON s.id = w.school_id WHERE w.slug = ? AND p.reference = ?`,
        )
        .get(workSlug, reference) as Row | null;
      if (!row) continue;
      const overlay = await overlayFor(row.work_slug, row.chapter_ref ?? "1");
      const texts = textsFor(row.work_id, row.id, row.reference, overlay ?? undefined);
      const preferred = texts.find((t) => t.language.code === "en") ?? texts[0];
      resolved.push({
        passageId: row.id,
        work: row.work_slug,
        workTitle: row.work_title,
        reference: row.reference,
        label: row.label,
        tradition: row.tradition,
        school: row.school,
        dateDisplay: row.date_display,
        text: preferred?.text ?? "",
        edition: preferred ?? null,
        versions: texts.map((t) => ({ slug: t.slug, language: t.language, editionType: t.editionType, title: t.title })),
        annotation: "",
        streaming: streamingMeta(overlay ?? undefined),
        commentaryCount: (db.query("SELECT COUNT(*) AS n FROM commentaries WHERE passage_id = ?").get(row.id) as Row).n,
        themes: getThemes(row.id).map((t) => ({ slug: t.slug, name: t.name })),
      });
    }
  }
  return {
    collection: collection
      ? {
          id: collection.id,
          title: collection.title,
          description: collection.description,
          token: collection.share_token,
          curator: collection.curator,
          isCurated: !!collection.is_curated,
          isPublic: !!collection.is_public,
        }
      : null,
    items: resolved,
    limits: { max: 8, note: "Comparison keeps each passage in its own tradition and edition; juxtaposition is not a claim of equivalence." },
  };
}
