# Defense Prep — Performance & Reliability Fixes

## In progress
- [ ] `api/chat.js`: accept `messages` (chat memory) + compact `chapter` context; reduce max_tokens; add timeouts; cap total retry wait.
- [ ] `app.js`: `sendMessage()` send memory + compact chapter + client timeout (no stuck "...").
- [ ] `app.js`: `triggerInterrogation()` send trimmed chapter + client timeout + fewer retries.
- [ ] `styles.css`: cap card answer height (no overlap of Generate button) + loader sizes to card.

## Completed
- [x] Split index.html into styles.css + app.js (already done).
- [x] api/chat.js: no provider/model leak; generic error modal used.
- [x] app.js: re-populate dropdowns after folder scan.
- [x] Keep chapters 3–5 unavailable (no auto-detect) per requirement.

## Note (from Vercel runtime logs)
- Groq is hitting **429 rate limits** (TPM limit 12000 exceeded, e.g. "try again in ~32s", requested token spikes up to ~8300–8779). The current retry backoff (0.8s → 2.4s) is too short to ride out these waits, so the generic "AI service unavailable" modal can appear under load. Recommended: exponential backoff with longer waits (or honor Groq's `Retry-After` header) and/or upgrade the Groq tier.
