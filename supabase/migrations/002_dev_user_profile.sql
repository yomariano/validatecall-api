-- Migration: Add development user profile
-- This creates a dev user for localhost development mode
-- Run this in Supabase SQL Editor

-- =============================================
-- CREATE DEV USER IN AUTH.USERS FIRST
-- =============================================

-- Insert mock user into auth.users (required for foreign key)
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'dev@localhost.com',
  '$2a$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123456', -- dummy hash
  NOW(),
  NOW(),
  NOW(),
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- =============================================
-- CREATE DEV USER PROFILE
-- =============================================

-- Insert dev user profile (used by localhost development)
INSERT INTO profiles (id, email, full_name, plan)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'dev@localhost.com',
  'Developer',
  'free'
) ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name;

-- =============================================
-- VERIFICATION
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'Dev user created in auth.users and profiles';
END $$;
