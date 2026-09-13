import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createResearchRouter } from '../routes/research.js';

const input = { keyword: 'dentists', location: 'Dublin' };
function appFor(research, rpc = jest.fn(async () => ({ data: true }))) {
    const app = express();
    app.use(express.json(), (req, _res, next) => { req.user = { id: 'test-user' }; next(); });
    app.use(createResearchRouter({ research, db: { rpc }, configured: () => true }));
    return { app, rpc };
}
test('daily quota denies browsing before any model or page call', async () => {
    const research = jest.fn();
    const { app } = appFor(research, jest.fn(async () => ({ data: false })));
    expect((await request(app).post('/leads').send(input)).status).toBe(429);
    expect(research).not.toHaveBeenCalled();
});
test('bounds concurrent jobs and releases capacity after provider failures', async () => {
    const releases = [];
    let bothStarted;
    const started = new Promise(resolve => { bothStarted = resolve; });
    const research = jest.fn(() => new Promise((_resolve, reject) => {
        releases.push(() => reject(Object.assign(new Error('Provider unavailable'), { status: 502 })));
        if (releases.length === 2) bothStarted();
    }));
    const { app, rpc } = appFor(research);
    const a = request(app).post('/leads').send(input).then(res => res);
    const b = request(app).post('/industry').send(input).then(res => res);
    await started;
    expect((await request(app).post('/leads').send(input)).status).toBe(429);
    expect(rpc).toHaveBeenCalledTimes(2);
    releases.forEach(release => release());
    expect((await a).status).toBe(502);
    expect((await b).status).toBe(502);
    research.mockResolvedValueOnce({ leads: [] });
    expect((await request(app).post('/leads').send(input)).status).toBe(200);
});
