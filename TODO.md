# Defense Prep — Improvement Plan

## Completed
- [x] **Split index.html** into separate `styles.css` + `app.js` + minimal `index.html` for maintainability (works on Vercel static hosting).
- [x] **api/chat.js — reliability/correctness + no provider leak**
  - Success response returns only `{ choices: [{ message: { role, content } }] }` — no provider/model exposed to the client.
  - Generic, user-safe error message (`"The AI service is currently unavailable. Please try again later."`) — no "Groq"/model names leaked.
  - Reliability: primary model + faster/cheaper fallback model, honors `Retry-After` on 429, caps total retry wait so requests don't appear stuck, per-request timeout, and truncated chapter context to stay within the TPM/token budget.
  - Chatbot sends only the selected chapter's content once as system context; conversation turns pass as a `messages` array for memory without re-sending the whole chapter every turn.
- [x] **Generic AI-error modal** (no AI identity revealed)
  - Added reusable `#error-modal-overlay` modal in index.html saying "The AI service is currently unavailable. Please try again later."
  - Used for BOTH flashcard generation failures (`triggerInterrogation`) and chatbot failures (`sendMessage`).
  - Confirmation "Reset All" modal is kept untouched.
- [x] **Chapters 3–5 remain unavailable** (no auto-detect)
  - `chapterComponentOptions[3/4/5]` stay `{ available: false }`.
  - `populateChapterDropdown()` keeps disabling chapters > 2.
  - `setChapterFromDropdown()` continues to guard `selectedChapter <= 2`.
  - Chapters 3–5 will be added later by the user (files + component lists).
- [x] **Re-populate dropdowns after `loadChapterFilesFromFolder()` completes** in the `DOMContentLoaded` handler so any loaded chapters are reflected without a full reload.
- [x] **Add a "Refresh Files" button** (`refreshChapterBtn`) to re-scan for newly added chapter files without a full page reload.
- [x] **Verify JS syntax** for `app.js`, `api/chat.js`, and `api/debug.js` (all pass).

## Follow-up
- Set `GROQ_API_KEY` and test "Generate Flashcard" + chatbot against the `.txt` data dumps.
- When chapters 3–5 content is ready:
  - Add `chapter-3.txt/.pdf/.docx` … `chapter-5.txt/.pdf/.docx` to the `data/chapters` folder.
  - Add chapter-specific component lists to `chapterComponentOptions[3/4/5]` in `app.js`.
  - Remove the `disabled` gating in `populateChapterDropdown()` / `setChapterFromDropdown()`.
