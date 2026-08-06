# Group 4 — Title Defense Training

An AI-powered research panel defense simulator. Practice your thesis / capstone
title defense with AI-generated questions across multiple research components,
difficulty levels, and tracks. Includes a built-in chatbot coach, progress
history, photo and PDF export, dark mode, and offline support.

## Features

- **Flashcard-style defense trainer** — random or sequential questions across
  eight research components (Problem Statement, Objectives, Methodology, etc.).
- **Adjustable difficulty** — Easy, Medium, Hard.
- **AI Question Generation** — pluggable backends (Google Gemini, Groq, OpenAI).
- **AI Chatbot Coach** — get hints, feedback, or clarifications in chat.
- **History tracking** — every card you see is saved locally; accessible via the
  sidebar with filter and delete.
- **Photo export** — render a flashcard as a shareable image.
- **PDF export** — download the full session as a PDF.
- **Dark mode** — light / dark / system with persistent preference.
- **Toast notifications** — non-blocking success / error feedback.
- **Modal confirmations** — accessible dialogs for destructive actions.
- **Progressive Web App** — installs to home screen, works offline
  (cache-first for CDN, stale-while-revalidate for app shell).
- **Accessibility** — keyboard navigation, skip link, ARIA roles, reduced-motion
  support.

## Quick Start

### Serve locally

```bash
# Option 1: any static server
npx http-server -p 8080 -c-1 .

# Option 2: Vercel CLI (matches production)
npx vercel dev
```

Then open `http://localhost:8080`.

### Run tests

```bash
# All suites
npm test

# Individual suite
npm run test:storage
npm run test:api
npm run test:toast
```

Tests use Node `vm` to load the production scripts with a mocked
`localStorage` / `fetch` / `document` — no dependencies required.

## Deployment

The project is configured for [Vercel](https://vercel.com):

- `vercel.json` declares:
  - Strict Content-Security-Policy (script-src `'self'` + SRI-hashed CDN).
  - HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
    Permissions-Policy.
  - Service-worker-friendly headers for `/sw.js` (`Service-Worker-Allowed: /`).
  - 5-minute cache for `/data/*`.
- The `api/chat.js` serverless function proxies AI calls so API keys are not
  exposed in the browser.

Deploy with:

```bash
npx vercel --prod
```

## Security

- **CSP** restricts scripts to `'self'` plus the two CDN bundles (each pinned
  with Subresource Integrity hashes).
- **`unsafe-inline`** styles are allowed only because SVG data URIs are rendered
  with inline color attributes.
- **API keys** are not stored in the client. Edit `api/chat.js` to set server-side
  environment variables (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`).
- **No third-party trackers.**

## Browser Support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). Uses:

- `fetch`, `AbortController`, `localStorage`
- Service workers (registration only on `https:` or `localhost`)
- CSS custom properties, `prefers-color-scheme`, `prefers-reduced-motion`

## License

MIT — Group 4.
