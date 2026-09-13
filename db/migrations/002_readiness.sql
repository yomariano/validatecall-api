

-- Provider resources are private until explicitly assigned to an owner.
CREATE TABLE IF NOT EXISTS public.vapi_assistants (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);







CREATE TABLE IF NOT EXISTS public.vapi_calls (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);




ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source_excerpt text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS retrieved_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS verification_status text;

-- Budget requests before any billable search/model call. The global row is
-- locked first so concurrent users cannot exceed the installation-wide cap.
CREATE TABLE IF NOT EXISTS public.research_budgets (
    day date NOT NULL,
    scope text NOT NULL,
    requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
    PRIMARY KEY (day, scope)
);



CREATE OR REPLACE FUNCTION public.reserve_research_request(p_user_id uuid, p_user_limit integer, p_global_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := (now() AT TIME ZONE 'UTC')::date; g integer; u integer;
BEGIN
    IF p_user_id IS NULL OR p_user_limit < 1 OR p_global_limit < 1 THEN RETURN false; END IF;
    INSERT INTO research_budgets(day, scope) VALUES(d, 'global') ON CONFLICT DO NOTHING;
    SELECT requests INTO g FROM research_budgets WHERE day=d AND scope='global' FOR UPDATE;
    IF g >= p_global_limit THEN RETURN false; END IF;
    INSERT INTO research_budgets(day, scope) VALUES(d, p_user_id::text) ON CONFLICT DO NOTHING;
    SELECT requests INTO u FROM research_budgets WHERE day=d AND scope=p_user_id::text FOR UPDATE;
    IF u >= p_user_limit THEN RETURN false; END IF;
    UPDATE research_budgets SET requests=requests+1 WHERE day=d AND scope IN ('global',p_user_id::text);
    RETURN true;
END $$;



-- Each outbound sequence/workflow action is claimed durably before execution.
-- Claims deliberately do not expire: after a crash, reconcile the provider
-- outcome before retrying an action that may already have sent an email/call.
CREATE TABLE IF NOT EXISTS public.outbound_job_claims (
    job_key text PRIMARY KEY,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','finished','needs_review'))
);





