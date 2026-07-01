// ============================================================================
// Orchestrator — the deterministic heart of Giggle
// Source: docs/04_ORCHESTRATION.md — 9 operations, hard constraints, поділ влади
//         docs/06_EDGE_FUNCTIONS_AND_AI.md — card selection formula
//
// "Механіка вирішує: зараз потрібен transfer, температура нижча, нитка A
//  перегріта. AI вирішує: як перетворити цей нерв у текст."
//
// ONE code path for card selection (used by record-signal AND next-card).
// ONE deterministic mission builder (compose NEVER runs without missions).
// No GPT calls in this module. Ever.
// ============================================================================

import {
  MAX_SAME_THREAD_CONSECUTIVE,
  MAX_SAME_FORMAT_IN_5,
  MIN_CALLBACK_PAUSE_CARDS,
  COMPOSE_CANDIDATE_COUNT,
} from './constants.ts';
import type { RhythmState, Thread } from './types.ts';

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface CandidateRow {
  id: string;
  text: string;
  format: string | null;
  move: string;
  recipe: Record<string, unknown> | null;
  queue_priority: number;
  source_thread_ids: string[] | null;
  source_thread_versions: Record<string, number> | null;
}

export interface ComposeMission {
  move: string;
  thread_ids: string[];
  purpose: string;
  target_context: string | null;
  constraints: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Boundary safety — cheap keyword heuristic for pre-generated / fund cards.
// Recipes are English metadata, so we match English descriptors.
// ═══════════════════════════════════════════════════════════════════════════════

const BOUNDARY_KEYWORDS: Record<string, string[]> = {
  dark_humor: ['death', 'dying', 'disease', 'illness', 'funeral', 'cancer', 'mortality', 'grief', 'hospital'],
  sex: ['sex', 'sexual', 'erotic', 'intimacy', 'nudity'],
  politics: ['politic', 'election', 'government', 'president', 'parliament'],
  religion: ['religio', 'church', 'god', 'priest', 'faith', 'prayer'],
  violence: ['violen', 'blood', 'murder', 'weapon', 'abuse'],
  profanity: ['profan', 'swear', 'obscen', 'vulgar'],
  aggression: ['aggress', 'humiliat', 'mockery', 'contempt'],
};

export function violatesBoundaries(
  card: { recipe?: Record<string, unknown> | null; text?: string | null },
  forbidden: string[] | undefined,
): boolean {
  if (!forbidden?.length) return false;
  const hay = (JSON.stringify(card.recipe || {})).toLowerCase();
  for (const zone of forbidden) {
    if (hay.includes(zone.toLowerCase())) return true;
    for (const kw of BOUNDARY_KEYWORDS[zone] || []) {
      if (hay.includes(kw)) return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Card selection — hard constraints (docs/04) then score formula (docs/06)
// ═══════════════════════════════════════════════════════════════════════════════

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function threadsOf(card: CandidateRow, threadMap: Map<string, Thread>): Thread[] {
  return (card.source_thread_ids || [])
    .map((id) => threadMap.get(id))
    .filter(Boolean) as Thread[];
}

function passesHardConstraints(
  card: CandidateRow,
  rhythm: RhythmState,
  threadMap: Map<string, Thread>,
): boolean {
  const recentThreadIds: string[] = rhythm.recent_thread_ids || [];
  const recentFormats: string[] = rhythm.formats_recently_used || [];

  // ✗ не більше 2 близьких карток однієї нитки підряд
  if (card.source_thread_ids?.length) {
    const lastN = recentThreadIds.slice(-MAX_SAME_THREAD_CONSECUTIVE);
    if (
      lastN.length >= MAX_SAME_THREAD_CONSECUTIVE &&
      lastN.every((tid) => card.source_thread_ids!.includes(tid))
    ) return false;
  }

  // ✗ не повторювати format 3 рази з 5
  const cardFormat = card.format || (card.recipe?.format as string | undefined);
  if (cardFormat) {
    const count = recentFormats.filter((f) => f === cardFormat).length;
    if (count >= MAX_SAME_FORMAT_IN_5) return false;
  }

  // ✗ не показувати stale card (thread version змінилась)
  if (card.source_thread_versions) {
    for (const [tid, expected] of Object.entries(card.source_thread_versions)) {
      const t = threadMap.get(tid);
      if (t && t.version > (expected as number)) return false; // stale → discard by caller
    }
  }

  // ✗ не callback без достатньої паузи
  // Approximation: none of the card's threads may appear in the recent window.
  if (card.move === 'callback' && card.source_thread_ids?.length) {
    const window = recentThreadIds.slice(-MIN_CALLBACK_PAUSE_CARDS);
    if (card.source_thread_ids.some((tid) => window.includes(tid))) return false;
  }

  // ✗ нитки, яким Reflector сказав відпочити
  const resting: string[] = rhythm.threads_to_rest || [];
  if (card.source_thread_ids?.some((tid) => resting.includes(tid))) return false;

  return true;
}

function scoreCard(
  card: CandidateRow,
  rhythm: RhythmState,
  threadMap: Map<string, Thread>,
): number {
  const threads = threadsOf(card, threadMap);
  const debt = rhythm.novelty_debt || 0;
  const recentMoves: string[] = rhythm.recent_moves || [];
  const recentFormats: string[] = rhythm.formats_recently_used || [];
  const recentVoices: string[] = rhythm.voices_recently_used || [];

  let score = card.queue_priority;

  // + thread_heat / - thread_fatigue
  score += 0.3 * avg(threads.map((t) => t.heat));
  score -= 0.4 * avg(threads.map((t) => t.fatigue));

  // + move_fit: when novelty debt is high the session NEEDS departure moves
  if (debt > 0.4) {
    if (card.move === 'wildcard') score += 0.35;
    else if (['transfer', 'bridge', 'probe', 'contrast'].includes(card.move)) score += 0.2;
    else if (card.move === 'deepen') score -= 0.15;
  }

  // - move repetition: same move as last 2 shown
  const lastTwoMoves = recentMoves.slice(-2);
  if (lastTwoMoves.length === 2 && lastTwoMoves.every((m) => m === card.move)) {
    score -= 0.2;
  }

  // + novelty_bonus from recipe.semantic_distance
  const semDist = Number(card.recipe?.semantic_distance) || 0;
  score += 0.15 * semDist * (0.5 + debt);

  // - format repetition (soft penalty below the hard cutoff)
  const cardFormat = card.format || (card.recipe?.format as string | undefined);
  if (cardFormat) {
    score -= 0.1 * recentFormats.filter((f) => f === cardFormat).length;
  }

  // - voice repetition against last shown recipes
  const voice = card.recipe?.voice as string | undefined;
  if (voice && recentVoices.includes(voice)) score -= 0.15;

  return score;
}

/**
 * Select the best queued card and mark it 'delivered' (NOT shown — the card
 * is shown only when the client reports an impression). Returns null when
 * the frontier is empty or fully constrained.
 */
export async function selectAndDeliverCard(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<{ card: CandidateRow | null; frontierRemaining: number }> {
  const { data: session } = await supabase
    .from('sessions')
    .select('rhythm_state')
    .eq('id', sessionId)
    .single();
  const rhythm: RhythmState = session?.rhythm_state || {};

  const { data: candidates } = await supabase
    .from('cards')
    .select('id, text, format, move, recipe, queue_priority, source_thread_ids, source_thread_versions')
    .eq('user_id', userId)
    .eq('status', 'queued')
    .order('queue_priority', { ascending: false })
    .limit(12);

  if (!candidates?.length) return { card: null, frontierRemaining: 0 };

  // ONE query for all involved threads (no N+1)
  const allThreadIds = [
    ...new Set(candidates.flatMap((c: CandidateRow) => c.source_thread_ids || [])),
  ];
  const threadMap = new Map<string, Thread>();
  if (allThreadIds.length) {
    const { data: threads } = await supabase
      .from('threads')
      .select('id, version, heat, fatigue, confidence, status')
      .in('id', allThreadIds);
    for (const t of threads || []) threadMap.set(t.id, t as Thread);
  }

  // Discard stale cards, filter the rest through hard constraints
  const staleIds: string[] = [];
  const viable: CandidateRow[] = [];
  for (const c of candidates as CandidateRow[]) {
    let stale = false;
    if (c.source_thread_versions) {
      for (const [tid, expected] of Object.entries(c.source_thread_versions)) {
        const t = threadMap.get(tid);
        if (t && t.version > (expected as number)) { stale = true; break; }
      }
    }
    if (stale) { staleIds.push(c.id); continue; }
    if (passesHardConstraints(c, rhythm, threadMap)) viable.push(c);
  }
  if (staleIds.length) {
    await supabase.from('cards').update({ status: 'discarded' }).in('id', staleIds);
  }

  // Fallback: if EVERY candidate hits a constraint, relax (MVP: better a
  // constrained card than an empty feed) — but never serve a stale one.
  const pool = viable.length
    ? viable
    : (candidates as CandidateRow[]).filter((c) => !staleIds.includes(c.id));
  if (!pool.length) return { card: null, frontierRemaining: 0 };

  pool.sort((a, b) => scoreCard(b, rhythm, threadMap) - scoreCard(a, rhythm, threadMap));
  const selected = pool[0];

  // Atomic claim: two concurrent requests can't deliver the same card
  const { data: claimed } = await supabase
    .from('cards')
    .update({ status: 'delivered', session_id: sessionId })
    .eq('id', selected.id)
    .eq('status', 'queued')
    .select('id');

  if (!claimed?.length) {
    // Lost the race — one recursive retry with the remaining pool
    const rest = pool.slice(1);
    if (!rest.length) return { card: null, frontierRemaining: 0 };
    const { data: reclaimed } = await supabase
      .from('cards')
      .update({ status: 'delivered', session_id: sessionId })
      .eq('id', rest[0].id)
      .eq('status', 'queued')
      .select('id');
    if (!reclaimed?.length) return { card: null, frontierRemaining: 0 };
    return { card: rest[0], frontierRemaining: Math.max(0, candidates.length - staleIds.length - 2) };
  }

  return {
    card: selected,
    frontierRemaining: Math.max(0, candidates.length - staleIds.length - 1),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mission builder — the deterministic operational level (docs/04, 3 рівні)
//
// Code decides WHICH moves the session needs; AI only materializes them.
// Frontier slots (docs/04 §Rolling Frontier):
//   slot 1 — anchor / likely hit (deepen)
//   slot 2 — nearby mutation
//   slot 3 — transfer or contrast
//   slot 4 — wildcard
//   slot 5 — callback candidate (optional)
// ═══════════════════════════════════════════════════════════════════════════════

export function buildComposeMissions(
  threads: Thread[],
  rhythm: RhythmState | null,
  userMind: {
    unexplored_frontiers?: string[];
    onboarding_context?: { familiar_worlds?: string[] };
  } | null,
  count: number = COMPOSE_CANDIDATE_COUNT,
): ComposeMission[] {
  const missions: ComposeMission[] = [];
  const debt = rhythm?.novelty_debt || 0;
  const restingByReflector: string[] = rhythm?.threads_to_rest || [];
  const recentThreadIds: string[] = rhythm?.recent_thread_ids || [];

  const usable = threads
    .filter((t) => ['active', 'candidate'].includes(t.status))
    .filter((t) => !restingByReflector.includes(t.id))
    .sort((a, b) => b.heat - a.heat);

  const resting = threads.filter((t) => t.status === 'resting');

  // slot 1 — anchor: hottest thread with low fatigue → deepen
  const anchor = usable.find((t) => t.fatigue < 0.5);
  if (anchor) {
    missions.push({
      move: 'deepen',
      thread_ids: [anchor.id],
      purpose: anchor.open_question
        ? `Test the open question: ${anchor.open_question}`
        : `Go one level deeper into: ${anchor.core}`,
      target_context: (anchor.confirmed_contexts as unknown as string[])?.[0] || null,
      constraints: { avoid: anchor.avoid, voices: anchor.working_voices },
    });
  }

  // slot 2 — nearby mutation: same nerve, different operator
  const mutateTarget = anchor || usable[0];
  if (mutateTarget && missions.length < count) {
    missions.push({
      move: 'mutate',
      thread_ids: [mutateTarget.id],
      purpose: `Keep the nerve (${mutateTarget.core}) but change the comic operator — do NOT reuse the mechanism "${mutateTarget.mechanism}" verbatim`,
      target_context: null,
      constraints: { avoid: mutateTarget.avoid },
    });
  }

  // slot 3 — transfer: hot but fatigued thread carried into a new world
  const transferTarget = usable.find((t) => t.fatigue >= 0.5 && t.heat > 0.4) ||
    usable.find((t) => ((t.contexts_to_try as unknown as string[]) || []).length > 0);
  if (transferTarget && missions.length < count) {
    const tryContexts = (transferTarget.contexts_to_try as unknown as string[]) || [];
    missions.push({
      move: 'transfer',
      thread_ids: [transferTarget.id],
      purpose: `Test whether the mechanism survives outside its home context: ${transferTarget.mechanism}`,
      target_context: tryContexts[0] || 'a completely different life domain',
      constraints: { avoid: transferTarget.avoid },
    });
  }

  // slot 4 — wildcard: mandatory when novelty debt is high,
  // docs/04: "✓ тримати хоча б один probe/wildcard у короткому горизонті"
  if (missions.length < count) {
    const frontiers = userMind?.unexplored_frontiers || [];
    missions.push({
      move: debt > 0.4 ? 'wildcard' : 'probe',
      thread_ids: [],
      purpose: frontiers.length
        ? `Probe an untouched territory: ${frontiers[0]}`
        : 'Controlled jump outside the current profile — something none of the active threads predicts',
      target_context: null,
      constraints: {},
    });
  }

  // slot 5 — callback: resting thread absent from the recent window
  const callbackTarget = resting.find(
    (t) => !recentThreadIds.slice(-MIN_CALLBACK_PAUSE_CARDS).includes(t.id),
  );
  if (callbackTarget && missions.length < count) {
    missions.push({
      move: 'callback',
      thread_ids: [callbackTarget.id],
      purpose: `Return the motif with a NEW angle (never repeat the original surface): ${callbackTarget.core}`,
      target_context: null,
      constraints: { avoid: callbackTarget.avoid },
    });
  }

  // Fill remaining slots with orthogonal probes (cold start / thin profile)
  const worlds = userMind?.onboarding_context?.familiar_worlds || [];
  const frontiers = userMind?.unexplored_frontiers || [];
  const probeSeeds = [
    ...frontiers.slice(1),
    ...worlds.map((w) => `an unexpected angle on ${w}`),
    'dry recognition — a micro-behavior everyone does but nobody names',
    'escalation — formal composure maintained while reality crumbles',
    'tender human imperfection',
    'linguistic literalism',
    'social catastrophe with unresolved cringe',
    'absurd capitulation to reality',
  ];
  let seedIdx = 0;
  while (missions.length < count && seedIdx < probeSeeds.length) {
    missions.push({
      move: 'probe',
      thread_ids: [],
      purpose: `Orthogonal diagnostic probe: ${probeSeeds[seedIdx]}`,
      target_context: null,
      constraints: {},
    });
    seedIdx++;
  }

  return missions.slice(0, count);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI-run queueing with dedup (backed by unique index from migration 007).
// A unique violation means an identical run is already queued — that is
// SUCCESS for our purposes, not an error.
// ═══════════════════════════════════════════════════════════════════════════════

export async function queueAiRun(
  supabase: SupabaseClient,
  run: {
    user_id: string;
    session_id?: string | null;
    run_type: string;
    trigger_reason: string;
    input_snapshot?: Record<string, unknown>;
    prompt_version: string;
    schema_version: string;
  },
): Promise<'queued' | 'duplicate' | 'error'> {
  const { error } = await supabase.from('ai_runs').insert({
    ...run,
    status: 'queued',
  });
  if (!error) return 'queued';
  // 23505 = unique_violation → a run of this type is already queued
  if (error.code === '23505') return 'duplicate';
  console.error(`queueAiRun ${run.run_type} failed:`, error.message);
  return 'error';
}
