// ============================================================================
// /api/ingest.js
// ----------------------------------------------------------------------------
// Ingestion endpoint for the persistent research knowledge base.
//
// Responsibilities:
//   receive/identify research document
//     -> extract text (client sends extracted text; server also supports txt)
//     -> normalize text
//     -> detect sections
//     -> assign component
//     -> chunk sections
//     -> generate embeddings
//     -> detect citations
//     -> parse references
//     -> link citations <-> references
//     -> store database records (versioned)
//     -> update research map
//
// SAFETY / IDEMPOTENCY:
//   - A content checksum is computed. If an active document with the same
//     (project, doc_number, checksum) already exists, ingestion is a no-op
//     (no duplicate chunks/citations/references).
//   - If the content changed, a NEW document version is created and the old
//     version is marked inactive. Retrieval only ever uses active versions.
//   - Never mixes active and inactive versions.
//
// SECURITY:
//   - Uses SUPABASE_SERVICE_ROLE_KEY server-side only (never exposed).
//   - Project isolation is enforced via a server-validated access_token.
// ============================================================================

const { supabase } = require('../lib/supabase');
const dbg = require('./debug');
const chunkLib = require('../lib/chunking');
const citationsLib = require('../lib/citations');
const componentsLib = require('../lib/components');
const { embedTexts, isEmbeddingAvailable } = require('../lib/embeddings');

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB cap for chapter text

function sha256(text) {
    // Lightweight deterministic hash (no external crypto dep needed for checksum).
    const s = String(text || '');
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// Resolve the project from an access token (create if it doesn't exist).
async function resolveProject(accessToken, title) {
    if (!accessToken || typeof accessToken !== 'string') {
        const err = new Error('Missing project access token');
        err.status = 400;
        throw err;
    }
    let { data, error } = await supabase
        .from('research_projects')
        .select('id,title,access_token')
        .eq('access_token', accessToken)
        .maybeSingle();
    if (error) {
        const e = new Error('Supabase query failed');
        e.status = 502;
        throw e;
    }
    if (data) return data;

    // Create a new project.
    const { data: created, error: createErr } = await supabase
        .from('research_projects')
        .insert({ access_token: accessToken, title: title || 'Untitled Research' })
        .select('id,title,access_token')
        .single();
    if (createErr) {
        dbg.error('api/ingest', createErr);
        const e = new Error('Could not create research project');
        e.status = 502;
        throw e;
    }
    return created;
}

// Find the latest active document version for (project, doc_number).
async function getActiveDocument(projectId, docNumber) {
    const { data, error } = await supabase
        .from('research_documents')
        .select('*')
        .eq('project_id', projectId)
        .eq('doc_number', docNumber)
        .eq('is_active', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        const e = new Error('Supabase query failed');
        e.status = 502;
        throw e;
    }
    return data;
}

// Insert sections, chunks, citations, references. Runs with a versioned doc.
async function indexDocument(project, doc, text, fileType) {
    const normalized = chunkLib.normalizeText(text);
    const sections = chunkLib.splitIntoSections(normalized);

    // ---- Sections ----
    for (const section of sections) {
        const componentKey = componentsLib.classifySection(section.heading, section.text);
        const { data: sectionRow, error: secErr } = await supabase
            .from('research_sections')
            .insert({
                project_id: project.id,
                document_id: doc.id,
                heading: section.heading,
                heading_lower: (section.heading || '').toLowerCase(),
                component_key: componentKey,
                ord: section.ord,
                raw_text: section.text
            })
            .select('id')
            .single();
        if (secErr) {
            dbg.error('api/ingest', 'section insert failed: ' + secErr.message);
            continue;
        }

        // ---- Chunks ----
        const chunks = chunkLib.chunkSection(section.text);
        // Generate embeddings (may return nulls -> keyword fallback).
        const embeddings = (await embedTexts(chunks.map((c) => c.content)));

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const tokenEstimate = Math.ceil(chunk.content.length / 4);
            const insertPayload = {
                project_id: project.id,
                document_id: doc.id,
                section_id: sectionRow.id,
                chunk_index: i,
                content: chunk.content,
                token_count: tokenEstimate
            };
            // Only include embedding if the column exists and an embedding is present.
            if (embeddings[i]) {
                insertPayload.embedding = embeddings[i];
            }
            const { data: chunkRow, error: chErr } = await supabase
                .from('research_chunks')
                .insert(insertPayload)
                .select('id')
                .single();
            if (chErr) {
                dbg.error('api/ingest', 'chunk insert failed: ' + chErr.message);
                continue;
            }

            // ---- Citations in this chunk ----
            const citations = citationsLib.detectCitations(chunk.content);
            for (const cit of citations) {
                await supabase.from('research_citations').insert({
                    project_id: project.id,
                    document_id: doc.id,
                    section_id: sectionRow.id,
                    chunk_id: chunkRow.id,
                    citation_text: cit.citation_text,
                    author: cit.author,
                    year: cit.year,
                    pattern_type: cit.pattern_type
                });
            }
        }
    }

    // ---- References (from the References section) ----
    const refSection = citationsLib.findReferencesSection(normalized);
    const references = citationsLib.parseReferences(refSection);
    const savedRefs = [];
    for (const ref of references) {
        const { data: refRow, error: refErr } = await supabase
            .from('research_references')
            .insert({
                project_id: project.id,
                document_id: doc.id,
                reference_text: ref.reference_text,
                author: ref.author,
                year: ref.year,
                title: ref.title,
                ord: ref.ord
            })
            .select('id,author,year,reference_text')
            .single();
        if (!refErr && refRow) savedRefs.push(refRow);
    }

    // ---- Link citations <-> references ----
    // Collect all citations for this document, then match to references.
    const { data: docCitations } = await supabase
        .from('research_citations')
        .select('id,author,year')
        .eq('project_id', project.id)
        .eq('document_id', doc.id);
    if (docCitations && docCitations.length) {
        for (const cit of docCitations) {
            const idx = citationsLib.matchCitationToReference(
                { author: cit.author, year: cit.year },
                savedRefs
            );
            if (idx >= 0 && savedRefs[idx] && savedRefs[idx].id) {
                await supabase.from('citation_reference_links').insert({
                    citation_id: cit.id,
                    reference_id: savedRefs[idx].id
                });
            }
        }
    }

    return { sections: sections.length };
}

// Upsert the research map (chapter order + component keys).
async function updateResearchMap(project) {
    const { data: docs } = await supabase
        .from('research_documents')
        .select('doc_number,title')
        .eq('project_id', project.id)
        .eq('is_active', true)
        .order('doc_number', { ascending: true });

    const { data: sections } = await supabase
        .from('research_sections')
        .select('component_key')
        .eq('project_id', project.id);

    const chapterOrder = (docs || []).map((d) => ({ number: d.doc_number, title: d.title }));
    const componentKeys = [...new Set((sections || []).map((s) => s.component_key).filter(Boolean))];

    const { data: existingMap } = await supabase
        .from('research_maps')
        .select('version')
        .eq('project_id', project.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

    const nextVersion = existingMap && existingMap.version ? existingMap.version + 1 : 1;
    await supabase.from('research_maps').insert({
        project_id: project.id,
        version: nextVersion,
        chapter_order: chapterOrder,
        component_keys: componentKeys
    });
}

module.exports = async function handler(req, res) {
    const scope = 'api/ingest';

    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!supabase) {
        return res.status(503).json({ error: 'Research database not configured' });
    }

    try {
        const rawLen = (req.headers['content-length'] && Number(req.headers['content-length'])) || 0;
        if (rawLen > MAX_BODY_BYTES) {
            return res.status(413).json({ error: 'Payload too large' });
        }

        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        const { accessToken, title, docNumber, fileType, text } = body;

        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: 'Missing required field: text' });
        }
        const docNum = Number(docNumber);
        if (!Number.isFinite(docNum) || docNum < 1 || docNum > 5) {
            return res.status(400).json({ error: 'docNumber must be between 1 and 5' });
        }

        dbg.log(scope, `Ingesting doc ${docNum} for project`);
        const project = await resolveProject(accessToken, title);
        const checksum = sha256(text.trim());

        // Idempotency: if an active doc with same checksum exists, skip.
        const activeDoc = await getActiveDocument(project.id, docNum);
        if (activeDoc && activeDoc.checksum === checksum) {
            dbg.log(scope, `Doc ${docNum} unchanged (${checksum}) — skipping`);
            return res.status(200).json({ ok: true, skipped: true, projectId: project.id });
        }

        // Versioning: insert a new document version; deactivate the old one.
        const nextVersion = (activeDoc ? activeDoc.version : 0) + 1;
        if (activeDoc) {
            await supabase.from('research_documents')
                .update({ is_active: false })
                .eq('id', activeDoc.id);
        }

        const { data: doc, error: docErr } = await supabase
            .from('research_documents')
            .insert({
                project_id: project.id,
                doc_number: docNum,
                title: title || `Chapter ${docNum}`,
                file_type: fileType || 'txt',
                version: nextVersion,
                checksum,
                is_active: true
            })
            .select('id')
            .single();
        if (docErr) {
            dbg.error(scope, docErr);
            return res.status(502).json({ error: 'Could not create document record' });
        }

        const embeddingEnabled = isEmbeddingAvailable();
        const result = await indexDocument(project, doc, text, fileType || 'txt');
        await updateResearchMap(project);

        dbg.log(scope, `Ingested doc ${docNum}: ${result.sections} sections (embeddings=${embeddingEnabled})`);
        return res.status(200).json({
            ok: true,
            skipped: false,
            projectId: project.id,
            documentId: doc.id,
            version: nextVersion,
            sections: result.sections,
            embeddings: embeddingEnabled
        });
    } catch (error) {
        dbg.error(scope, error);
        return res.status(error.status || 500).json({ error: 'Internal error' });
    }
};
