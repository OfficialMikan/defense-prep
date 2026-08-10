# Group 4 — Title Defense Training

An AI-powered research panel defense simulator. Practice your thesis / capstone
title defense with AI-generated flashcards across research components and
difficulty levels, plus a chatbot coach. Includes an admin analytics panel,
offline PWA support, and bundled chapter files.

## Features

- **Flashcard defense trainer** — AI-generated Q&A from your uploaded chapter files
- **Section-based retrieval** — only relevant chapter sections are sent to the AI
- **Adjustable difficulty** — Easy, Medium, Hard
- **Chapter-aware components** — configured in `chapter-config.js` (Chapters 1–5)
- **AI Chatbot Coach** — conversational help grounded in chapter content
- **Practice history** — saved locally with favorites filter and delete
- **Photo & PDF export** — lazy-loaded libraries (html2canvas, jsPDF)
- **Dark mode** — persistent preference
- **Progressive Web App** — offline app shell, CDN libs, and chapter files cached
- **Admin panel** (`admin.html`) — usage stats, per-user activity, chat logs, card reports
- **Accessibility** — skip link, keyboard flashcard flip, ARIA labels, reduced-motion

## Quick Start

### Serve locally

```bash
# Static server (API routes won't work without Vercel)
npm start

# Full stack with serverless API (recommended)
npm run dev
```

Then open `http://localhost:8080` (or the port Vercel assigns).

### Environment variables (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key; primary provider for `/api/chat` and embeddings |
| `GROQ_API_KEY` | Optional | Groq backup provider for `/api/chat` |
| `SUPABASE_URL` | For RAG | Supabase project URL (persistent knowledge base + analytics) |
| `SUPABASE_SERVICE_ROLE_KEY` | For RAG | Supabase service-role key — **server-side only, never in browser code** |
| `ADMIN_PASS` | For admin | Password for the analytics dashboard. **Minimum 16 characters** — shorter values are rejected (`503 misconfigured`) to prevent accidental weak deployments |
| `OPENAI_CHATBOT_MODEL` | Optional | Defaults to `gpt-4.1-mini` |
| `OPENAI_FLASHCARD_MODEL` | Optional | Defaults to `gpt-4.1-mini` |
| `OPENAI_CHATBOT_FALLBACK_MODEL` | Optional | Defaults to `gpt-4.1-nano` |
| `OPENAI_FLASHCARD_FALLBACK_MODEL` | Optional | Defaults to `gpt-4.1-nano` |
| `GROQ_CHATBOT_MODEL` | Optional | Defaults to `llama-3.1-8b-instant` |
| `GROQ_CHATBOT_FALLBACK_MODEL` | Optional | Defaults to `llama-3.3-70b-versatile` |
| `GROQ_FLASHCARD_MODEL` | Optional | Defaults to `llama-3.1-8b-instant` |
| `GROQ_FLASHCARD_FALLBACK_MODEL` | Optional | Defaults to `llama-3.3-70b-versatile` |
| `EMBEDDING_MODEL` | Optional | Embedding model; defaults to `text-embedding-3-small` (1536 dims) |
| `EMBEDDING_BASE_URL` | Optional | Override the OpenAI embeddings endpoint |
| `OPENAI_CHAT_BASE_URL` | Optional | Override the OpenAI chat completions endpoint |
| `CHAT_RETRIEVAL_LIMIT` | Optional | Chunks retrieved for chat; defaults to `8` |
| `FLASHCARD_RETRIEVAL_LIMIT` | Optional | Chunks retrieved for flashcards; defaults to `8` |
| `REFERENCE_RETRIEVAL_LIMIT` | Optional | Reference lines retrieved; defaults to `5` |
| `KV_REST_API_URL` | Optional | Vercel KV URL for persistent analytics |
| `KV_REST_API_TOKEN` | Optional | Vercel KV token |
| `DEBUG` | Optional | Set `true` for verbose API logs |

## Project structure

```
├── index.html          Main app
├── app.js              Flashcard + chatbot logic
├── chapter-config.js   Chapter/component configuration
├── styles.css          UI styles
├── sw.js               Service worker (offline caching)
├── admin.html          Analytics dashboard
├── api/
│   ├── chat.js         AI proxy (flashcards + chat, OpenAI + Groq fallback)
│   ├── ingest.js       Persistent knowledge-base ingestion (sections/chunks/citations)
│   ├── retrieve.js     Hybrid RAG retrieval (admin-audited)
│   ├── analytics.js    Event logging + admin API
│   └── debug.js        Debug helpers
├── lib/
│   ├── chunking.js     Normalization, section splitting, semantic chunking
│   ├── citations.js    Citation detection + reference parsing/matching
│   ├── components.js   Shared component-keyword mapping
│   ├── hybrid.js       Hybrid retrieval scoring + RRF fusion
│   ├── embeddings.js   OpenAI embedding client
│   ├── supabase.js     Supabase client (service role, server-side only)
│   └── adminAuth.js    Shared timing-safe admin auth (16-char min)
├── supabase/migrations/  Database schema (research knowledge base + RLS)
└── data/chapters/      Chapter .txt / .pdf / .docx files
```

## Persistent knowledge base (RAG)

The app indexes uploaded chapters into a Supabase-backed knowledge base so the
AI can retrieve only the relevant sections instead of re-sending whole chapters.

1. **Ingest** — `POST /api/ingest` normalizes the chapter text, splits it into
   sections by heading, chunks each section on sentence boundaries, detects
   citations, parses references, and (when `OPENAI_API_KEY` is set) embeds the
   chunks. Content is checksummed so unchanged uploads are a no-op.
2. **Retrieve** — `POST /api/retrieve` runs hybrid retrieval (keyword full-text
   + optional vector similarity + metadata/citation boosts) fused with
   Reciprocal Rank Fusion, returning the top chunks for a query.
3. **Chat / Flashcards** — `/api/chat` retrieves the relevant chunks for the
   selected chapter + components and injects them into the prompt, so answers
   are grounded in the indexed research. Chat also persists conversation memory
   (conversations / messages / summaries tables).

### Database setup

Apply the migration to your Supabase project:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_research_knowledge_base.sql
```

The migration is **additive** — it never touches `analytics_events`. It creates
the `research_*` tables, optional pgvector support (gracefully skipped if
unavailable), full-text + trigram indexes, and enables Row Level Security with
**no public policies** (only the service role can access research data).

## Deployment

Deploy to [Vercel](https://vercel.com):

```bash
npx vercel --prod
```

`vercel.json` sets security headers and service-worker-friendly caching for `/sw.js`.

## AI backend

The app uses **OpenAI** (`gpt-4.1-mini` / `gpt-4.1-nano`) as its primary provider, with **Groq** (`llama-3.1-8b-instant` / `llama-3.3-70b-versatile`) as a fallback chain via `/api/chat.js`. API keys stay server-side — never exposed in the browser.

## Security notes

- Analytics POST is rate-limited and payload-capped; GET requires `ADMIN_PASS`
- Admin auth is password-based (Bearer token) — use a strong secret in production
- `ADMIN_PASS` must be **at least 16 characters**; shorter values cause admin
  endpoints to return `503 misconfigured` instead of silently granting access
- Admin auth uses a timing-safe comparison (`crypto.timingSafeEqual`) so
  brute-forcers cannot time-distinguish a correct prefix
- The Supabase service-role key is used only server-side; the browser only ever
  holds an anonymous `accessToken` for project isolation
- Research tables have Row Level Security enabled with **no public policies** —
  only the service role can read/write research data
- Card reports and chat snippets are truncated before storage

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). Requires `fetch`,
`localStorage`, and service workers (HTTPS or localhost).

## License

MIT — Group 4.