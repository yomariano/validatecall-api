import { jest } from '@jest/globals';
import { researchWeb, validateExtractedLeads, validateResearchInput, researchConfigured } from '../services/webResearch.js';

const source = { url: 'https://dental.example.com/contact', title: 'Dublin Dental', text: 'Dublin Dental. Call +353 1 234 5678. Email reception@dental.example.com.', retrievedAt: '2026-09-13T12:00:00Z' };
const candidate = { name: 'Dublin Dental', phone: '+353 1 234 5678', email: 'reception@dental.example.com', sourceUrl: source.url };
const env = { DEEPINFRA_API_KEY: 'model-test-key' };

test('contact extraction drops invented contacts, names and citations', () => {
    const results = validateExtractedLeads([
        candidate, candidate,
        { ...candidate, name: 'Invented Clinic' },
        { ...candidate, sourceUrl: 'https://invented.example.test' },
        { ...candidate, phone: '+353999999999', email: 'guessed@dental.example.com' },
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

const reply = message => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message }], usage: { prompt_tokens: 100, completion_tokens: 30, estimated_cost: 0.0001 } }));
const open = urls => ({ tool_calls: [{ id: 'visit', type: 'function', function: { name: 'open_pages', arguments: JSON.stringify({ urls }) } }] });
test('only a DeepInfra key is required', () => {
    expect(researchConfigured(env)).toBe(true);
    expect(researchConfigured({ BRAVE_SEARCH_API_KEY: 'unused' })).toBe(false);
});
test('model follows contact links before extracting grounded contacts', async () => {
    const home = 'https://dental.example.com/';
    const browse = jest.fn(async url => url === home
        ? { ...source, url: home, text: 'Dublin Dental welcomes patients in Dublin.', links: [{ text: 'Contact', url: source.url }] }
        : source);
    const fetchImpl = jest.fn()
        .mockResolvedValueOnce(reply(open([home])))
        .mockResolvedValueOnce(reply(open([source.url])))
        .mockResolvedValueOnce(reply({ content: 'Enough evidence.' }))
        .mockResolvedValueOnce(reply({ content: JSON.stringify({ leads: [candidate] }) }));
    const result = await researchWeb({ keyword: 'dentists', location: 'Dublin' }, { env, browse, fetchImpl });
    expect(browse.mock.calls.map(call => call[0])).toEqual([home, source.url]);
    expect(result.leads).toHaveLength(1);
    expect(result.usage).toMatchObject({ model_calls: 4, pages_attempted: 2, prompt_tokens: 400 });
    expect(result.discovery).toBe('direct_web');
    const requests = fetchImpl.mock.calls.map(call => JSON.parse(call[1].body));
    expect(requests[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'visit' });
    expect(requests[1].messages.at(-1).content).toContain(source.url);
    expect(requests.map(body => body.max_tokens)).toEqual([700, 700, 700, 3000]);
    expect(requests.every(body => body.reasoning_effort === 'none')).toBe(true);
    expect(fetchImpl.mock.calls.every(call => call[0] === 'https://api.deepinfra.com/v1/openai/chat/completions')).toBe(true);
});
test('starting websites work with configurable GLM and cited industry findings', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(reply({ content: 'Enough evidence' }))
        .mockResolvedValueOnce(reply({ content: JSON.stringify({ findings: [
            { text: 'Observed finding', sourceUrls: [source.url] },
            { text: 'Invented finding', sourceUrls: ['https://invented.example.com'] },
            null,
        ] }) }));
    const browse = jest.fn(async () => source);
    const result = await researchWeb({ keyword: 'dentists', location: 'Dublin', startingUrls: [source.url] }, { mode: 'industry', env: { ...env, DEEPINFRA_RESEARCH_MODEL: 'zai-org/GLM-5.3' }, browse, fetchImpl });
    expect(result.findings).toHaveLength(1);
    expect(result.model).toBe('zai-org/GLM-5.3');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages.at(-1).content).toContain(source.text);
});
test('page and model budgets cannot be extended by excessive tool calls', async () => {
    let round = 0;
    const fetchImpl = jest.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        if (!body.tools) return reply({ content: JSON.stringify({ leads: [candidate] }) });
        const urls = [1, 2, 3].map(n => `https://dental.example.com/${round * 3 + n}`);
        round++;
        return reply(open(urls));
    });
    const browse = jest.fn(async () => source);
    const result = await researchWeb({ keyword: 'dentists', location: 'Dublin' }, { env, browse, fetchImpl });
    expect(browse).toHaveBeenCalledTimes(6);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.usage.pages_attempted).toBe(6);
});
test('blocked websites never turn into memorized contacts', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(reply(open([source.url])))
        .mockResolvedValueOnce(reply({ content: JSON.stringify({ leads: [candidate] }) }));
    await expect(researchWeb({ keyword: 'dentists', location: 'Dublin' }, {
        env, fetchImpl, browse: jest.fn(async () => { throw new Error('Human verification required'); }),
    })).rejects.toThrow('No readable business sources');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});
test.each([['http://localhost'], ['https://127.0.0.1'], ['file:///etc/passwd'], ['https://example.com:8080'], ['https://u:p@example.com'], ['https://a.example.com', 'https://b.example.com', 'https://c.example.com', 'https://d.example.com']].map(urls => [urls]))('rejects invalid starting websites %p before model spending', startingUrls => {
    expect(() => validateResearchInput({ keyword: 'dentists', location: 'Dublin', startingUrls })).toThrow();
});
test('provider failure ends the job without any website visits', async () => {
    const browse = jest.fn();
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 429 }));
    await expect(researchWeb({ keyword: 'dentists', location: 'Dublin' }, { fetchImpl, browse, env })).rejects.toMatchObject({ status: 502 });
    expect(browse).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('truncated navigation prose does not discard already-read evidence or execute partial tools', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: open(['https://other.example.com']) }] })))
        .mockResolvedValueOnce(reply({ content: JSON.stringify({ findings: [{ text: 'Observed detail', sourceUrls: [source.url] }] }) }));
    const browse = jest.fn(async () => source);
    const result = await researchWeb({ keyword: 'dentists', location: 'Dublin', startingUrls: [source.url] }, { env, browse, fetchImpl, mode: 'industry' });
    expect(result.findings).toHaveLength(1);
    expect(browse).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});
