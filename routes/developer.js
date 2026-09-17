import { Router } from 'express';
import { API_SCOPES, createDeveloperKey, listDeveloperKeys, revokeDeveloperKey } from '../services/apiKeys.js';

const router = Router();
router.use((_req,res,next) => { res.set('Cache-Control','private, no-store'); next(); });
const handler = fn => async (req,res) => {
    try { await fn(req,res); }
    catch (error) {
        const status=error.status || 500;
        if(status>=500)console.error('Developer settings request failed:',error);
        res.status(status).json({error:status>=500?'The request could not be completed.':error.message});
    }
};

router.get('/config', (_req,res) => res.json({
    base_url: process.env.PUBLIC_API_URL || 'https://api.validatecall.com/v1',
    scopes: API_SCOPES,
    documentation_url: 'https://api.validatecall.com/v1/openapi.json',
}));
router.get('/keys', handler(async (req,res) => res.json(await listDeveloperKeys(req.user.id))));
router.post('/keys', handler(async (req,res) => res.status(201).json(await createDeveloperKey(req.user.id,req.body))));
router.delete('/keys/:id', handler(async (req,res) => res.json(await revokeDeveloperKey(req.user.id,req.params.id))));

export default router;
