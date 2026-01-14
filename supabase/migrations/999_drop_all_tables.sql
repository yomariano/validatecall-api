-- Drop all tables (run this to reset the database)
-- Execute in Supabase SQL Editor

-- Drop existing tables from current database
DROP TABLE IF EXISTS customer_bookings CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS call_logs CASCADE;
DROP TABLE IF EXISTS knowledge_base CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- Drop any functions
DROP FUNCTION IF EXISTS get_next_available_phone_number(uuid);
DROP FUNCTION IF EXISTS increment_phone_usage(uuid);
DROP FUNCTION IF EXISTS get_user_phone_stats(uuid);
DROP FUNCTION IF EXISTS reset_daily_phone_usage();

-- Confirm cleanup
SELECT 'All tables dropped successfully' as status;
