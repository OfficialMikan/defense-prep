# Defense Prep — Improvement Plan

## Tasks
- [x] **Fix JS syntax** in index.html (Chapter 1 & 2 `dataDump` template-literal delimiters)
- [x] **Add duplicate-question guard** in `triggerInterrogation` (regeneration loop, up to 3 attempts)
- [x] **Label generated cards** with the chapter title instead of generic "AI Research"
- [x] **api/chat.js**: Remove Gemini fallback; Groq is the only AI provider (with retry on 429/5xx)
- [x] **api/chat.js**: Success response returns only OpenAI-shaped `choices` — no provider/model leaked to the client
- [x] **api/chat.js**: Errors return a generic, user-safe message ("The AI service is currently unavailable…") — no "Groq"/model details leaked
- [x] **index.html**: Chapter panel shows PDF preview instead of text summary/overview
- [x] **index.html**: Keep `.txt` files as the data dump for chatbot + flashcards (no fallback; errors if missing)
- [x] **index.html / app.js**: Generic AI-error modal (`#error-modal-overlay` + `showErrorModal`) used for both flashcard generation and chatbot failures (no raw `alert()` of AI details)
- [x] **index.html / app.js**: Splitting into separate `styles.css` + `app.js` + minimal `index.html` (already external — verified, no inline styles/scripts)
- [x] **app.js**: Chapter/component dropdowns re-populated after `loadChapterFilesFromFolder()` completes (no full reload needed)
- [x] **Decision**: Chapters 3–5 remain **unavailable** (no auto-detect) — they will be added later
- [x] **index.html**: Keep the confirmation "Reset All" modal untouched
- [x] **Verify** JS syntax for both index.html and api/chat.js (both pass)

## Follow-up
- Set `GROQ_API_KEY` and test "Generate Flashcard" + chatbot against the `.txt` data dumps
- **Observed in Vercel logs**: Groq is returning `429` rate-limit errors (TPM limit 12000 exceeded, "try again in ~22–33s"). The current server retry backoff (`800ms` × attempt) is too short to out-wait these. If flashcard/chatbot errors persist, consider increasing the retry backoff / adding exponential wait, or upgrading the Groq service tier.
