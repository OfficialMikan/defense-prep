-- ============================================================================
-- Defense Prep — Persistent Research Knowledge Base + Hybrid RAG + Memory
-- ============================================================================
-- ADDITIVE MIGRATION ONLY.
--
-- IMPORTANT: This migration does NOT touch `analytics_events` or any existing
-- application table. The existing analytics subsystem is left completely
-- intact. Do NOT create/recreate/drop/rename/alter `analytics_events` here.
--
-- All research tables use the `research_` prefix so they cannot be confused
-- with analytics or future application tables.
--
-- The `vector` extension is OPTIONAL. If it cannot be enabled, the embedding
-- column is skipped and keyword + metadata retrieval still work. This makes
-- vector search a graceful enhancement, never a single point of failure.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Optional extensions
-- ---------------------------------------------------------------------------
-- pg_trgm is used for fuzzy keyword search. It ships with Postgres and is
-- always available on Supabase. `vector` (pgvector) is guarded below.
create extension if not exists pg_trgm;

-- Attempt to enable pgvector. If it is not available in this Postgres
-- instance, the DO block below will skip the embedding column/index instead
-- of failing the whole migration.
do $$
begin
  if exists (
    select 1 from pg_available_extensions where name = 'vector'
  ) then
    create extension if not exists vector;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. RESEARCH PROJECTS
-- ---------------------------------------------------------------------------
-- Top-level isolation boundary. Every research document, section, chunk,
-- citation, reference, and conversation belongs to exactly one project.
create table if not exists public.research_projects (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'Untitled Research',
  description  text,
  access_token text unique,                 -- server-validated anonymous access key
  status       text not null default 'active'
               check (status in ('active','archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. RESEARCH MAPS (persistent high-level overview/index)
-- ---------------------------------------------------------------------------
-- NOT a replacement for the research content. It stores an index/overview
-- (summary, chapter order, detected component keys). Basic retrieval must
-- work even when summary is absent.
create table if not exists public.research_maps (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.research_projects(id) on delete cascade,
  version        int  not null default 1,
  summary        text,
  chapter_order  jsonb not null default '[]',
  component_keys jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  unique (project_id, version)
);

-- ---------------------------------------------------------------------------
-- 3. RESEARCH DOCUMENTS
-- ---------------------------------------------------------------------------
-- One row per uploaded chapter/document. Versioned: when content changes, a
-- NEW row is inserted with version+1 and the old row is marked inactive.
create table if not exists public.research_documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.research_projects(id) on delete cascade,
  doc_number   int  not null,               -- chapter number (1..5)
  title        text,
  file_type    text not null default 'txt' check (file_type in ('txt','docx','pdf')),
  source_path  text,
  version      int  not null default 1,
  checksum     text,                        -- content hash for change detection
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, doc_number, version)
);

-- ---------------------------------------------------------------------------
-- 4. RESEARCH SECTIONS (auto-detected headings)
-- ---------------------------------------------------------------------------
create table if not exists public.research_sections (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.research_projects(id) on delete cascade,
  document_id  uuid not null references public.research_documents(id) on delete cascade,
  heading      text,
  heading_lower text,                       -- normalized for matching
  component_key text,                       -- mapped component (statement, design, ...)
  ord          int  not null default 0,     -- order within the document
  raw_text     text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. RESEARCH CHUNKS (semantic chunks of a section)
-- ---------------------------------------------------------------------------
-- Every chunk retains full metadata (document/chapter + section + index) so
-- the final model knows exactly where the text came from.
create table if not exists public.research_chunks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.research_projects(id) on delete cascade,
  document_id  uuid not null references public.research_documents(id) on delete cascade,
  section_id   uuid not null references public.research_sections(id) on delete cascade,
  chunk_index  int  not null default 0,
  content      text not null,
  content_tsv  tsvector generated always as (to_tsvector('english', content)) stored,
  token_count  int,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. RESEARCH CITATIONS (detected citations within chunks)
-- ---------------------------------------------------------------------------
create table if not exists public.research_citations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.research_projects(id) on delete cascade,
  document_id   uuid references public.research_documents(id) on delete set null,
  section_id    uuid references public.research_sections(id) on delete set null,
  chunk_id      uuid references public.research_chunks(id) on delete set null,
  citation_text text not null,              -- e.g. "Davis, 1989"
  author        text,
  year          int,
  pattern_type  text check (pattern_type in ('paren','narrative')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. RESEARCH REFERENCES (parsed bibliography entries)
-- ---------------------------------------------------------------------------
create table if not exists public.research_references (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.research_projects(id) on delete cascade,
  document_id    uuid references public.research_documents(id) on delete cascade,
  reference_text text not null,
  author         text,
  year           int,
  title          text,
  ord            int not null default 0,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. CITATION <-> REFERENCE LINKS
-- ---------------------------------------------------------------------------
create table if not exists public.citation_reference_links (
  citation_id  uuid not null references public.research_citations(id) on delete cascade,
  reference_id uuid not null references public.research_references(id) on delete cascade,
  primary key (citation_id, reference_id)
);

-- ---------------------------------------------------------------------------
-- 9. CONVERSATIONS (persistent chat memory, separate from research memory)
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects(id) on delete cascade,
  user_id    text,                          -- anonymous user id (matches dp_user_id)
  session_id text,                          -- client session id used to resume a conversation
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 10. CONVERSATION MESSAGES
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  project_id      uuid not null references public.research_projects(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 11. CONVERSATION SUMMARIES (rolling digest for bounded memory)
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_summaries (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  summary_text    text not null,
  token_count     int,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- 12. INDEXES
-- ============================================================================
-- FK / project-isolation indexes
create index if not exists research_maps_project_idx        on public.research_maps(project_id);
create index if not exists research_documents_project_idx   on public.research_documents(project_id);
create index if not exists research_documents_active_idx    on public.research_documents(project_id, doc_number) where is_active;
create index if not exists research_documents_status_idx    on public.research_documents(project_id, is_active);
create index if not exists research_sections_project_idx    on public.research_sections(project_id);
create index if not exists research_sections_document_idx   on public.research_sections(document_id);
create index if not exists research_sections_component_idx  on public.research_sections(project_id, component_key);
create index if not exists research_chunks_project_idx      on public.research_chunks(project_id);
create index if not exists research_chunks_document_idx     on public.research_chunks(document_id);
create index if not exists research_chunks_section_idx      on public.research_chunks(section_id);
create index if not exists research_citations_project_idx   on public.research_citations(project_id);
create index if not exists research_citations_chunk_idx     on public.research_citations(chunk_id);
create index if not exists research_citations_author_idx    on public.research_citations(author, year);
create index if not exists research_references_project_idx  on public.research_references(project_id);
create index if not exists research_references_author_idx   on public.research_references(author, year);
create index if not exists conversations_project_idx        on public.conversations(project_id);
create index if not exists messages_conversation_idx        on public.conversation_messages(conversation_id);
create index if not exists messages_project_idx             on public.conversation_messages(project_id);
create index if not exists summaries_conversation_idx       on public.conversation_summaries(conversation_id);

-- Full-text search over chunk content
create index if not exists research_chunks_content_tsv_idx
  on public.research_chunks using gin (content_tsv);

-- Fuzzy keyword search (trigram)
create index if not exists research_chunks_content_trgm_idx
  on public.research_chunks using gin (content gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 13. OPTIONAL VECTOR COLUMN + INDEX (guarded by pgvector availability)
-- ---------------------------------------------------------------------------
-- We add the embedding column only if the `vector` extension could be enabled.
-- The column is `vector(1536)` to match OpenAI text-embedding-3-small.
do $$
begin
  if exists (
    select 1 from pg_extension where extname = 'vector'
  ) then
    begin
      alter table public.research_chunks
        add column if not exists embedding vector(1536);
      -- ivfflat is broadly compatible; use HNSW only if your pgvector version
      -- supports it (>= 0.5.0). ivfflat requires lists count; 100 is a sane
      -- starting point for a small research corpus.
      create index if not exists research_chunks_embedding_ivfflat_idx
        on public.research_chunks using ivfflat (embedding vector_cosine_ops)
        with (lists = 100);
    exception when others then
      -- If the index type or column addition fails for any reason, keyword
      -- retrieval still works. Log nothing sensitive and continue.
      null;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 13b. Optional RPC: vector similarity search (guarded by pgvector)
-- ---------------------------------------------------------------------------
-- Exposes a server-side function that returns the top-K chunks most similar to
-- a query embedding for a project. Only created when pgvector is available.
-- The service role (bypasses RLS) can call it; project_id is a required filter,
-- so a query can never leak across projects.
do $block$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    begin
create or replace function public.search_research_chunks(
        p_project_id uuid,
        p_embedding vector(1536),
        p_limit int default 8
      )
      returns table (
        id uuid,
        project_id uuid,
        document_id uuid,
        section_id uuid,
        chunk_index int,
        content text,
        token_count int,
        similarity float
      )
      language sql stable
      as $func$
        select c.id, c.project_id, c.document_id, c.section_id, c.chunk_index,
               c.content, c.token_count,
               1 - (c.embedding <=> p_embedding) as similarity
        from public.research_chunks c
        inner join public.research_documents d
          on d.id = c.document_id
        where c.project_id = p_project_id
          and d.is_active = true
          and c.embedding is not null
        order by c.embedding <=> p_embedding
        limit p_limit;
      $func$;
    exception when others then
      null;
    end;
  end if;
end $block$;

-- ============================================================================
-- 14. ROW LEVEL SECURITY
-- ============================================================================
-- All privileged operations happen server-side with the SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS. Therefore we enable RLS on every research table and
-- create NO public/anon policies. This guarantees research data cannot become
-- globally readable. Project isolation is enforced at the API layer via a
-- server-validated access_token.
--
-- If Supabase Auth is added later, add policies scoped by auth.uid().
alter table public.research_projects        enable row level security;
alter table public.research_maps            enable row level security;
alter table public.research_documents       enable row level security;
alter table public.research_sections        enable row level security;
alter table public.research_chunks          enable row level security;
alter table public.research_citations       enable row level security;
alter table public.research_references      enable row level security;
alter table public.citation_reference_links enable row level security;
alter table public.conversations            enable row level security;
alter table public.conversation_messages    enable row level security;
alter table public.conversation_summaries   enable row level security;

-- NOTE: No SELECT/INSERT/UPDATE/DELETE policies are created for the anon/authenticated
-- roles on research tables. Only the service role (bypasses RLS) can access them.
-- This is intentional and documented.
