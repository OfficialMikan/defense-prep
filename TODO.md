# TODO - Comprehensive Improvements

## High Priority (bugs/robustness)
- [x] 1. Unify config: app.js reads window.CHAPTER_CONFIG + GENERIC_COMPONENTS, remove duplicate chapterComponentOptions
- [x] 2. Honor chapterAutoDetect: drive chapter availability from config + files, not hardcoded [1,2]
- [x] 3. Remove dead code: unused favorites array, activeGenerationController, buildChapterSummary
- [x] 4. SW offline: cache CDN libs + /data/chapters/* for full offline
- [x] 5. Analytics hardening: cap payload, validate type, rate limit, TTL
- [x] 6. Lazy-load heavy libs (html2canvas, jsPDF, mammoth) on demand

## Medium (quality)
- [x] 7. Raise MAX_CHAPTER_CHARS / align with client retrieval size
- [x] 8. Sync README/vercel.json/package.json with reality

## New Features
- [x] 9. Chat logs in admin panel (record + display chatbot conversations)
- [x] 10. Per-user info in admin panel (aggregate by IP/device, session tracking)
- [x] 11. Accessibility pass (ARIA, keyboard nav for flip, reduced-motion, skip link)

## Optimization
- [x] 12. Fast & clean: remove dead code, event delegation for chapter preview
- [x] 13. Update TODO.md tracking

## Future ideas (not implemented)
- Spaced repetition scheduling for flashcards
- Mock full panel defense session mode
- Per-question scoring / self-assessment
- Admin drag-and-drop chapter upload UI
- Dark-mode aware PDF export
- Leaderboards / class progress tracking
