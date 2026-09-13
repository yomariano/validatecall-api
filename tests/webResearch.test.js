import { jest } from '@jest/globals';
import { researchWeb, validateExtractedLeads, validateResearchInput } from '../services/webResearch.js';

const source = { url: 'https://dental.example.test/contact', title: 'Dublin Dental', text: 'Dublin Dental. Call +353 1 234 5678. Email reception@dental.example.test.', retrievedAt: '2026-09-13T12:00:00Z' };
const candidate = { name: 'Dublin Dental', phone: '+353 1 234 5678', email: 'reception@dental.example.test', sourceUrl: source.url };
const env = { DEEPINFRA_API_KEY: 'model-test-key', BRAVE_SEARCH_API_KEY: 'search-test-key' };

test('contact extraction drops invented contacts, names and citations', () => {
    const results = validateExtractedLeads([
        candidate, candidate,
        { ...candidate, name: 'Invented Clinic' },
        { ...candidate, sourceUrl: 'https://invented.example.test' },
        { ...candidate, phone: '+353999999999', email: 'guessed@dental.example.test' },
    ], [source], 20, 'dentists', 'Dublin');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ phone: candidate.phone, email: candidate.email, sourceUrl: source.url, verificationStatus: 'source_observed' });
    expect(results[0].rating).toBeUndefined();
});
test('keeps missing fields null and deduplicates stable IDs across searches', () => {
    const first = validateExtractedLeads([{ ...candidate, email: 'invented@example.test', website: 'javascript:alert(1)' }], [source], 10, 'dentists', 'Dublin');
    const second = validateExtractedLeads([candidate], [source], 10, 'dentists', 'Dublin');
    expect(first[0].email).toBeNull();
    expect(first[0].website).toBeNull();
    expect(first[0].placeId).toBe(second[0].placeId);
});
test.each([0, -1, 21, 100000, 1.5, '10'])('rejects invalid result count %p before charging providers', maxResults => {
    expect(() => validateResearchInput({ keyword: 'dentist', location: 'Dublin', maxResults })).toThrow();
});
test('missing credentials cannot fall back to fictional lead generation', async () => {
    const fetchImpl = jest.fn();
    await expect(researchWeb({ keyword: 'dentists', location: 'Dublin' }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
});
test('searches real sources before calling configurable model with a fixed budget', async () => {
    const fetchImpl = jest.fn(async (url, options) => {
        if (String(url).includes('api.search.brave.com')) return new Response(JSON.stringify({ web: { results: [{ url: source.url, title: source.title, description: source.text }] } }));
        const body = JSON.parse(options.body);
        expect(body.model).toBe('zai-org/GLM-5.3');
        expect(body.max_tokens).toBe(3000);
        expect(body.messages[1].content).toContain(source.url);
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ leads: [candidate] }) } }] }));
    });
    const result = await researchWeb({ keyword: 'dentists', location: 'Dublin' }, { env: { ...env, DEEPINFRA_RESEARCH_MODEL: 'zai-org/GLM-5.3' }, fetchImpl });
    expect(result.leads).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
});
test('industry findings must cite retrieved sources', async () => {
    const fetchImpl = jest.fn(async url => String(url).includes('brave.com')
        ? new Response(JSON.stringify({ web: { results: [{ url: source.url, title: source.title, description: source.text }] } }))
        : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings: [
            { text: 'Supported finding', sourceUrls: [source.url] }, { text: 'Unsourced finding', sourceUrls: ['https://invented.example.test'] },
        ] }) } }] })));
    const result = await researchWeb({ keyword: 'dentists', location: 'Dublin' }, { mode: 'industry', fetchImpl, env });
    expect(result.findings).toHaveLength(1);
});
test('provider failure stops the pipeline without spending on the model', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 429 }));
    await expect(researchWeb({ keyword: 'dentists', location: 'Dublin' }, { fetchImpl, env })).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
