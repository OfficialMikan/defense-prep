# Defense-Prep Refactoring Plan

## Steps

- [x] 1. Create `css/styles.css` — Extract all CSS from index.html
- [x] 2. Create `js/data.js` — Research proposal data & component definitions
- [x] 3. Create `js/storage.js` — localStorage helpers (history, chat, dark mode, favorites)
- [x] 4. Create `js/api.js` — Centralized fetch helper for /api/chat
- [x] 5. Create `js/app.js` — Core app logic (flashcards, history, PDF export, photo capture, dark mode, sidebar)
- [x] 6. Create `js/chatbot.js` — Chatbot messaging logic
- [x] 7. Create `index.html` — Slimmed down, references external files, CDN scripts with `defer`
- [x] 8. Harden `api/chat.js` — Input validation, rate limiting, prompt length limits, CORS
- [x] 9. Create config files — `package.json`, `vercel.json`, `.env.example`, `.gitignore`, `README.md`
- [x] 10. Archive `index.html.bak` to `archive/` and remove from root
- [x] 11. Verify all functionality works
- [x] 12. Create `sw.js` — Service worker
- [x] 13. Create tests — `tests/_test-runner.js`, `tests/storage.test.js`, `tests/api.test.js`, `tests/toast.test.js`, `tests/run.js`

## Bug Fixes Applied

- `syncCardDisplaySurface()` — use `dataset.originalIndex` for correct active item (fixes filter bug)
- `deleteHistoryItem()` — properly adjust `executionPointerIndex` when deleting before current
- `.loader` CSS — remove conflicting `display: flex` from base rule
- Nested media query — merge into proper structure
- `toggleChatbot()` — don't reset/erase chat history on open
- Remove dead `favorites` variable
- Add missing dark mode toggle background update

## Performance

- CDN scripts (html2canvas, jsPDF, Google Fonts) — add `defer`
- Cache DOM element lookups
- Use event delegation where appropriate
- Virtual scrolling for history list (>50 items)
