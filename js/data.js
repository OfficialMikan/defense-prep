/**
 * Research data module - component definitions and proposal loader
 * Loads research proposal text from /data/research-proposal.json
 */

const RESEARCH_COMPONENTS = Object.freeze([
    { key: 'title', name: 'Title' },
    { key: 'introduction', name: 'Introduction' },
    { key: 'research_design', name: 'Research Design' },
    { key: 'respondents', name: 'Respondents' },
    { key: 'motivation', name: 'Motivation' },
    { key: 'research_gap', name: 'Research Gap' },
    { key: 'statement', name: 'Statement of Problem' },
    { key: 'method', name: 'Research Method' }
]);

/**
 * Cache for loaded research proposals
 * Keyed by proposal id (string)
 */
const researchData = {
    cache: new Map(),

    /**
     * Load a research proposal by id from /data/research-proposal.json
     * @param {string} proposalId
     * @returns {Promise<{title: string, dataDump: string}>}
     */
    async load(proposalId) {
        if (this.cache.has(proposalId)) {
            return this.cache.get(proposalId);
        }

        const response = await fetch(`data/research-proposal.json`, {
            cache: 'force-cache'
        });

        if (!response.ok) {
            throw new Error(`Failed to load research proposal: HTTP ${response.status}`);
        }

        const allProposals = await response.json();
        const proposal = allProposals[proposalId];

        if (!proposal) {
            throw new Error(`Research proposal "${proposalId}" not found`);
        }

        this.cache.set(proposalId, proposal);
        return proposal;
    },

    /**
     * Get the title for a proposal id (synchronous, from cache only)
     * Use this for UI labels when you've already loaded the proposal
     */
    getTitle(proposalId) {
        const proposal = this.cache.get(proposalId);
        return proposal ? proposal.title : 'Unknown Proposal';
    },

    /**
     * Clear the cache (useful for testing)
     */
    clearCache() {
        this.cache.clear();
    }
};

if (typeof window !== 'undefined') {
    window.RESEARCH_COMPONENTS = RESEARCH_COMPONENTS;
    window.researchData = researchData;
}
