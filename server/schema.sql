-- Universal Wisdom Library — normalised relational schema (SQLite)
-- Original text is stored verbatim in passage_texts.content.
-- passage_texts.normalized_text is a search-only derivative and is never displayed.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS languages (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  native_name TEXT NOT NULL,
  direction  TEXT NOT NULL DEFAULT 'ltr' CHECK (direction IN ('ltr','rtl'))
);

CREATE TABLE IF NOT EXISTS traditions (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions_note TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schools (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  tradition_id INTEGER NOT NULL REFERENCES traditions(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS authors (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  sort_name    TEXT NOT NULL DEFAULT '',
  birth_year   INTEGER,
  death_year   INTEGER,
  date_display TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  is_attributed INTEGER NOT NULL DEFAULT 0 CHECK (is_attributed IN (0,1))
);

CREATE TABLE IF NOT EXISTS sources (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL,
  url          TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  access_notes TEXT NOT NULL DEFAULT '',
  retrieved_at TEXT,
  is_live      INTEGER NOT NULL DEFAULT 0 CHECK (is_live IN (0,1)),
  status       TEXT NOT NULL DEFAULT 'connected'
               CHECK (status IN ('connected','sample','planned','unavailable'))
);

CREATE TABLE IF NOT EXISTS licenses (
  id                     INTEGER PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  url                    TEXT NOT NULL DEFAULT '',
  redistribution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (redistribution_allowed IN (0,1)),
  attribution_required   INTEGER NOT NULL DEFAULT 0 CHECK (attribution_required IN (0,1)),
  share_alike            INTEGER NOT NULL DEFAULT 0 CHECK (share_alike IN (0,1)),
  notes                  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS works (
  id                   INTEGER PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  tradition_id         INTEGER NOT NULL REFERENCES traditions(id),
  school_id            INTEGER REFERENCES schools(id),
  title                TEXT NOT NULL,
  original_title       TEXT NOT NULL DEFAULT '',
  transliteration      TEXT NOT NULL DEFAULT '',
  alt_titles_json      TEXT NOT NULL DEFAULT '[]',
  genre                TEXT NOT NULL DEFAULT '',
  text_type            TEXT NOT NULL DEFAULT '',
  category             TEXT NOT NULL DEFAULT '',
  subcategory          TEXT NOT NULL DEFAULT '',
  original_language    TEXT REFERENCES languages(code),
  date_start           INTEGER,
  date_end             INTEGER,
  date_display         TEXT NOT NULL DEFAULT '',
  authorship_status    TEXT NOT NULL DEFAULT 'traditional'
                       CHECK (authorship_status IN ('established','traditional','disputed','anonymous','composite','institutional')),
  author_id            INTEGER REFERENCES authors(id),
  attribution_note     TEXT NOT NULL DEFAULT '',
  description          TEXT NOT NULL DEFAULT '',
  historical_context   TEXT NOT NULL DEFAULT '',
  availability_note    TEXT NOT NULL DEFAULT '',
  is_sample            INTEGER NOT NULL DEFAULT 1 CHECK (is_sample IN (0,1)),
  featured             INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  featured_note        TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Textual function is separate from tradition and genre. A work can carry
-- several functions, and communities may dispute a classification.
CREATE TABLE IF NOT EXISTS work_text_functions (
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  function    TEXT NOT NULL CHECK (function IN (
                'canonical_scripture','non_canonical_religious_text','foundational_revelation',
                'prayer_liturgy','commentary_exegesis','religious_law_practice','historical_document',
                'sermon_speech','philosophical_work','mystical_contemplative',
                'ethical_humanist_manifesto','community_statement','creed_confession',
                'denominational_guidance','academic_scholarship','contemporary_spiritual_writing',
                'oral_history_transcription','community_authorised_knowledge')),
  assigned_by TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'provisional'
              CHECK (status IN ('affirmed','provisional','disputed')),
  note        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, function)
);
CREATE INDEX IF NOT EXISTS idx_work_text_functions_work ON work_text_functions(work_id, sort_order);

-- A streamed work keeps its catalogue record, chapter outline and passage
-- index here, but no text. The reader requests each chapter from the project
-- that hosts it (data/registry/streams.json -> work_streams).
CREATE TABLE IF NOT EXISTS work_streams (
  work_slug   TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'numbered' CHECK (mode IN ('numbered','complex')),
  config_json TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT
);

CREATE TABLE IF NOT EXISTS editions (
  id                 INTEGER PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  work_id            INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  language_code      TEXT NOT NULL REFERENCES languages(code),
  edition_type       TEXT NOT NULL CHECK (edition_type IN ('original','translation','transliteration')),
  title              TEXT NOT NULL,
  translator         TEXT NOT NULL DEFAULT '',
  translator_author_id INTEGER REFERENCES authors(id),
  publisher          TEXT NOT NULL DEFAULT '',
  publication_year   INTEGER,
  source_id          INTEGER REFERENCES sources(id),
  license_id         INTEGER REFERENCES licenses(id),
  rights_status      TEXT NOT NULL DEFAULT '',
  attribution_text   TEXT NOT NULL DEFAULT '',
  structure_scheme   TEXT NOT NULL DEFAULT '',
  is_available       INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
  is_sample          INTEGER NOT NULL DEFAULT 1 CHECK (is_sample IN (0,1)),
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every catalogue row (a work card, a shelf) counts a work's editions five or
-- six times over. Without this index each count scans the whole editions table.
CREATE INDEX IF NOT EXISTS idx_editions_work ON editions(work_id, edition_type);

CREATE TABLE IF NOT EXISTS text_units (
  id         INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES text_units(id) ON DELETE CASCADE,
  depth      INTEGER NOT NULL DEFAULT 0,
  sequence   INTEGER NOT NULL DEFAULT 0,
  label      TEXT NOT NULL,
  reference  TEXT NOT NULL,
  unit_type  TEXT NOT NULL DEFAULT 'section',
  title      TEXT NOT NULL DEFAULT '',
  UNIQUE(edition_id, reference)
);

CREATE TABLE IF NOT EXISTS passages (
  id          INTEGER PRIMARY KEY,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  reference   TEXT NOT NULL,
  label       TEXT NOT NULL,
  chapter_ref TEXT,
  section_ref TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  ref_scheme  TEXT NOT NULL DEFAULT '',
  UNIQUE(work_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_passages_work_sort ON passages(work_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_passages_chapter ON passages(work_id, chapter_ref, sort_order);

CREATE TABLE IF NOT EXISTS passage_texts (
  id              INTEGER PRIMARY KEY,
  passage_id      INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  edition_id      INTEGER NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  text_unit_id    INTEGER REFERENCES text_units(id) ON DELETE SET NULL,
  content         TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  checksum        TEXT NOT NULL,
  word_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(passage_id, edition_id)
);
CREATE INDEX IF NOT EXISTS idx_passage_texts_edition ON passage_texts(edition_id);

-- FTS: original orthography is indexed, but with a normalised copy so that
-- vowel points and Arabic short vowels do not defeat matching.
CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(
  passage_id UNINDEXED,
  edition_id UNINDEXED,
  work_id UNINDEXED,
  language UNINDEXED,
  reference UNINDEXED,
  text,
  variants,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Search-only index for text that is streamed rather than stored. The index
-- holds the normalised passage and prefix variants; the reader still fetches
-- the edition from its host. `excerpt` is a short display fragment so search
-- results can show context without keeping a second copy of the work.
CREATE VIRTUAL TABLE IF NOT EXISTS stream_fts USING fts5(
  passage_id UNINDEXED,
  edition_id UNINDEXED,
  work_slug UNINDEXED,
  language UNINDEXED,
  reference UNINDEXED,
  text,
  variants,
  excerpt UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Exact provider counts are expensive for very broad terms such as الله.
-- Cache them against the stream index generation so a reindex invalidates the
-- entry rather than leaving a stale total on the search page.
CREATE TABLE IF NOT EXISTS stream_count_cache (
  cache_key     TEXT PRIMARY KEY,
  index_version TEXT NOT NULL,
  counts_json   TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stream_count_cache_version ON stream_count_cache(index_version, created_at);

-- Trigram index for CJK and substring matching. Chosen at query time.
CREATE VIRTUAL TABLE IF NOT EXISTS passage_trigram USING fts5(
  passage_id UNINDEXED,
  edition_id UNINDEXED,
  text,
  tokenize = 'trigram'
);

CREATE TABLE IF NOT EXISTS commentaries (
  id                    INTEGER PRIMARY KEY,
  passage_id            INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  work_id               INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  content_type          TEXT NOT NULL CHECK (content_type IN
                          ('traditional','academic','modern_religious','editorial','ai')),
  author_id             INTEGER REFERENCES authors(id),
  author_display        TEXT NOT NULL,
  source_id             INTEGER REFERENCES sources(id),
  content               TEXT NOT NULL,
  is_quotation          INTEGER NOT NULL DEFAULT 0 CHECK (is_quotation IN (0,1)),
  language_code         TEXT REFERENCES languages(code),
  interpretive_tradition TEXT NOT NULL DEFAULT '',
  date_display          TEXT NOT NULL DEFAULT '',
  license_id            INTEGER REFERENCES licenses(id),
  source_url            TEXT NOT NULL DEFAULT '',
  provenance_note       TEXT NOT NULL DEFAULT '',
  is_sample             INTEGER NOT NULL DEFAULT 1 CHECK (is_sample IN (0,1)),
  review_status         TEXT NOT NULL DEFAULT 'published'
                        CHECK (review_status IN ('draft','pending','published','rejected')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_commentaries_passage ON commentaries(passage_id);

CREATE TABLE IF NOT EXISTS themes (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  question    TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS passage_themes (
  passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  theme_id   INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  note       TEXT NOT NULL DEFAULT '',
  relevance  TEXT NOT NULL DEFAULT 'curated'
             CHECK (relevance IN ('curated','strong','related')),
  curator    TEXT NOT NULL DEFAULT 'UWL editors',
  PRIMARY KEY (passage_id, theme_id)
);

CREATE TABLE IF NOT EXISTS text_relationships (
  id                INTEGER PRIMARY KEY,
  from_passage_id   INTEGER REFERENCES passages(id) ON DELETE CASCADE,
  to_passage_id     INTEGER REFERENCES passages(id) ON DELETE CASCADE,
  from_work_id      INTEGER REFERENCES works(id) ON DELETE CASCADE,
  to_work_id        INTEGER REFERENCES works(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN
                     ('citation','quotation','commentary','translation','historical_influence',
                      'parallel_narrative','shared_theme','scholarly_comparison','editorial_connection')),
  confidence        TEXT NOT NULL DEFAULT 'thematic'
                    CHECK (confidence IN ('explicit','probable','thematic','superficial')),
  description       TEXT NOT NULL,
  evidence          TEXT NOT NULL DEFAULT '',
  curator           TEXT NOT NULL DEFAULT 'UWL editors',
  review_status     TEXT NOT NULL DEFAULT 'published'
                    CHECK (review_status IN ('draft','pending','published','rejected')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_passage_id IS NOT NULL OR from_work_id IS NOT NULL),
  CHECK (to_passage_id IS NOT NULL OR to_work_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_rel_from ON text_relationships(from_passage_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON text_relationships(to_passage_id);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader','editor','admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  edition_id INTEGER REFERENCES editions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, passage_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  edition_id INTEGER REFERENCES editions(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 1 CHECK (is_private IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS collections (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'reading_list'
                CHECK (kind IN ('reading_list','comparison','thematic')),
  is_public     INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  share_token   TEXT UNIQUE,
  curator       TEXT NOT NULL DEFAULT '',
  is_curated    INTEGER NOT NULL DEFAULT 0 CHECK (is_curated IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);

CREATE TABLE IF NOT EXISTS collection_items (
  id            INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  passage_id    INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  edition_id    INTEGER REFERENCES editions(id) ON DELETE SET NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  annotation    TEXT NOT NULL DEFAULT '',
  UNIQUE(collection_id, passage_id)
);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id        INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  passage_id     INTEGER REFERENCES passages(id) ON DELETE SET NULL,
  percent        REAL NOT NULL DEFAULT 0,
  last_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, work_id)
);

CREATE TABLE IF NOT EXISTS imports (
  id               INTEGER PRIMARY KEY,
  source_id        INTEGER REFERENCES sources(id),
  adapter          TEXT NOT NULL,
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at      TEXT,
  status           TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','succeeded','partial','failed')),
  records_seen     INTEGER NOT NULL DEFAULT 0,
  records_imported INTEGER NOT NULL DEFAULT 0,
  records_failed   INTEGER NOT NULL DEFAULT 0,
  notes            TEXT NOT NULL DEFAULT '',
  log_json         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS import_issues (
  id         INTEGER PRIMARY KEY,
  import_id  INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  severity   TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  code       TEXT NOT NULL,
  message    TEXT NOT NULL,
  record_ref TEXT NOT NULL DEFAULT '',
  resolved   INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0,1))
);
-- The provenance page asks for the newest errors and warnings, not the
-- hundreds of thousands of informational notes the seed records per work. The
-- index keeps that lookup off a full sort of the table (286ms without it).
CREATE INDEX IF NOT EXISTS idx_import_issues_severity ON import_issues(severity, id);

CREATE TABLE IF NOT EXISTS editorial_submissions (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type   TEXT NOT NULL CHECK (target_type IN ('passage','work','commentary','edition')),
  target_id     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('correction','metadata','annotation')),
  message       TEXT NOT NULL,
  proposed_text TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected','needs_discussion')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  review_note   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS revisions (
  id          INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  editor_id   INTEGER REFERENCES users(id),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reserved for the next phase. No embedding model is connected in this build.
CREATE TABLE IF NOT EXISTS embeddings (
  id         INTEGER PRIMARY KEY,
  passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  edition_id INTEGER REFERENCES editions(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  dims       INTEGER NOT NULL,
  vector     BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(passage_id, edition_id, model)
);

-- ---------------------------------------------------------------------------
-- Source registry: discovery, rights verification and approval are separate
-- from ingestion. A source can be known and readable without being licensed
-- for corpus-scale copying or redistribution.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_registry (
  source_id              TEXT PRIMARY KEY,
  source_name            TEXT NOT NULL,
  base_url               TEXT NOT NULL DEFAULT '',
  organisation           TEXT NOT NULL DEFAULT '',
  traditions_covered_json TEXT NOT NULL DEFAULT '[]',
  schools_covered_json   TEXT NOT NULL DEFAULT '[]',
  languages_json         TEXT NOT NULL DEFAULT '[]',
  source_type            TEXT NOT NULL DEFAULT '',
  content_types_json     TEXT NOT NULL DEFAULT '[]',
  api_documentation_url  TEXT NOT NULL DEFAULT '',
  download_url           TEXT NOT NULL DEFAULT '',
  access_method          TEXT NOT NULL DEFAULT '',
  licence_url            TEXT NOT NULL DEFAULT '',
  licence_status         TEXT NOT NULL DEFAULT 'not_verified',
  commercial_use_allowed INTEGER CHECK (commercial_use_allowed IN (0,1)),
  redistribution_allowed INTEGER CHECK (redistribution_allowed IN (0,1)),
  attribution_requirements TEXT NOT NULL DEFAULT '',
  authentication_required INTEGER CHECK (authentication_required IN (0,1)),
  rate_limits            TEXT NOT NULL DEFAULT '',
  ingestion_status       TEXT NOT NULL DEFAULT 'discovered'
                         CHECK (ingestion_status IN (
                           'discovered','under_review','licence_verified','ready_for_integration',
                           'connected','import_tested','active','restricted','unavailable')),
  last_verified_at       TEXT,
  source_reliability_notes TEXT NOT NULL DEFAULT '',
  editorial_notes        TEXT NOT NULL DEFAULT '',
  priority               INTEGER NOT NULL DEFAULT 3,
  approval_status        TEXT NOT NULL DEFAULT 'pending'
                         CHECK (approval_status IN ('pending','approved','rejected')),
  reviewed_by            INTEGER REFERENCES users(id),
  reviewed_at            TEXT,
  review_note            TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_registry_status ON source_registry(ingestion_status, priority);
CREATE INDEX IF NOT EXISTS idx_registry_approval ON source_registry(approval_status);

CREATE TABLE IF NOT EXISTS source_checks (
  id            INTEGER PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES source_registry(source_id) ON DELETE CASCADE,
  checked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  method        TEXT NOT NULL CHECK (method IN ('manual','http','api')),
  status        TEXT NOT NULL CHECK (status IN ('ok','blocked','error','unverified')),
  http_status   INTEGER,
  notes         TEXT NOT NULL DEFAULT '',
  checked_by    INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_source_checks_source ON source_checks(source_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_queue (
  id            INTEGER PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES source_registry(source_id) ON DELETE CASCADE,
  adapter       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','running','succeeded','failed','rejected','needs_review')),
  requested_by  INTEGER REFERENCES users(id),
  reviewed_by   INTEGER REFERENCES users(id),
  request_note  TEXT NOT NULL DEFAULT '',
  review_note   TEXT NOT NULL DEFAULT '',
  manifest_json TEXT NOT NULL DEFAULT '{}',
  records_seen  INTEGER NOT NULL DEFAULT 0,
  records_imported INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at    TEXT,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON ingestion_queue(status, created_at DESC);

-- Public rights, attribution, consultation and takedown requests. These are
-- deliberately not tied to an account: a rights holder may not be a reader.
CREATE TABLE IF NOT EXISTS rights_requests (
  id            INTEGER PRIMARY KEY,
  source_id     TEXT REFERENCES source_registry(source_id) ON DELETE SET NULL,
  work_slug     TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL CHECK (kind IN ('permission','attribution','takedown','consultation','metadata')),
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'received'
                CHECK (status IN ('received','under_review','resolved','declined')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  review_note   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rights_requests_status ON rights_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rights_requests_source ON rights_requests(source_id);

CREATE TABLE IF NOT EXISTS acquisition_targets (
  slug              TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  original_title    TEXT NOT NULL DEFAULT '',
  transliteration   TEXT NOT NULL DEFAULT '',
  author            TEXT NOT NULL DEFAULT '',
  tradition         TEXT NOT NULL DEFAULT 'islam',
  school            TEXT NOT NULL DEFAULT '',
  genre             TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'wanted'
                    CHECK (status IN ('wanted','located','rights_blocked','imported')),
  priority          INTEGER NOT NULL DEFAULT 3,
  languages_json    TEXT NOT NULL DEFAULT '[]',
  source_leads_json TEXT NOT NULL DEFAULT '[]',
  rights_note       TEXT NOT NULL DEFAULT '',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acquisition_status ON acquisition_targets(status, priority);

-- The synthesis cache and the rate limiter used to live in process memory: a
-- restart emptied the cache, and a second server process kept its own limits.
-- Both are small, short-lived and shared, so they belong in the database.
CREATE TABLE IF NOT EXISTS synthesis_cache (
  cache_key  TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  question   TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_synthesis_cache_created ON synthesis_cache(created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_queries (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  question   TEXT NOT NULL,
  engine     TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  grounded   INTEGER NOT NULL DEFAULT 0 CHECK (grounded IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Near-duplicate review. The ingest pipeline compares passage checksums, which
-- is exact: a text with one changed punctuation mark is a different text. A
-- scan groups editions that repeat substantive passages, then compares their
-- sampled shared references with a fuzzy similarity so that near-copies show
-- up beside exact copies. Results are stored, never applied: nothing is merged
-- or deleted from a scan.
CREATE TABLE IF NOT EXISTS duplicate_scans (
  id              INTEGER PRIMARY KEY,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  threshold       REAL NOT NULL DEFAULT 0.8,
  record_threshold REAL NOT NULL DEFAULT 0.5,
  min_repeated    INTEGER NOT NULL DEFAULT 20,
  editions        INTEGER NOT NULL DEFAULT 0,
  candidate_pairs INTEGER NOT NULL DEFAULT 0,
  pairs_recorded  INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS duplicate_pairs (
  id               INTEGER PRIMARY KEY,
  scan_id          INTEGER NOT NULL REFERENCES duplicate_scans(id) ON DELETE CASCADE,
  left_edition_id  INTEGER NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  right_edition_id INTEGER NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  repeated_passages INTEGER NOT NULL,
  sampled          INTEGER NOT NULL,
  identical        INTEGER NOT NULL,
  equivalent       INTEGER NOT NULL,
  near             INTEGER NOT NULL,
  different        INTEGER NOT NULL,
  similarity       REAL NOT NULL,
  examples_json    TEXT NOT NULL DEFAULT '[]',
  UNIQUE(scan_id, left_edition_id, right_edition_id)
);
CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_scan ON duplicate_pairs(scan_id, similarity DESC);
