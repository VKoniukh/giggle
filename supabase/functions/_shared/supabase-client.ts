// ============================================================================
// Supabase Client — shared across all Edge Functions
// Source: Reference app (Life Pattern) supabase.ts pattern
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Service role client — bypasses RLS for server-side operations
// Used by Edge Functions to write to tables where users have no write policy
export function createServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// User-scoped client — respects RLS, uses the user's JWT
// Used when we want to read data as the user sees it
export function createUserClient(authHeader: string) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: {
        headers: { Authorization: authHeader },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// Extract user_id from JWT without creating a full client
export async function getUserIdFromAuth(authHeader: string): Promise<string> {
  const client = createUserClient(authHeader);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    throw new Error('Unauthorized');
  }
  return user.id;
}

// Standard CORS headers for Edge Functions
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
