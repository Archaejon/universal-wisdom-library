// The adapters below are the ingestion layer: one entry per source the corpus
// was actually built from, plus the ones that are still only planned. Each names
// the source-registry slug it files its runs under (`source`) and the stream
// providers it feeds (`providers`), so the provenance page can read how much of
// the corpus each adapter is responsible for from the database instead of
// repeating a hand-kept count here. tests/provenance.test.ts fails if a provider
// in data/registry/streams.json has no adapter, so this list cannot quietly fall
// behind the shelves again — as it had: GRETIL was still marked "planned" with
// eighty works indexed from it, and the Sacred Text Archive "unavailable" with
// seventy-three.

export type AdapterStatus = "sample" | "connected" | "planned" | "unavailable";

export type SourceAdapter = {
  id: string;
  label: string;
  provider: string;
  status: AdapterStatus;
  licence: string;
  description: string;
  requires: string[];
  canImport: boolean;
  /** Source-registry slug this adapter's import runs are filed under, when it has one. */
  source: string;
  /** Stream-provider keys in work_streams / data/registry/streams.json. */
  providers: string[];
};

export const ADAPTERS: SourceAdapter[] = [
  {
    id: "local-corpus",
    label: "Curated demonstration corpus",
    provider: "Universal Wisdom Library",
    status: "sample",
    licence: "Mixed: public domain, CC BY-SA, CC0, CC BY 3.0",
    description:
      "Version-controlled JSON excerpts assembled from the editions named on each passage page. Validated and loaded by the ingestion pipeline.",
    requires: [],
    canImport: true,
    source: "uwl-editorial",
    providers: [],
  },
  {
    id: "project-gutenberg",
    label: "Project Gutenberg",
    provider: "Project Gutenberg",
    status: "connected",
    licence: "Public domain, per ebook",
    description:
      "Plain-text volumes read by the bounded extractor, which records the line ranges and SHA-256 checksums of the passages it took and stores no copy of the source file.",
    requires: [],
    canImport: true,
    source: "project-gutenberg",
    providers: ["gutenberg"],
  },
  {
    id: "sefaria",
    label: "Sefaria API",
    provider: "Sefaria",
    status: "connected",
    licence: "Per-text; Miqra according to the Masorah (CC BY-SA) and JPS 1917 (public domain) for the Tanakh",
    description:
      "The base texts of fourteen categories, from Tanakh and Talmud to Halakhah, Kabbalah and Responsa. The catalogue, chapter outline and passage index are stored here; the Hebrew and English are read from Sefaria when a chapter is opened.",
    requires: ["a caching or licensing arrangement before sustained heavy traffic"],
    canImport: false,
    source: "sefaria",
    providers: ["sefaria"],
  },
  {
    id: "suttacentral",
    label: "SuttaCentral Bilara API",
    provider: "SuttaCentral",
    status: "connected",
    licence: "CC0 for the segmented translation; public-domain root text",
    description:
      "The Pali canon's long and middle collections and the Dhammapada, streamed as segmented root text with Bhikkhu Sujato's English beside it.",
    requires: [],
    canImport: false,
    source: "suttacentral",
    providers: ["suttacentral"],
  },
  {
    id: "alquran-cloud",
    label: "AlQuran Cloud / Tanzil text",
    provider: "AlQuran Cloud",
    status: "connected",
    licence: "Tanzil Quran text terms (CC BY 3.0, verbatim only)",
    description: "The complete Qur'an, Arabic from the Tanzil Uthmani text with Pickthall's English, streamed ayah by ayah.",
    requires: [],
    canImport: false,
    source: "alquran-cloud",
    providers: ["alquran-cloud"],
  },
  {
    id: "quran-tafsir",
    label: "Quran.com tafsir API",
    provider: "Quran.com",
    status: "connected",
    licence: "Per-translation; streamed under the host's terms",
    description: "Tafsir works streamed against the Qur'anic text, with the translation credited per edition.",
    requires: [],
    canImport: false,
    source: "quran-com-tafsir",
    providers: ["quran-tafsir"],
  },
  {
    id: "quran-com",
    label: "Quran.com API",
    provider: "Quran.com",
    status: "planned",
    licence: "Per-translation; must be reviewed",
    description: "Planned for translations, recitations and word-by-word study. Not connected in this build.",
    requires: ["API terms review", "translation-level permission"],
    canImport: false,
    source: "quran-com",
    providers: [],
  },
  {
    id: "api-bible",
    label: "API.Bible",
    provider: "American Bible Society",
    status: "planned",
    licence: "Per-translation; rights-holder permission required",
    description: "Planned for licensed modern Bible translations. Not connected in this build.",
    requires: ["API key", "translation-level permission"],
    canImport: false,
    source: "api-bible",
    providers: [],
  },
  {
    id: "bolls",
    label: "Bolls Bible API",
    provider: "Bolls",
    status: "connected",
    licence: "Host terms, per translation",
    description:
      "Bible translations streamed chapter by chapter, each edition recording its own translation and rights position.",
    requires: [],
    canImport: false,
    source: "bolls",
    providers: ["bolls"],
  },
  {
    id: "newadvent",
    label: "New Advent",
    provider: "New Advent",
    status: "connected",
    licence: "Public domain (NPNF and the Dominican translation of the Summa)",
    description: "Aquinas's Summa Theologica and Augustine's City of God, read from New Advent's public-domain translations.",
    requires: [],
    canImport: false,
    source: "newadvent",
    providers: ["newadvent"],
  },
  {
    id: "ccel",
    label: "Christian Classics Ethereal Library",
    provider: "CCEL",
    status: "connected",
    licence: "Public domain; per-work rights recorded, and some older cards state none",
    description:
      "Patristic, scholastic, mystical and hymnic volumes read from the site's plain-text files, with the print basis and translator recorded on each edition.",
    requires: ["a rights review of the works whose catalogue cards state none"],
    canImport: true,
    source: "ccel",
    providers: ["ccel"],
  },
  {
    id: "openiti",
    label: "OpenITI",
    provider: "OpenITI",
    status: "connected",
    licence: "CC BY-NC-SA 4.0 per file; not relicensed",
    description:
      "Arabic transcriptions of tafsir, hadith, kalam, falsafa and history, streamed with their chapter structure and Arabic-only editions.",
    requires: [],
    canImport: false,
    source: "openiti",
    providers: ["openiti"],
  },
  {
    id: "hadith",
    label: "Hadith API",
    provider: "Hadith API",
    status: "connected",
    licence: "Arabic public domain; English translations streamed under the host's terms and credited to the named translator",
    description:
      "The canonical hadith collections, streamed in Arabic and in the English translation the host serves for each collection.",
    requires: [],
    canImport: false,
    source: "hadith-api",
    providers: ["hadith"],
  },
  {
    id: "gretil",
    label: "GRETIL",
    provider: "Göttingen Register of Electronic Texts in Indian Languages",
    status: "connected",
    licence: "CC BY-NC-SA 4.0 for the corpus; each file states its own terms",
    description:
      "Sanskrit and Prakrit transcriptions of the Vedas, Upanishads, Puranas, epics and philosophical works, streamed from the register's own files.",
    requires: ["a trimming pass for the printed verse delimiters left in some transcriptions"],
    canImport: false,
    source: "gretil",
    providers: ["gretil"],
  },
  {
    id: "sacred-texts",
    label: "Internet Sacred Text Archive",
    provider: "Evinity Publishing",
    status: "connected",
    licence: "Public-domain translations",
    description:
      "The Sacred Books of the East and the archive's Hindu, Buddhist, Jain, Taoist, Zoroastrian, Sikh and Christian volumes, read from the reviewed segments cached at import or from the site's JSON reading views, one chapter at a time.",
    requires: [],
    canImport: false,
    source: "sacred-texts",
    providers: ["sacred-texts", "sacred-texts-json"],
  },
  {
    id: "heritage",
    label: "Heritage Scripture Server",
    provider: "IIT Kanpur",
    status: "connected",
    licence: "HCAL-1.1; no verse text stored here",
    description:
      "The Bhagavad Gita and the Heritage corpus, streamed under the server's licence. Indexing is skipped unless a key is configured, because a run without one spends its requests on refusals.",
    requires: ["HERITAGE_API_KEY to index the shelf"],
    canImport: false,
    source: "",
    providers: ["heritage"],
  },
  {
    id: "bahai",
    label: "Bahá’í Reference Library",
    provider: "Bahá’í International Community",
    status: "connected",
    licence: "Copyright of the Bahá’í International Community; streamed under bahai.org's terms, not relicensed",
    description:
      "The published works of Bahá’u’lláh and ‘Abdu’l-Bahá, read from the library's reading views with the Community's copyright notice and the edition shown beside the text.",
    requires: [],
    canImport: false,
    source: "bahai-reference-library",
    providers: ["bahai"],
  },
  {
    id: "ctext",
    label: "Chinese Text Project",
    provider: "ctext.org",
    status: "connected",
    licence: "ctext.org terms; attribution required",
    description:
      "The Chinese classics — the Analects, the Book of Rites and the Mengzi — read paragraph by paragraph from the project's own text.",
    requires: [],
    canImport: false,
    source: "ctext",
    providers: ["ctext"],
  },
  {
    id: "srigranth",
    label: "Sri Granth / Gurbani-CD",
    provider: "Kulbir S. Thind",
    status: "connected",
    licence: "Gurbani public domain; the transcription and Khalsa's English used under written permission",
    description:
      "The complete Guru Granth Sahib in Gurmukhi with Khalsa's English, imported locally by ang and sentence under the permission recorded in its manifest.",
    requires: [],
    canImport: false,
    source: "srigranth",
    providers: [],
  },
  {
    id: "wikisource",
    label: "Wikisource",
    provider: "Wikimedia",
    status: "connected",
    licence: "CC BY-SA",
    description: "Public-domain transcriptions read from the page's own segmentation, with the edition named on each work.",
    requires: [],
    canImport: false,
    source: "wikisource",
    providers: ["wikisource"],
  },
  {
    id: "archive",
    label: "Internet Archive text layer",
    provider: "Internet Archive",
    status: "connected",
    licence: "Per item; public-domain scans only",
    description: "Scanned public-domain volumes read through archive.org's text layer, catalogued per item.",
    requires: [],
    canImport: false,
    source: "internet-archive-pd",
    providers: ["archive"],
  },
  {
    id: "bdrc",
    label: "Buddhist Digital Resource Center",
    provider: "BDRC",
    status: "planned",
    licence: "Varies by collection",
    description: "Planned for Tibetan Buddhist canonical and commentarial texts. Not connected in this build.",
    requires: ["collection-level review"],
    canImport: false,
    source: "bdrc",
    providers: [],
  },
];

export function adapter(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

// --- Tested read-only fetchers (not run at application startup) ---

export async function fetchSefariaText(ref: string, version: string) {
  const url = new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}`);
  url.searchParams.set("version", version);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Sefaria returned ${res.status}`);
  const data = (await res.json()) as any;
  const edition = data.versions?.[0];
  if (!edition) {
    throw new Error(
      `Sefaria had no version "${version}" for ${ref}. Available versions: ${(data.available_versions ?? [])
        .slice(0, 4)
        .map((v: any) => v.versionTitle)
        .join("; ")}`,
    );
  }
  return {
    ref: data.ref,
    versionTitle: edition.versionTitle,
    language: edition.language,
    license: edition.license,
    versionSource: edition.versionSource,
    text: edition.text as string[] | string[][],
  };
}

export async function fetchSuttaCentralDhammapada() {
  const res = await fetch("https://suttacentral.net/api/bilarasuttas/dhp1-20/sujato");
  if (!res.ok) throw new Error(`SuttaCentral returned ${res.status}`);
  const data = (await res.json()) as any;
  const keys: string[] = data.keys_order ?? [];
  const verses: { verse: number; pali: string; english: string; translator: string; licence: string }[] = [];
  for (let v = 1; v <= 5; v++) {
    const selected = keys.filter((k) => k.startsWith(`dhp${v}:`) && !/:0(\.|$)/.test(k));
    verses.push({
      verse: v,
      pali: selected.map((k) => String(data.root_text?.[k] ?? "")).join("").replace(/\s+/g, " ").trim(),
      english: selected.map((k) => String(data.translation_text?.[k] ?? "")).join("").replace(/\s+/g, " ").trim(),
      translator: "Bhikkhu Sujato",
      licence: "CC0",
    });
  }
  return { textId: "dhp1-20", translator: "Bhikkhu Sujato", verses };
}

export async function fetchQuranAyah(surah: number, ayah: number) {
  const res = await fetch(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/quran-uthmani`);
  if (!res.ok) throw new Error(`AlQuran Cloud returned ${res.status}`);
  const data = (await res.json()) as any;
  return {
    surah,
    ayah,
    text: String(data.data?.text ?? "").replace(/^\uFEFF/, "").trim(),
    edition: data.data?.edition?.identifier,
    licence: "Tanzil Quran text terms: verbatim copying permitted, modification not allowed",
  };
}
