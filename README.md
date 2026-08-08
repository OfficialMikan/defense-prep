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
| `GROQ_API_KEY` | Yes | Groq API key for `/api/chat` |
| `ADMIN_PASS` | For admin | Password for the analytics dashboard |
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
│   ├── chat.js         Groq AI proxy (flashcards + chat)
│   └── analytics.js    Event logging + admin API
└── data/chapters/      Chapter .txt / .pdf / .docx files
```

## Deployment

Deploy to [Vercel](https://vercel.com):

```bash
npx vercel --prod
```

`vercel.json` sets security headers and service-worker-friendly caching for `/sw.js`.

## AI backend

The app uses **Groq** (`openai/gpt-oss-20b` / `openai/gpt-oss-120b`) via
`/api/chat.js`. API keys stay server-side — never exposed in the browser.

## Security notes

- Analytics POST is rate-limited and payload-capped; GET requires `ADMIN_PASS`
- Admin auth is password-based (Bearer token) — use a strong secret in production
- Card reports and chat snippets are truncated before storage

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). Requires `fetch`,
`localStorage`, and service workers (HTTPS or localhost).

## License

MIT — Group 4.
