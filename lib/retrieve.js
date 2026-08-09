// ============================================================================
// lib/retrieve.js
// ----------------------------------------------------------------------------
// Core hybrid-retrieval logic shared by /api/retrieve.js and /api/chat.js.
//
// Responsibilities (kept separate from the LLM invocation):
//   - resolve project (access-token validated)
//   - keyword / full-text search
//   - semantic / vector search (pgvector, graceful fallback)
//   - citation-aware chunk search
//   - hybrid fusion (lib/hybrid.js)
//   - fetch only the relevant references (never the whole bibliography)
//   - fetch the research map + active document count
//
// SECURITY: project isolation is enforced here via a server-validated
// access_token; every query carries a project_id filter.
// ============================================================================

const { supabase } = require('./supabase');
const dbg = require('../api/debug');
const hybrid = require('./hybrid');
const citationsLib = require('./citations');
const { embedText, isEmbeddingAvailable } = require('./embeddings');

// Resolve a project from an access token (strict — must exist).
async function resolveProject(accessToken) {
    if (!accessToken || typeof accessToken !== 'string') {
        const err = new Error('Missing project access token');
        err.status = 400;
        throw err;
    }
    const { data, error } = await supabase
        .from('research_projects')
        .select('id,title,access_token')
        .eq('access_token', accessToken)
        .maybeSingle();
    if (error) {
        const e = new Error('Supabase query failed');
        e.status = 502;
        throw e;
    }
    if (!data) {
        const e = new Error('Project not found');
        e.status = 404;
        throw e;
    }
    return data;
}

// Join a chunk row with its active document (doc_number) and section
// (component_key) metadata so downstream ranking (hybrid.fuse) and
// context labeling (buildContextText) have the fields they need.
async function enrichChunks(projectId, rows) {
    if (!rows || rows.length === 0) return [];

    const docIds = [...new Set(rows.map((r) => r.document_id).filter(Boolean))];
    const sectionIds = [...new Set(rows.map((r) => r.section_id).filter(Boolean))];

    const docMap = new Map();
    if (docIds.length) {
        const { data: docs } = await supabase
            .from('research_documents')
            .select('id,doc_number,title')
            .eq('project_id', projectId)
            .eq('is_active', true)
            .in('id', docIds);
        for (const d of docs || []) docMap.set(d.id, d);
    }

    const sectionMap = new Map();
    if (sectionIds.length) {
        const { data: sections } = await supabase
            .from('research_sections')
            .select('id,component_key')
            .eq('project_id', projectId)
            .in('id', sectionIds);
        for (const s of sections || []) sectionMap.set(s.id, s);
    }

    return rows.map((row) => {
        const doc = docMap.get(row.document_id) || null;
        const section = sectionMap.get(row.section_id) || null;
        return {
            ...row,
            doc_number: doc ? doc.doc_number : null,
            doc_title: doc ? doc.title : null,
            component_key: section ? section.component_key : null
        };
    });
}

// Keyword / full-text search against active chunks for a project.
async function keywordSearch(projectId, query, limit) {
    const clean = (query || '').trim();
    if (!clean) return [];

    // W2: Build a safe, valid full-text query. The Supabase JS `textSearch`
    // `plain`/`phrase` parsers do NOT support the `:*` prefix operator, and
    // feeding `word:*` through them yields a malformed/empty tsquery. We instead
    // use the `websearch` parser (websearch_to_tsquery), which safely parses
    // free-text input and supports boolean operators. We strip punctuation,
    // tokenize to alphanumeric words (>2 chars), and OR them so any single
    // matching term still returns results (recall); the JS keyword scorer below
    // then re-ranks by how many query terms actually appear. This is
    // injection-safe (no raw user string is interpolated into SQL) and returns
    // an empty set gracefully when there are no valid tokens.
    const tokens = clean
        .split(/[^a-zA-Z0-9]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 2)
        .slice(0, 12);
    if (tokens.length === 0) return [];
    const webQuery = tokens.join(' OR ');

    // Only select chunks whose parent document is active (is_active = true).
    let q = supabase
        .from('research_chunks')
        .select(`
            id,project_id,document_id,section_id,chunk_index,content,token_count,
            research_documents!inner(id,doc_number,title,is_active)
        `)
        .eq('project_id', projectId)
        .eq('research_documents.is_active', true);

    q = q.textSearch('content_tsv', webQuery, { type: 'websearch', config: 'english' });
    q = q.limit(limit);

    const { data, error } = await q;
    if (error) {
        dbg.error('lib/retrieve', 'keyword search failed: ' + error.message);
        return [];
    }
    const words = clean.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const joined = (data || []).map((r) => {
        const doc = (r.research_documents && r.research_documents[0]) || null;
        return {
            ...r,
            doc_number: doc ? doc.doc_number : null,
            doc_title: doc ? doc.title : null
        };
    });
    const embedded = await enrichChunks(projectId, joined);
    return embedded
        .map((row) => {
            const text = (row.content || '').toLowerCase();
            let score = 0;
            for (const w of words) {
                if (text.includes(w)) score += 1;
            }
            return { ...row, _kwScore: score };
        })
        .filter((r) => r._kwScore > 0)
        .sort((a, b) => b._kwScore - a._kwScore)
        .slice(0, limit);
}

// Semantic / vector search (pgvector RPC) when embeddings are available.
// The RPC must only return chunks from active documents; it is expected to
// join research_chunks -> research_documents and filter is_active = true.
async function vectorSearch(project, query, limit) {
    const embedding = await embedText(query);
    if (!embedding) return [];
    const { data, error } = await supabase.rpc('search_research_chunks', {
        p_project_id: project.id,
        p_embedding: embedding,
        p_limit: limit
    });
    if (error) {
        dbg.error('lib/retrieve', 'vector search failed: ' + error.message);
        return [];
    }
    const rows = data || [];
    return enrichChunks(project.id, rows.map((r) => ({ ...r })));
}

// Citation-aware chunk retrieval: find chunks containing a queried author.
// Restricts to chunks whose parent document is active (is_active = true).
async function citationSearch(projectId, queryCitations, limit) {
    if (!queryCitations || !queryCitations.length) return [];
    const chunks = [];
    for (const cit of queryCitations) {
        const author = (cit.author || '').trim();
        if (!author) continue;
        const { data, error } = await supabase
            .from('research_chunks')
            .select(`
                id,project_id,document_id,section_id,chunk_index,content,token_count,
                research_documents!inner(id,doc_number,title,is_active)
            `)
            .eq('project_id', projectId)
            .eq('research_documents.is_active', true)
            .ilike('content', `%${author}%`)
            .limit(limit);
        if (!error && data) {
            for (const r of data) {
                const doc = (r.research_documents && r.research_documents[0]) || null;
                chunks.push({
                    ...r,
                    doc_number: doc ? doc.doc_number : null,
                    doc_title: doc ? doc.title : null
                });
            }
        }
    }
    const seen = new Set();
    const unique = chunks.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
    });
    return enrichChunks(projectId, unique).slice(0, limit);
}

// Fetch only the relevant references linked to retrieved chunks / query authors.
async function fetchReferences(projectId, chunks, queryCitations, limit) {
    const refs = [];
    const refIds = new Set();

    const chunkIds = (chunks || []).map((c) => c.id);
    if (chunkIds.length) {
        const { data: citations } = await supabase
            .from('research_citations')
            .select('id')
            .eq('project_id', projectId)
            .in('chunk_id', chunkIds);
        const citIds = (citations || []).map((c) => c.id);
        if (citIds.length) {
            const { data: links } = await supabase
                .from('citation_reference_links')
                .select('reference_id')
                .in('citation_id', citIds);
            const refIdList = (links || []).map((l) => l.reference_id);
            if (refIdList.length) {
                // F5: only return references belonging to ACTIVE document
                // versions, so stale bibliography from superseded chapters is
                // never injected into retrieval results.
                const { data: refRows } = await supabase
                    .from('research_references')
                    .select('id,reference_text,author,year,title,research_documents!inner(id,is_active)')
                    .eq('project_id', projectId)
                    .eq('research_documents.is_active', true)
                    .in('id', refIdList);
                for (const r of refRows || []) {
                    if (refIds.has(r.id)) continue;
                    refIds.add(r.id);
                    refs.push(r);
                }
            }
        }
    }

    for (const cit of queryCitations || []) {
        const author = (cit.author || '').toLowerCase();
        if (!author) continue;
        // F5: restrict to references belonging to active document versions.
        const { data } = await supabase
            .from('research_references')
            .select('id,reference_text,author,year,title,research_documents!inner(id,is_active)')
            .eq('project_id', projectId)
            .eq('research_documents.is_active', true)
            .ilike('author', `${author}%`)
            .limit(limit);
        for (const r of data || []) {
            if (refIds.has(r.id)) continue;
            refIds.add(r.id);
            refs.push(r);
        }
    }

    return refs.slice(0, limit);
}

// Fetch the latest research map for a project.
async function fetchResearchMap(projectId) {
    const { data } = await supabase
        .from('research_maps')
        .select('*')
        .eq('project_id', projectId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
    return data || null;
}

// Count active documents (for the research_available flag).
async function countActiveDocuments(projectId) {
    const { count } = await supabase
        .from('research_documents')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('is_active', true);
    return count || 0;
}

/**
 * Build a context block string from retrieved chunks with source labels.
 * Each chunk is labeled so the model knows where the text came from.
 */
function buildContextText(chunks, researchMap) {
    const chapterLookup = {};
    if (researchMap && Array.isArray(researchMap.chapter_order)) {
        for (const c of researchMap.chapter_order) chapterLookup[c.number] = c.title;
    }
    const parts = [];
    for (const c of chunks || []) {
        const chapter = chapterLookup[c.doc_number] || (c.doc_number ? `Chapter ${c.doc_number}` : 'unknown chapter');
        // section heading is not included in chunk rows; we label by chapter + index.
        const label = `[Research: ${chapter} — Chunk ${(c.chunk_index || 0) + 1}]`;
        parts.push(`${label}\n${c.content}`);
    }
    return parts.join('\n\n');
}

/**
 * Main entry: perform hybrid retrieval and return structured results.
 */
async function retrieve({ accessToken, query, selectedComponents = [], selectedChapter = null, retrievalMode = 'chat' }) {
    const project = await resolveProject(accessToken);
    const limit = hybrid.RETRIEVAL_LIMITS[retrievalMode] || hybrid.RETRIEVAL_LIMITS.chat;
    const refLimit = hybrid.RETRIEVAL_LIMITS.reference;

    const queryCitations = citationsLib.detectCitations(query);

    const kwResults = await keywordSearch(project.id, query, limit);
    const vecResults = await vectorSearch(project, query, limit);
    const citResults = await citationSearch(project.id, queryCitations, limit);

    const fused = hybrid.fuse(
        [kwResults, vecResults, citResults].filter((l) => l.length),
        {
            componentKeys: selectedComponents,
            chapterNumber: selectedChapter,
            queryCitations
        }
    );

    const chunks = fused.slice(0, limit);
    const references = await fetchReferences(project.id, chunks, queryCitations, refLimit);
    const researchMap = await fetchResearchMap(project.id);
    const docCount = await countActiveDocuments(project.id);

    return {
        project,
        chunks,
        references,
        researchMap,
        docCount,
        usedVector: vecResults.length > 0,
        embeddingAvailable: isEmbeddingAvailable()
    };
}

module.exports = {
    retrieve,
    resolveProject,
    buildContextText,
    keywordSearch,
    vectorSearch,
    citationSearch,
    fetchReferences,
    fetchResearchMap,
    countActiveDocuments
};
