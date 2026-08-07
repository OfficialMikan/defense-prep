# Defense Prep — Improvement Plan

## Tasks
- [x] **Fix JS syntax** in index.html (Chapter 1 & 2 `dataDump` template-literal delimiters)
- [x] **Add duplicate-question guard** in `triggerInterrogation` (regeneration loop, up to 3 attempts)
- [x] **Label generated cards** with the chapter title instead of generic "AI Research"
- [x] **api/chat.js**: Remove Gemini fallback; Groq is the only AI provider (with retry on 429/5xx)
- [x] **index.html**: Chapter panel shows PDF preview instead of text summary/overview
- [x] **index.html**: Keep `.txt` files as the data dump for chatbot + flashcards (no fallback; errors if missing)
- [x] **Verify** JS syntax for both index.html and api/chat.js (both pass)
- [x] **Suggest** more improvements & features (see completion note)

## Follow-up
- Set `GROQ_API_KEY` and test "Generate Flashcard" + chatbot against the `.txt` data dumps
