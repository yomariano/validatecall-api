import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createAuthRouter } from '../routes/auth.js';
import { testDatabase } from './postgresHarness.js';
import { database } from '../db/database.js';
import { SESSION_COOKIE } from '../services/sessions.js';

let pg, app, nonce, profile, provider;
beforeAll(async()=>{({pg}=await testDatabase());},30000);
afterAll(async()=>{await pg?.close();});
beforeEach(()=>{
    process.env.GOOGLE_CLIENT_ID='test-client';
    profile={sub:'google-subject-one',email:'google-user@example.test',email_verified:true,name:'Google User'};
    provider={
        generateCodeVerifierAsync:jest.fn(async()=>({codeVerifier:'test-verifier',codeChallenge:'test-challenge'})),
        generateAuthUrl:jest.fn(options=>{nonce=options.nonce;return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams(options);}),
        getToken:jest.fn(async options=>{expect(options.codeVerifier).toBe('test-verifier');return {tokens:{id_token:'signed-test-token'}};}),
        verifyIdToken:jest.fn(async options=>{expect(options.audience).toBe('test-client');return {getPayload:()=>({...profile,nonce})};}),
    };
    app=express();app.use(express.json());app.use('/api/auth',createAuthRouter({getGoogleClient:()=>provider}));
});
async function start(){
    const begin=await request(app).get('/api/auth/google').expect(302);
    const state=new URL(begin.headers.location).searchParams.get('state');
    const cookie=begin.headers['set-cookie'][0].split(';')[0];
    return {state,cookie};
}
test('Google sign-in uses state, PKCE and identity-only scopes',async()=>{
    const {state,cookie}=await start();
    expect(provider.generateAuthUrl.mock.calls[0][0]).toMatchObject({scope:['openid','email','profile'],code_challenge_method:'S256'});
    const result=await request(app).get(`/api/auth/google/callback?state=${state}&code=oauth-code`).set('Cookie',cookie).expect(302);
    const sessionCookie=result.headers['set-cookie'].find(c=>c.startsWith(SESSION_COOKIE+'='));
    expect(sessionCookie).toContain('HttpOnly');expect(sessionCookie).toContain('SameSite=Lax');
    const session=await request(app).get('/api/auth/session').set('Cookie',sessionCookie.split(';')[0]).expect(200);
    expect(session.body.user.email).toBe(profile.email);expect(session.body.csrfToken).toBeTruthy();
    await request(app).get(`/api/auth/google/callback?state=${state}&code=oauth-code`).set('Cookie',cookie).expect(400);
});
test('callback rejects missing or mismatched state without exchanging a code',async()=>{
    await request(app).get('/api/auth/google/callback?state=forged&code=code').expect(400);
    expect(provider.getToken).not.toHaveBeenCalled();
});
test('unverified Google email cannot create an account',async()=>{
    profile={...profile,sub:'unverified',email:'unverified@example.test',email_verified:false};
    const {state,cookie}=await start();
    await request(app).get(`/api/auth/google/callback?state=${state}&code=code`).set('Cookie',cookie).expect(401);
});
test('existing profiles cannot be claimed merely by matching an email',async()=>{
    await database.query('INSERT INTO profiles(email) VALUES($1)',['legacy@example.test']);
    profile={...profile,sub:'unknown-subject',email:'legacy@example.test'};
    const {state,cookie}=await start();
    await request(app).get(`/api/auth/google/callback?state=${state}&code=code`).set('Cookie',cookie).expect(409);
});
