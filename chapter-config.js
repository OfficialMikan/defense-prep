/* ============================================================
   Defense Prep - Chapter Configuration
   ============================================================
   Central place to control which chapters are available and what
   research components each chapter offers in the component dropdown.

   HOW AUTO-DETECT WORKS:
   - A chapter becomes "available" in the UI when it has a loaded
     .txt (or .docx) file in data/chapters/. You do NOT need to
     edit this file just to enable a chapter — adding the files
     is enough.
   - The `components` list below lets you define exactly which
     research components each chapter should show in the dropdown.

   TO ADD / CUSTOMIZE COMPONENTS FOR A CHAPTER:
   - Edit the `components` array for that chapter below.
   - Each entry: { key, name, available }
       key       - a stable identifier used in the code
       name      - the label shown in the dropdown
       available - whether the option is selectable (false = greyed)
   - The first entry ("all") is the "All Components (Random)" option
     and is required for every chapter.
============================================================ */

const CHAPTER_CONFIG = {
    1: {
        chapterTitle: 'Chapter 1',
        components: [
            { key: 'all', name: 'All Components (Random)', available: true },
            { key: 'title', name: 'Title', available: true },
            { key: 'introduction', name: 'Introduction', available: true },
            { key: 'research_design', name: 'Research Design', available: true },
            { key: 'respondents', name: 'Respondents', available: true },
            { key: 'motivation', name: 'Motivation', available: true },
            { key: 'research_gap', name: 'Research Gap', available: true },
            { key: 'statement', name: 'Statement of Problem', available: true },
            { key: 'method', name: 'Research Method', available: true },
            { key: 'references', name: 'References', available: true }
        ]
    },
    2: {
        chapterTitle: 'Chapter 2',
        components: [
            { key: 'all', name: 'All Components (Random)', available: true },
            { key: 'research_design', name: 'Research Design', available: true },
            { key: 'respondents_participants', name: 'Respondents/Participants', available: true },
            { key: 'instruments', name: 'Instruments', available: true },
            { key: 'ethical_considerations', name: 'Ethical Considerations', available: true },
            { key: 'data_collection', name: 'Data Collection', available: true },
            { key: 'data_analysis', name: 'Data Analysis/Statistical Treatment of Data', available: true },
            { key: 'references', name: 'References', available: true }
        ]
    },
    // Chapters 3, 4, 5 are auto-detected from files. When you add files for
    // a chapter, provide its component list here. If you leave components
    // blank, the app falls back to a generic set:
    //   - If a chapter has no custom list, it uses `GENERIC_COMPONENTS`.
    3: {
        chapterTitle: 'Chapter 3',
        // Example: add your own components for Chapter 3 below.
        components: [
            { key: 'all', name: 'All Components (Random)', available: true },
            { key: 'research_design', name: 'Research Design', available: true },
            { key: 'respondents_participants', name: 'Respondents/Participants', available: true },
            { key: 'instruments', name: 'Instruments', available: true },
            { key: 'data_collection', name: 'Data Collection', available: true },
            { key: 'data_analysis', name: 'Data Analysis', available: true }
        ]
    },
    4: {
        chapterTitle: 'Chapter 4',
        // Customize here when Chapter 4 files are added.
        components: [
            { key: 'all', name: 'All Components (Random)', available: true },
            { key: 'results', name: 'Results', available: true },
            { key: 'discussion', name: 'Discussion', available: true }
        ]
    },
    5: {
        chapterTitle: 'Chapter 5',
        // Customize here when Chapter 5 files are added.
        components: [
            { key: 'all', name: 'All Components (Random)', available: true },
            { key: 'conclusion', name: 'Conclusion', available: true },
            { key: 'recommendations', name: 'Recommendations', available: true }
        ]
    }
};

// Generic fallback used if a chapter has no custom components list defined.
const GENERIC_COMPONENTS = [
    { key: 'all', name: 'All Components (Random)', available: true },
    { key: 'introduction', name: 'Introduction', available: true },
    { key: 'research_design', name: 'Research Design', available: true },
    { key: 'respondents', name: 'Respondents', available: true },
    { key: 'method', name: 'Research Method', available: true },
    { key: 'results', name: 'Results', available: true },
    { key: 'discussion', name: 'Discussion', available: true },
    { key: 'conclusion', name: 'Conclusion', available: true },
    { key: 'recommendations', name: 'Recommendations', available: true }
];

// Local config for the app (used by app.js):
// `chapterAutoDetect` (default true) turns auto-detection of chapters 3-5 on/off.
// When false, chapters 3-5 stay unavailable even if files exist.
const APP_CONFIG = {
    chapterAutoDetect: true
};

// Expose for browser (script) usage. This file is loaded before app.js.
window.CHAPTER_CONFIG = CHAPTER_CONFIG;
window.GENERIC_COMPONENTS = GENERIC_COMPONENTS;
window.APP_CONFIG = APP_CONFIG;
