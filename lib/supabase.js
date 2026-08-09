// ============================================================================
// lib/supabase.js
// ----------------------------------------------------------------------------
// Shared Supabase client for the research knowledge base endpoints.
//
// Uses the SUPABASE_SERVICE_ROLE_KEY so privileged operations bypass RLS. This
// key is a Vercel server-side environment variable and is NEVER sent to the
// browser. The research tables have RLS enabled with no public policies, so
// only this service-role client can access them.
//
// If the env vars are missing/invalid, returns null so endpoints can fall back
// gracefully (matching the existing behavior in api/analytics.js).
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isValidUrl = (typeof supabaseUrl === 'string') && /^https?:\/\/.+/.test(supabaseUrl);

const supabase = (isValidUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

module.exports = { supabase };
