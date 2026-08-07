# Defense Prep — Improvement Plan

## Tasks
- [x] **Fix JS syntax** in index.html (Chapter 1 & 2 `dataDump` template-literal delimiters)
- [x] **Add duplicate-question guard** in `triggerInterrogation` (regeneration loop, up to 3 attempts)
- [x] **Label generated cards** with the chapter title instead of generic "AI Research"
- [x] **api/chat.js**: Groq is the only AI provider (with retry on 429/5xx + model fallback)
- [x] **api/chat.js**: No provider/model leak in success payload or error messages (generic, user-safe)
- [x] **index.html**: Chapter panel shows PDF preview instead of text summary/overview
- [x] **index.html**: Keep `.txt` files as the data dump for chatbot + flashcards (no fallback; errors if missing)
- [x] **Generic AI-error modal** (`#error-modal-overlay`) used for both flashcard + chatbot failures — no raw `alert()` exposes AI details
- [x] **Keep confirmation "Reset All" modal** untouched
- [x] **Re-populate chapter/component dropdowns** after `loadChapterFilesFromFolder()` completes
- [x] **Chapters 3–5 remain unavailable** (no auto-detect) — they will be added later
- [x] **Speed**: reduced server-side retry budget (6s) and request timeout (20s); flashcard uses fast model
- [x] **Verify** JS syntax for both index.html and api/chat.js (both pass)

## Follow-up
- Set `GROQ_API_KEY` and test "Generate Flashcard" + chatbot against the `.txt` data dumps
- Chapters 3–5 files will be added to `data/chapters/` later; enable them in `app.js` then
