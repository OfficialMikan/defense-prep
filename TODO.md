# Defense Prep — Rate-Limit & Speed Optimization

## Goal
Make generation instant/fast and eliminate the 429 "AI unavailable" errors that appear after ~2 generations.

## Root cause
- Groq free org-level TPM limit of 12,000 is being exhausted after ~2 generations.
- Chatbot used `llama-3.3-70b-versatile` (70B) which consumes ~8x more tokens than the 8B fast model.
- Both paths re-send large chapter context; the flashcard path sends the FULL untruncated `dataDump`.
- Output `max_tokens` were high (400/600).

## Completed
- [x] **api/chat.js**: Use `llama-3.1-8b-instant` as the default for BOTH flashcard and chatbot (fast, ~8x cheaper). Keep 70b only as an env-var override.
- [x] **api/chat.js**: Truncate the flashcard prompt server-side (cap chars) so the full chapter isn't blasted into input tokens (`MAX_FLASHCARD_PROMPT_CHARS`).
- [x] **api/chat.js**: Lower chatbot `MAX_CHAPTER_CHARS` to ~6000.
- [x] **api/chat.js**: Reduce output `max_tokens` (flashcard ~280, chatbot ~400).
- [x] **api/chat.js**: Add automatic fallback to a faster/cheaper model when primary is rate-limited, plus a capped total retry wait and per-request timeout so the client never "hangs".
- [x] **app.js**: Don't embed the full chapter `dataDump` in the flashcard `prompt`; truncate to `MAX_FLASHCARD_DUMP_CHARS` (8000). For the chatbot, pass `messages` (memory) + `chapter` separately so the chapter isn't re-sent every turn.
- [x] **app.js**: Add a short cooldown between generations (`GENERATION_COOLDOWN_MS` = 8s) that disables the button and shows a "warming up" message.
- [x] **app.js**: Show a clearer "warming up / rate limit" message on 429 instead of the generic "unavailable".
- [x] **app.js**: Add client-side AbortController timeouts (flashcard 15s, chatbot 45s) so a slow request shows a clear error instead of an endless spinner.
- [x] **app.js**: Improve UX with an inline loading state on the Generate button and an opaque cover over the flashcard while generating.
- [x] **app.js**: Re-populate chapter/component dropdowns after the folder scan completes.
- [x] Verified JS syntax for `app.js`, `api/chat.js`, and `api/debug.js` (all pass).

## Follow-up
- Deploy and verify that generation no longer hits 429 after repeated uses.
- Set `GROQ_API_KEY` and test "Generate Flashcard" + chatbot against the `.txt` data dumps.
