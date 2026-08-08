# Task: Remove TTS, 3s wait, fix mobile PDF view

## Steps
- [x] Create TODO.md
- [x] Remove TTS (index.html buttons, app.js speakCard, styles.css .btn-tts-action)
- [x] Change intro loader wait from 900ms to 3000ms (app.js)
- [x] Replace inline PDF preview with a wide "View PDF" button in populateChapterPreview() (app.js)
- [x] Add wide button CSS + mobile responsive styles for chapter viewer (styles.css)
- [x] Verify mobile zoom is disabled (viewport meta already set; both the meta tag and the JS guard enforce user-scalable=no / maximum-scale=1.0)
