import https from 'node:https';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';

const USER_AGENT = 'ValidateCallResearch/1.0 (+https://validatecall.com)';
const MAX_BYTES = 800_000;
const robotsCache = new Map();
export function publicWebUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Enter a valid public website URL.'); }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.port || value.length > 2000 || host === 'localhost' || /\.(localhost|local|internal|test|invalid)$/.test(host) ||
        (isIP(host) && !isPublicAddress(host))) throw new Error('Only public HTTP(S) websites on standard ports are allowed.');
    url.hash = '';
    return url;
}
export function isPublicAddress(address) {
    try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function resolvePublicUrl(value, lookupImpl = lookup) {
    const url = publicWebUrl(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookupImpl(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('This website resolves to a restricted network.');
    return { url, address: addresses.find(item => item.family === 4) || addresses[0] };
}

// Resolve once, validate every address, and pin the connection to that address.
// Redirects are checked separately; browser content never receives API credentials.
export async function requestPublic(value, { signal, lookupImpl, requestImpl } = {}) {
    const { url, address } = await resolvePublicUrl(value, lookupImpl);
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const request = requestImpl || (url.protocol === 'https:' ? https.request : http.request);
        const req = request(url, {
            method: 'GET', agent: false, signal,
            headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8', 'Accept-Encoding': 'identity' },
            lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
        }, res => {
            const chunks = [];
            let size = 0;
            res.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_BYTES) req.destroy(new Error('Page exceeds the browsing size limit.'));
                else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        });
        const timer = setTimeout(() => req.destroy(new Error('Website request timed out.')), 10000);
        req.on('close', () => clearTimeout(timer));
        req.on('error', reject);
        req.end();
    });
}

async function robotsAllowed(url, request, signal) {
    const cached = robotsCache.get(url.origin);
    let policy = cached?.expires > Date.now() ? cached.policy : undefined;
    if (policy === undefined) {
        const robotsUrl = `${url.origin}/robots.txt`;
        let target = robotsUrl;
        let result;
        for (let redirects = 0; redirects <= 2; redirects++) {
            result = await request(target, { signal });
            if (![301, 302, 303, 307, 308].includes(result.status) || !result.headers.location) break;
            target = publicWebUrl(new URL(result.headers.location, target).href).href;
        }
        if (result.status === 404 || result.status === 410) policy = null;
        else if (result.status === 200) policy = robotsParser(robotsUrl, result.body);
        else throw new Error('The website crawling policy could not be checked.');
        if (robotsCache.size >= 100) robotsCache.delete(robotsCache.keys().next().value);
        robotsCache.set(url.origin, { policy, expires: Date.now() + 600_000 });
    }
    if (policy?.isDisallowed(url.href, USER_AGENT)) throw new Error('This page disallows automated research.');
}

export function extractWebPage(html, value) {
    const url = publicWebUrl(value);
    const $ = load(html);
    const title = $('title').text().trim().slice(0, 200);
    if (/just a moment|verify you are human|access denied|captcha/i.test(title) || $('form[action*="anomaly"], iframe[src*="captcha"]').length) {
        throw new Error('This page requires human verification.');
    }
    $('script,style,noscript,iframe,svg,form,[hidden],[aria-hidden="true"]').remove();
    const links = [];
    const contacts = [];
    $('a[href]').each((_i, element) => {
        const href = $(element).attr('href');
        if (/^(mailto:|tel:)/i.test(href)) { contacts.push(href.replace(/^(mailto:|tel:)/i, '').split('?')[0]); return; }
        try {
            const target = publicWebUrl(new URL(href, url).href).href;
            if (links.some(link => link.url === target)) return;
            links.push({ url: target, text: $(element).text().replace(/\s+/g, ' ').trim().slice(0, 100) });
        } catch { /* No private addresses, credentials, or executable links. */ }
    });
    $('br,p,div,section,article,li,h1,h2,h3,h4,tr').append('\n');
    const bodyText = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
    // Keep published mailto/tel values even when long menus push the footer past the text cap.
    const contactText = [...new Set(contacts)].join('\n').slice(0, 900);
    const text = `${bodyText.slice(0, 6000)}\n${contactText}`.trim();
    if (text.length < 80) throw new Error('This page has too little readable text; it may require JavaScript.');
    links.sort((a, b) => Number(/contact|about|team|member|directory/i.test(b.text + b.url)) - Number(/contact|about|team|member|directory/i.test(a.text + a.url)));
    return { url: url.href, title, text, links: links.slice(0, 30), retrievedAt: new Date().toISOString() };
}

export async function browsePublicPage(value, { signal, request = requestPublic, checkRobots = true } = {}) {
    let url = publicWebUrl(value);
    for (let redirects = 0; redirects <= 3; redirects++) {
        if (checkRobots) await robotsAllowed(url, request, signal);
        const result = await request(url.href, { signal });
        if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
            url = publicWebUrl(new URL(result.headers.location, url).href);
            continue;
        }
        if (result.status !== 200) throw new Error(`Website returned HTTP ${result.status}.`);
        if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(result.headers['content-type'] || '')) throw new Error('Only readable web pages are supported.');
        return extractWebPage(result.body, url.href);
    }
    throw new Error('Website redirected too many times.');
}
