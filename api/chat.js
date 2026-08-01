// /api/chat.js

/**
 * @fileoverview AI Chat API endpoint for the Panel Defense Simulator.
 * Handles both flashcard question generation and chatbot conversations
 * via Groq's OpenAI-compatible API.
 * 
 * Environment variables required:
 *   - GROQ_API_KEY (required): API key for Groq
 *   - GROQ_MODEL (optional): Model name, defaults to 'llama-3.3-70b-versatile'
 *   - ALLOWED_ORIGINS (optional): Comma-separated CORS origins
 *   - NODE_ENV (optional): 'production' for quieter logging
 * 
 * @author Refactored for production use
 */

// ==================== Configuration ====================

const CONFIG = Object.freeze({
    GROQ_API_URL: 'https://api.groq.com/openai/v1/chat/completions',
    DEFAULT_MODEL: 'llama-3.3-70b-versatile',
    DEFAULT_TEMPERATURE: 0,
    DEFAULT_MAX_TOKENS: 1000,

    // Limits
    REQUEST_TIMEOUT_MS: 30_000,
    MAX_PROMPT_LENGTH: 50_000,   // ~50KB
    MIN_PROMPT_LENGTH: 1,
    MAX_TOKENS_LIMIT: 4_000,

    // Rate limiting (in-memory; use Redis in production)
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX_REQUESTS: 20,

    // CORS
    DEFAULT_ALLOWED_ORIGINS: ['*'],
});

// ==================== Custom Errors ====================

/**
 * Base API error class with HTTP status semantics.
 */
class APIError extends Error {
    /**
     * @param {string} message - User-facing error message
     * @param {number} status - HTTP status code
     * @param {*} [details] - Additional context (not exposed in production)
     */
    constructor(message, status, details) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.details = details;
    }
}

class ValidationError extends APIError {
    constructor(details) {
        super('Invalid request payload', 400, details);
        this.name = 'ValidationError';
    }
}

class ConfigurationError extends APIError {
    constructor(message) {
        super('Server configuration error', 500);
        this.name = 'ConfigurationError';
        this.devMessage = message;
    }
}

class UpstreamError extends APIError {
    constructor(status, details) {
        super('Upstream AI service error', status >= 500 ? 502 : status, details);
        this.name = 'UpstreamError';
    }
}

class RateLimitError extends APIError {
    constructor(retryAfterSeconds) {
        super('Too many requests', 429);
        this.name = 'RateLimitError';
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

// ==================== Utilities ====================

/**
 * Lightweight logger that respects environment.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {Object} [metadata]
 */
function log(level, message, metadata = {}) {
    const isProd = process.env.NODE_ENV === 'production';
    const entry = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...(isProd ? {} : metadata),
    };

    // Production: only log warnings and errors as JSON
    if (isProd && (level === 'debug' || level === 'info')) return;

    const fn = console[level] || console.log;
    fn(JSON.stringify(entry));
}

/**
 * Returns the client IP from common proxy headers.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function getClientIdentifier(req) {
    return (
        req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
        req.headers['x-real-ip']?.toString() ||
        req.socket?.remoteAddress ||
        'unknown'
    );
}

/**
 * Get allowed origins from env.
 * @returns {string[]}
 */
function getAllowedOrigins() {
    const origins = process.env.ALLOWED_ORIGINS;
    if (!origins) return CONFIG.DEFAULT_ALLOWED_ORIGINS;
    return origins.split(',').map((o) => o.trim()).filter(Boolean);
}

/**
 * Apply CORS headers to the response.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function applyCors(req, res) {
    const origin = req.headers.origin?.toString();
    const allowed = getAllowedOrigins();

    if (allowed.includes('*') || (origin && allowed.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Vary', 'Origin');
}

// ==================== Rate Limiting ====================

/**
 * Simple in-memory rate limiter. Replace with Redis for multi-instance deployments.
 */
const rateLimitStore = new Map();

/**
 * Checks and updates rate limit for an identifier.
 * @param {string} identifier
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkRateLimit(identifier) {
    const now = Date.now();
    const windowStart = now - CONFIG.RATE_LIMIT_WINDOW_MS;
    const userRequests = rateLimitStore.get(identifier) || [];

    // Filter out old requests
    const recent = userRequests.filter((ts) => ts > windowStart);

    if (recent.length >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
        const oldest = recent[0];
        return {
            allowed: false,
            remaining: 0,
            resetMs: oldest + CONFIG.RATE_LIMIT_WINDOW_MS - now,
        };
    }

    recent.push(now);
    rateLimitStore.set(identifier, recent);

    // Periodic cleanup to prevent memory bloat
    if (rateLimitStore.size > 1000) {
        for (const [key, timestamps] of rateLimitStore) {
            const valid = timestamps.filter((t) => t > windowStart);
            if (valid.length === 0) rateLimitStore.delete(key);
            else rateLimitStore.set(key, valid);
        }
    }

    return {
        allowed: true,
        remaining: CONFIG.RATE_LIMIT_MAX_REQUESTS - recent.length,
        resetMs: CONFIG.RATE_LIMIT_WINDOW_MS,
    };
}

// ==================== Input Validation ====================

/**
 * Validates and sanitizes the request body.
 * @param {unknown} body
 * @returns {{ prompt: string, options: RequestOptions }}
 * @throws {ValidationError}
 */
function validateRequest(body) {
    if (!body || typeof body !== 'object') {
        throw new ValidationError('Request body must be a JSON object');
    }

    const { prompt, options = {} } = body;

    if (typeof prompt !== 'string') {
        throw new ValidationError('`prompt` must be a string');
    }

    const trimmed = prompt.trim();

    if (trimmed.length < CONFIG.MIN_PROMPT_LENGTH) {
        throw new ValidationError('`prompt` cannot be empty');
    }
    if (trimmed.length > CONFIG.MAX_PROMPT_LENGTH) {
        throw new ValidationError(
            `\`prompt\` exceeds maximum length of ${CONFIG.MAX_PROMPT_LENGTH} characters`
        );
    }

    // Validate options if provided
    if (options !== null && typeof options !== 'object') {
        throw new ValidationError('`options` must be an object');
    }

    const validatedOptions = {
        temperature: validateRange(options.temperature, 0, 2, CONFIG.DEFAULT_TEMPERATURE),
        maxTokens: validateInteger(options.maxTokens, 1, CONFIG.MAX_TOKENS_LIMIT, CONFIG.DEFAULT_MAX_TOKENS),
        model: typeof options.model === 'string' && options.model.length > 0
            ? options.model
            : CONFIG.DEFAULT_MODEL,
    };

    return { prompt: trimmed, options: validatedOptions };
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function validateRange(value, min, max, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function validateInteger(value, min, max, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

// ==================== Groq API Integration ====================

/**
 * Builds the system prompt for the AI.
 * @param {string} [variant='default']
 * @returns {string}
 */
function buildSystemPrompt(variant = 'default') {
    const baseRules = `You are a research panel defense expert with these strict rules:
1. ONLY use information from the provided research proposal
2. NEVER make up information not in the proposal
3. If asked about something not in the proposal, say "The researchers did not provide information about [topic] in their proposal."
4. Always respond in third person plural ("The researchers...")
5. Focus only on the specific research proposal provided
6. Extract information directly from the proposal text
7. Do not use general knowledge about research or education
8. Return your response in valid JSON format ONLY`;

    if (variant === 'chat') {
        return `${baseRules}

Additional rules for conversational mode:
- Engage in natural conversation when the user is greeting or asking general questions
- Only invoke research-specific rules when the user is asking about the research
- Be concise and friendly`;
    }

    return baseRules;
}

/**
 * Constructs the request body for Groq.
 * @param {string} prompt
 * @param {RequestOptions} options
 * @returns {Object}
 */
function buildRequestBody(prompt, options) {
    const systemContent = prompt.toLowerCase().includes('research assistant')
        ? buildSystemPrompt('chat')
        : buildSystemPrompt('default');

    return {
        model: options.model,
        messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: prompt },
        ],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        // Force JSON output reliably (Groq-supported feature)
        response_format: { type: 'json_object' },
    };
}

/**
 * Calls the Groq API with a timeout.
 * @param {string} apiKey
 * @param {Object} body
 * @returns {Promise<Object>}
 * @throws {UpstreamError|APIError}
 */
async function callGroqAPI(apiKey, body) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
        () => controller.abort(),
        CONFIG.REQUEST_TIMEOUT_MS
    );

    try {
        const response = await fetch(CONFIG.GROQ_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'PanelDefenseSimulator/1.0',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            log('error', 'Groq API non-OK response', {
                status: response.status,
                // Truncate to avoid huge log entries
                body: errorText.slice(0, 500),
            });
            throw new UpstreamError(response.status, errorText);
        }

        return await response.json();
    } catch (error) {
        if (error instanceof UpstreamError) throw error;

        if (error.name === 'AbortError') {
            log('error', 'Groq API request timeout', { timeoutMs: CONFIG.REQUEST_TIMEOUT_MS });
            throw new APIError('AI service request timed out', 504);
        }

        log('error', 'Groq API fetch failure', { error: error.message });
        throw new APIError('Failed to communicate with AI service', 502, error.message);
    } finally {
        clearTimeout(timeoutHandle);
    }
}

/**
 * Validates the structure of Groq's response.
 * @param {unknown} data
 * @returns {asserts data is GroqResponse}
 */
function validateResponse(data) {
    if (!data || typeof data !== 'object') {
        throw new APIError('Invalid response from AI service', 502);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
        throw new APIError('AI service returned empty content', 502);
    }
}

/**
 * Parses the AI response content, attempting to extract JSON.
 * @param {string} content
 * @returns {Object}
 */
function parseAIResponse(content) {
    // Groq with response_format=json_object should return valid JSON directly.
    try {
        return JSON.parse(content);
    } catch {
        // Fallback: extract JSON object from markdown or mixed text
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new APIError('AI response was not valid JSON', 502, content.slice(0, 200));
        }
        try {
            return JSON.parse(match[0]);
        } catch (err) {
            throw new APIError('AI response contained malformed JSON', 502, content.slice(0, 200));
        }
    }
}

// ==================== Response Helpers ====================

/**
 * Serializes an error to a safe JSON response.
 * @param {import('http').ServerResponse} res
 * @param {Error} error
 * @returns {void}
 */
function sendErrorResponse(res, error) {
    if (error instanceof APIError) {
        if (error instanceof RateLimitError && error.retryAfterSeconds) {
            res.setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        const isProd = process.env.NODE_ENV === 'production';
        return res.status(error.status).json({
            error: error.message,
            ...(error instanceof ValidationError && { details: error.details }),
            // Only expose internal details in development
            ...((!isProd && error.details && error.status >= 500) && { details: error.details }),
        });
    }

    // Unknown / unexpected errors
    log('error', 'Unhandled exception', {
        message: error.message,
        stack: error.stack,
    });
    return res.status(500).json({ error: 'Internal server error' });
}

// ==================== Main Handler ====================

/**
 * @typedef {Object} RequestOptions
 * @property {number} temperature
 * @property {number} maxTokens
 * @property {string} model
 */

/**
 * Main API handler.
 * @param {import('http').IncomingMessage & { method: string, body: any, headers: any }} req
 * @param {import('http').ServerResponse & { status(fn: (n:number)=>any): any, json(data: any): any, setHeader(k: string, v: string): any }} res
 * @returns {Promise<void>}
 */
export default async function handler(req, res) {
    // Apply CORS to every response
    applyCors(req, res);

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Method validation
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({
            error: 'Method not allowed',
            allowed: ['POST'],
        });
    }

    try {
        // 1. Environment check
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            log('error', 'GROQ_API_KEY missing');
            throw new ConfigurationError('GROQ_API_KEY is not configured');
        }

        // 2. Rate limiting
        const clientId = getClientIdentifier(req);
        const rateResult = checkRateLimit(clientId);

        res.setHeader('X-RateLimit-Limit', String(CONFIG.RATE_LIMIT_MAX_REQUESTS));
        res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(rateResult.resetMs / 1000)));

        if (!rateResult.allowed) {
            throw new RateLimitError(Math.ceil(rateResult.resetMs / 1000));
        }

        // 3. Input validation
        const { prompt, options } = validateRequest(req.body);

        // 4. Build request
        const requestBody = buildRequestBody(prompt, options);

        // 5. Call AI service
        const data = await callGroqAPI(apiKey, requestBody);

        // 6. Validate response structure
        validateResponse(data);

        // 7. Optionally parse and re-wrap if caller asked for parsed JSON
        //    (Default: return raw Groq response for backward compatibility)
        const wantsParsed = req.headers['x-prefer-parsed'] === 'true';
        const content = data.choices[0].message.content;

        log('info', 'Request successful', {
            clientId,
            promptLength: prompt.length,
            model: options.model,
            responseLength: content.length,
        });

        if (wantsParsed) {
            const parsed = parseAIResponse(content);
            return res.status(200).json({
                ...data,
                parsed,
            });
        }

        return res.status(200).json(data);

    } catch (error) {
        return sendErrorResponse(res, error);
    }
}
