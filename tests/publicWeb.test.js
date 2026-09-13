import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { publicWebUrl, isPublicAddress, resolvePublicUrl, requestPublic, browsePublicPage, extractWebPage } from '../services/publicWeb.js';

test.each(['127.0.0.1', '10.0.1.3', '169.254.169.254', '192.168.0.2', '172.16.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '224.1.1.1', '192.0.2.2'])('blocks private/reserved IP %s', address => {
    expect(isPublicAddress(address)).toBe(false);
});
test.each(['http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://user:password@example.com', 'https://example.com:444', 'file:///etc/passwd'])('blocks alternate unsafe URL %s', url => {
    expect(() => publicWebUrl(url)).toThrow();
});
test('rejects mixed public/private DNS answers', async () => {
    const lookupImpl = jest.fn(async () => [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(resolvePublicUrl('https://example.com', lookupImpl)).rejects.toThrow('restricted network');
});
test('pins the actual socket lookup to the validated DNS answer', async () => {
    const lookupImpl = jest.fn(async () => [{ address: '1.1.1.1', family: 4 }]);
    const requestImpl = jest.fn((_url, options, onResponse) => {
        options.lookup('example.com', {}, (_err, address) => expect(address).toBe('1.1.1.1'));
        options.lookup('example.com', { all: true }, (_err, addresses) => expect(addresses).toEqual([{ address: '1.1.1.1', family: 4 }]));
        expect(options.headers.Authorization).toBeUndefined();
        const req = new EventEmitter();
        req.end = () => {
            const res = new EventEmitter();
            res.statusCode = 200; res.headers = {};
            onResponse(res);
            res.emit('data', Buffer.from('hello'));
            res.emit('end'); req.emit('close');
        };
        return req;
    });
    await expect(requestPublic('https://example.com', { lookupImpl, requestImpl })).resolves.toMatchObject({ body: 'hello' });
    expect(lookupImpl).toHaveBeenCalledTimes(1);
});
test('redirect to private network is rejected before another request', async () => {
    const request = jest.fn(async () => ({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' }, body: '' }));
    await expect(browsePublicPage('https://example.com', { request, checkRobots: false })).rejects.toThrow('public HTTP');
    expect(request).toHaveBeenCalledTimes(1);
});
test('honors robots exclusions without fetching excluded pages', async () => {
    const request = jest.fn(async () => ({ status: 200, headers: {}, body: 'User-agent: *\nDisallow: /private' }));
    await expect(browsePublicPage('https://robots.example.com/private/contact', { request })).rejects.toThrow('disallows');
    expect(request.mock.calls.map(call => call[0])).toEqual(['https://robots.example.com/robots.txt']);
});
test('extracts visible contact evidence and prioritizes followable contact links', () => {
    const result = extractWebPage('<title>Example Dental</title><body><script>secret@hidden.example</script><p>Example Dental welcomes patients to our Dublin practice. Our reception team can help you book an appointment.</p><a href="mailto:reception@example.com">Email us</a><a href="/contact">Contact our team</a><a href="http://127.0.0.1/admin">Private</a></body>', 'https://example.com');
    expect(result.text).toContain('reception@example.com');
    expect(result.text).not.toContain('secret@hidden.example');
    expect(result.links).toEqual([{ url: 'https://example.com/contact', text: 'Contact our team' }]);
});
test('verification gates are not treated as source evidence', () => {
    expect(() => extractWebPage('<title>Just a moment...</title><body>Verify you are human</body>', 'https://example.com')).toThrow('human verification');
});
