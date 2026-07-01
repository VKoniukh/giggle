// ============================================================================
// Supabase Client — based on reference app pattern
// Dumb client. No business logic here.
// ============================================================================

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: Move to app.config.ts / expo-constants for production
const SUPABASE_URL = 'https://gcnhqcwvnxpckscvzvnr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjbmhxY3d2bnhwY2tzY3Z6dm5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNDI1MzIsImV4cCI6MjA5NzgxODUzMn0.V3hmre6uJu4_19bsUheL14mB1zVWF3Cl32yl7FVZRaY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// ─── Edge Function Helpers ──────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };
}

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export async function callStartSession(): Promise<{
  session_id: string;
  cards: Array<{ id: string; text: string; format: string | null; move: string }>;
  frontier_size: number;
  generated_fresh: boolean;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${FUNCTIONS_URL}/start-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`start-session error ${res.status}: ${errorBody}`);
  }
  return res.json();
}

export async function callRecordSignal(params: {
  session_id: string;
  card_id: string;
  event_type: 'heart' | 'share' | 'skip' | 'back' | 'impression' | 'stop';
  dwell_ms?: number;
  estimated_read_ratio?: number;
  position?: number;
}): Promise<{
  next_card: { id: string; text: string; format: string | null; move: string } | null;
  triggers_fired: string[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${FUNCTIONS_URL}/record-signal`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`record-signal error ${res.status}: ${errorBody}`);
  }
  return res.json();
}

export async function callNextCard(sessionId: string): Promise<{
  next_card: { id: string; text: string; format: string | null; move: string } | null;
  frontier_remaining: number;
  compose_triggered: boolean;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${FUNCTIONS_URL}/next-card`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`next-card error ${res.status}: ${errorBody}`);
  }
  return res.json();
}
