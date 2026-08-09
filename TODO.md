# Defense Prep — Client-Side Integration + Final Validation

## Phase 7 — Wire client to persistent knowledge base
- [ ] app.js: add persistent accessToken (crypto.randomUUID in localStorage)
- [ ] app.js: add persistent sessionId + conversationId tracking
- [ ] app.js: ingest chapters on load via /api/ingest (best-effort)
- [ ] app.js: rewrite triggerInterrogation() to use server RAG (/api/chat)
- [ ] app.js: rewrite sendMessage() to use server RAG + conversation memory
- [ ] app.js: send selectedComponents + selectedChapter to /api/chat

## index.html / styles.css
- [ ] index.html: add research-status indicator element
- [ ] styles.css: add status indicator styles (if needed)

## Phase 8 — Cleanup
- [ ] app.js: remove obsolete client-side RAG functions (verify call sites first)
- [ ] README.md: document env vars + migration + ingest/retrieve flow

## Validation
- [ ] node --check all modified JS
- [ ] Confirm analytics untouched
- [ ] Confirm no service-role key in browser code
- [ ] Unit tests for lib modules (chunking, citations, hybrid, components)
