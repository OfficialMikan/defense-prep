# Defense Prep — Improvement Plan

## Tasks
- [x] **Fix JS syntax** in index.html (Chapter 1 & 2 `dataDump` template-literal delimiters)
- [x] **Add duplicate-question guard** in `triggerInterrogation` (regeneration loop, up to 3 attempts)
- [x] **Label generated cards** with the chapter title instead of generic "AI Research"
- [x] **api/chat.js**: Remove Gemini fallback; Groq is the only AI provider (with retry on 429/5xx)
- [x] **api/chat.js**: Success payload exposes only `{ choices[0].message.content }` — provider/model never leaked to the client
- [x] **api/chat.js**: Error responses return a generic, user-safe message ("The AI service is currently unavailable…") — no "Groq"/model details leaked
- [x] **index.html**: Chapter panel shows PDF preview instead of text summary/overview
- [x] **index.html**: Keep `.txt` files as the data dump for chatbot + flashcards (no fallback; errors if missing)
- [x] **Generic AI-error modal**: `#error-modal-overlay` + `showErrorModal()` used for both flashcard generation and chatbot failures (no raw `alert()` spilling AI/provider details)
- [x] **Confirmation "Reset All" modal** left untouched
- [x] **Chapters 3–5 remain unavailable** in the UI (per decision — no auto-detect; added later by the user)
- [x] **app.js**: Re-populate chapter + component dropdowns after `loadChapterFilesFromFolder()` completes (so loaded files reflect without a full reload)
- [x] **Verify** JS syntax for `app.js`, `api/chat.js`, and `api/debug.js` (all pass)
- [x] **Suggest** more improvements & features (see completion note)

## Follow-up
- Set `GROQ_API_KEY` and test "Generate Flashcard" + chatbot against the `.txt` data dumps
- **Rate-limit (429) note**: Vercel logs show Groq hitting TPM limits (`llama-3.3-70b-versatile`, limit ~12000). The current retry backoff (800ms/1600ms/2400ms) is shorter than Groq's reported "try again in ~30s" reset, so requests can still fail with the generic error modal despite retries. Consider:
  - Using a faster/cheaper model or upgrading the Groq tier to raise the TPM limit.
  - Honoring the `Retry-After` header on 429 responses, or increasing the coexistence of retry attempts in `api/chat.js`.
