import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// Retry helper with exponential backoff for transient errors
const withRetry = async (operation, maxRetries = 3, baseDelay = 1000) => {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            // Only retry on transient/network errors
            const isTransient = error.message?.includes('fetch failed') ||
                error.message?.includes('SocketError') ||
                error.message?.includes('ECONNRESET') ||
                error.code === 'UND_ERR_SOCKET';

            if (!isTransient || attempt === maxRetries - 1) {
                throw error;
            }
            // Exponential backoff: 1s, 2s, 4s
            const delay = baseDelay * Math.pow(2, attempt);
            console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
};

// Supabase client options with timeout
const supabaseOptions = {
    auth: { persistSession: false },
    global: {
        fetch: (url, options = {}) => {
            return fetch(url, {
                ...options,
                signal: AbortSignal.timeout(30000), // 30 second timeout
            });
        },
    },
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Check if we're in development mode
const IS_DEV = process.env.NODE_ENV !== 'production';

// Mock user ID for localhost development (matches frontend AuthContext)
const MOCK_USER_ID = '00000000-0000-0000-0000-000000000000';

// Admin client (bypasses RLS) - for dev mode and admin operations
const supabaseAdmin = supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, supabaseOptions)
    : null;

// Create a user-authenticated Supabase client from the request
// Uses the user's JWT to enforce RLS policies
const getSupabaseClient = (req) => {
    if (!supabaseUrl) {
        return null;
    }

    // Extract JWT from Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    // If no token and in dev mode, use admin client (bypasses RLS)
    if (!token && IS_DEV && supabaseAdmin) {
        return supabaseAdmin;
    }

    if (!token || !supabaseAnonKey) {
        // No token - use anon client if available
        return supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, supabaseOptions) : null;
    }

    // Create client with user's JWT and timeout
    return createClient(supabaseUrl, supabaseAnonKey, {
        ...supabaseOptions,
        global: {
            ...supabaseOptions.global,
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    });
};

// Get the authenticated user's ID from the token
const getUserId = async (req) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    // In dev mode without token, return mock user ID
    if (!token && IS_DEV) {
        return MOCK_USER_ID;
    }

    if (!token || !supabaseAnonKey || !supabaseUrl) {
        return null;
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        ...supabaseOptions,
        global: {
            ...supabaseOptions.global,
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    });

    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
};

// Check if Supabase is configured
router.get('/status', (req, res) => {
    res.json({ configured: !!supabaseAdmin || !!supabaseAnonKey });
});

// =============================================
// LEADS
// =============================================

// Get leads with optional filters
router.get('/leads', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const { status, hasPhone, keyword, limit } = req.query;

        let query = supabase
            .from('leads')
            .select('*')
            .order('created_at', { ascending: false });

        if (status) {
            query = query.eq('status', status);
        }

        if (hasPhone === 'true') {
            query = query.not('phone', 'is', null);
        }

        if (keyword) {
            query = query.eq('search_keyword', keyword);
        }

        if (limit) {
            query = query.limit(parseInt(limit));
        }

        const { data, error } = await query;

        if (error) {
            console.error('Supabase leads error:', JSON.stringify(error, null, 2));
            return res.status(500).json({ error: error.message || error.code || 'Unknown Supabase error', details: error });
        }

        console.log(`[Leads] GET: returning ${data?.length || 0} leads`);
        res.json(data || []);
    } catch (error) {
        console.error('Get leads error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
    }
});

// Get single lead by ID
router.get('/leads/:id', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const { data, error } = await supabase
            .from('leads')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        res.json(data);
    } catch (error) {
        console.error('Get lead error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save leads (batch) - with retry and batch processing
router.post('/leads', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const userId = await getUserId(req);
        // Only require auth in production
        if (!userId && !IS_DEV) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { leads, searchKeyword, searchLocation } = req.body;

        if (!leads || !Array.isArray(leads)) {
            return res.status(400).json({ error: 'leads array is required' });
        }

        // Transform all leads to the database format
        const leadsData = leads.map(lead => {
            const data = {
                name: lead.name,
                phone: lead.phone,
                address: lead.address,
                city: lead.city,
                website: lead.website,
                rating: lead.rating,
                review_count: lead.reviewCount,
                category: lead.category,
                place_id: lead.placeId,
                google_maps_url: lead.googleMapsUrl || lead.url,
                latitude: lead.location?.lat,
                longitude: lead.location?.lng,
                search_keyword: searchKeyword,
                search_location: searchLocation,
            };
            if (userId) {
                data.user_id = userId;
            }
            return data;
        });

        let saved = 0;
        let duplicates = 0;
        const BATCH_SIZE = 50;

        console.log(`[Leads] Saving ${leadsData.length} leads for keyword="${searchKeyword}", location="${searchLocation}", userId=${userId || 'null (dev mode)'}`);

        if (userId) {
            // With user_id - use batch upsert with retry
            for (let i = 0; i < leadsData.length; i += BATCH_SIZE) {
                const batch = leadsData.slice(i, i + BATCH_SIZE);
                try {
                    const { data, error } = await withRetry(() =>
                        supabase
                            .from('leads')
                            .upsert(batch, {
                                onConflict: 'user_id,place_id',
                                ignoreDuplicates: true,
                            })
                            .select('id')
                    );

                    if (error) {
                        if (error.code === '23505') {
                            duplicates += batch.length;
                        } else {
                            console.error('Error saving lead batch:', error);
                        }
                    } else {
                        saved += data?.length || batch.length;
                    }
                } catch (err) {
                    console.error('Error processing lead batch after retries:', err);
                }
            }
        } else {
            // No user_id (dev mode) - check existing and insert new ones in batches
            const placeIds = leadsData.filter(l => l.place_id).map(l => l.place_id);

            // Get existing place_ids in one query with retry
            let existingPlaceIds = new Set();
            if (placeIds.length > 0) {
                try {
                    const { data: existing } = await withRetry(() =>
                        supabase
                            .from('leads')
                            .select('place_id')
                            .in('place_id', placeIds)
                            .is('user_id', null)
                    );
                    existingPlaceIds = new Set((existing || []).map(e => e.place_id));
                    console.log(`[Leads] Found ${existingPlaceIds.size} existing place_ids in database`);
                } catch (err) {
                    console.error('Error checking existing leads:', err);
                }
            }

            // Filter out duplicates and insert in batches
            const newLeads = leadsData.filter(l => !l.place_id || !existingPlaceIds.has(l.place_id));
            duplicates = leadsData.length - newLeads.length;
            console.log(`[Leads] New leads to insert: ${newLeads.length}, duplicates skipped: ${duplicates}`);

            for (let i = 0; i < newLeads.length; i += BATCH_SIZE) {
                const batch = newLeads.slice(i, i + BATCH_SIZE);
                try {
                    const { data, error } = await withRetry(() =>
                        supabase
                            .from('leads')
                            .insert(batch)
                            .select('id')
                    );

                    if (error) {
                        if (error.code === '23505') {
                            duplicates += batch.length;
                        } else {
                            console.error('Error inserting lead batch:', error);
                        }
                    } else {
                        saved += data?.length || batch.length;
                    }
                } catch (err) {
                    console.error('Error inserting lead batch after retries:', err);
                }
            }
        }

        console.log(`[Leads] Result: saved=${saved}, duplicates=${duplicates}`);
        res.json({ saved, duplicates });
    } catch (error) {
        console.error('Save leads error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch update lead industries
router.patch('/leads/industries', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const { updates } = req.body; // Array of { id, industry }

        if (!updates || !Array.isArray(updates)) {
            return res.status(400).json({ error: 'updates array is required' });
        }

        // Update each lead's category with the classified industry
        let updated = 0;
        for (const update of updates) {
            const { error } = await supabase
                .from('leads')
                .update({ category: update.industry })
                .eq('id', update.id);

            if (!error) updated++;
        }

        res.json({ updated, total: updates.length });
    } catch (error) {
        console.error('Update industries error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update lead status
router.patch('/leads/:id/status', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const { status } = req.body;

        const { data, error } = await supabase
            .from('leads')
            .update({ status })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Update lead status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update lead after call
router.patch('/leads/:id/after-call', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        // First get current call count
        const { data: currentLead } = await supabase
            .from('leads')
            .select('call_count')
            .eq('id', req.params.id)
            .single();

        const { data, error } = await supabase
            .from('leads')
            .update({
                status: 'contacted',
                call_count: (currentLead?.call_count || 0) + 1,
                last_called_at: new Date().toISOString(),
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Update lead after call error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get leads stats
router.get('/stats/leads', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.json({ total: 0, new: 0, contacted: 0, interested: 0 });
        }

        const { data, error } = await supabase
            .from('leads')
            .select('status, search_keyword');

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Count leads by keyword for debugging
        const byKeyword = {};
        data.forEach(l => {
            const kw = l.search_keyword || 'unknown';
            byKeyword[kw] = (byKeyword[kw] || 0) + 1;
        });
        console.log('[Leads Stats] By keyword:', byKeyword);

        res.json({
            total: data.length,
            new: data.filter(l => l.status === 'new').length,
            contacted: data.filter(l => l.status === 'contacted').length,
            interested: data.filter(l => l.status === 'interested').length,
            withPhone: data.length,
            byKeyword, // Include in response for debugging
        });
    } catch (error) {
        console.error('Get leads stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// CAMPAIGNS
// =============================================

// Get campaigns
router.get('/campaigns', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.json([]);
        }

        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data || []);
    } catch (error) {
        console.error('Get campaigns error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create campaign
router.post('/campaigns', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const userId = await getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { name, productIdea, companyContext, totalLeads, leadIds, selectedAgentId } = req.body;

        const { data, error } = await supabase
            .from('campaigns')
            .insert({
                user_id: userId,
                name,
                product_idea: productIdea,
                company_context: companyContext,
                total_leads: totalLeads || 0,
                lead_ids: leadIds || [],
                selected_agent_id: selectedAgentId || null,
            })
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Create campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update campaign stats
router.patch('/campaigns/:id', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const { data, error } = await supabase
            .from('campaigns')
            .update(req.body)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Update campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// CALLS
// =============================================

// Get calls
router.get('/calls', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.json([]);
        }

        const { campaignId, limit } = req.query;

        let query = supabase
            .from('calls')
            .select(`
        *,
        lead:leads(name, category),
        campaign:campaigns(name)
      `)
            .order('created_at', { ascending: false });

        if (campaignId) {
            query = query.eq('campaign_id', campaignId);
        }

        if (limit) {
            query = query.limit(parseInt(limit));
        }

        const { data, error } = await query;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data || []);
    } catch (error) {
        console.error('Get calls error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save call
router.post('/calls', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const userId = await getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { leadId, campaignId, vapiCallId, phoneNumber, customerName, status } = req.body;

        const { data, error } = await supabase
            .from('calls')
            .insert({
                user_id: userId,
                lead_id: leadId,
                campaign_id: campaignId,
                vapi_call_id: vapiCallId,
                phone_number: phoneNumber,
                customer_name: customerName,
                status: status || 'initiated',
            })
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Save call error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update call
router.patch('/calls/:id', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const { data, error } = await supabase
            .from('calls')
            .update(req.body)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Update call error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get calls stats
router.get('/stats/calls', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.json({ total: 0, completed: 0, failed: 0, avgDuration: 0 });
        }

        const { data, error } = await supabase
            .from('calls')
            .select('status, duration_seconds');

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        const completed = data.filter(c => c.status === 'ended' || c.status === 'completed');

        res.json({
            total: data.length,
            completed: completed.length,
            failed: data.filter(c => c.status === 'failed').length,
            avgDuration: completed.length > 0
                ? Math.round(completed.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) / completed.length)
                : 0,
        });
    } catch (error) {
        console.error('Get calls stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// SCRAPE JOBS
// =============================================

// Get scrape jobs
router.get('/scrape-jobs', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.json([]);
        }

        const limit = req.query.limit || 20;

        const { data, error } = await supabase
            .from('scrape_jobs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data || []);
    } catch (error) {
        console.error('Get scrape jobs error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save scrape job
router.post('/scrape-jobs', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const userId = await getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { runId, keyword, location, maxResults } = req.body;

        const { data, error } = await supabase
            .from('scrape_jobs')
            .insert({
                user_id: userId,
                apify_run_id: runId,
                keyword,
                location,
                max_results: maxResults,
                status: 'running',
            })
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Save scrape job error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update scrape job
router.patch('/scrape-jobs/:id', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const { data, error } = await supabase
            .from('scrape_jobs')
            .update(req.body)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Update scrape job error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// DASHBOARD
// =============================================

// Get dashboard stats
router.get('/dashboard', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.json({
                leads: { total: 0, new: 0, contacted: 0, interested: 0 },
                calls: { total: 0, completed: 0, failed: 0, avgDuration: 0 },
                campaigns: { total: 0, active: 0 },
            });
        }

        // Fetch all stats in parallel
        const [leadsData, callsData, campaignsData] = await Promise.all([
            supabase.from('leads').select('status'),
            supabase.from('calls').select('status, duration_seconds'),
            supabase.from('campaigns').select('*'),
        ]);

        const leads = leadsData.data || [];
        const calls = callsData.data || [];
        const campaigns = campaignsData.data || [];
        const completedCalls = calls.filter(c => c.status === 'ended' || c.status === 'completed');

        res.json({
            leads: {
                total: leads.length,
                new: leads.filter(l => l.status === 'new').length,
                contacted: leads.filter(l => l.status === 'contacted').length,
                interested: leads.filter(l => l.status === 'interested').length,
                withPhone: leads.length,
            },
            calls: {
                total: calls.length,
                completed: completedCalls.length,
                failed: calls.filter(c => c.status === 'failed').length,
                avgDuration: completedCalls.length > 0
                    ? Math.round(completedCalls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) / completedCalls.length)
                    : 0,
            },
            campaigns: {
                total: campaigns.length,
                active: campaigns.filter(c => c.status === 'running').length,
            },
        });
    } catch (error) {
        console.error('Get dashboard error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// USER PROFILE
// =============================================

// Get current user's profile
router.get('/profile', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const userId = await getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json(data);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update current user's profile
router.patch('/profile', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req);
        if (!supabase) {
            return res.status(400).json({ error: 'Supabase not configured' });
        }

        const userId = await getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { company_name, company_website, timezone } = req.body;

        const { data, error } = await supabase
            .from('profiles')
            .update({ company_name, company_website, timezone })
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
