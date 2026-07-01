// ============================================================================
// Session & Feed Store — Zustand
// Manages: active session, card buffer, signal sending
//
// Design principles:
// - Signals are fire-and-forget (never block UI)
// - Errors are logged, never thrown to the UI layer for background ops
// - Store only holds what the UI needs (no server state duplication)
// - Prefetch triggers EARLY — 3 cards before end, requests multiple cards
// ============================================================================

import { create } from 'zustand';
import { callStartSession, callRecordSignal, callNextCard } from '../services/supabase';

export interface FeedCard {
  id: string;
  text: string;
  format: string | null;
  move: string;
}

interface SessionState {
  sessionId: string | null;
  cards: FeedCard[];
  currentIndex: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;

  // Actions
  startSession: () => Promise<void>;
  sendSignal: (cardId: string, eventType: 'heart' | 'share' | 'skip' | 'back', dwellMs?: number) => void;
  requestNextCard: () => void;
  prefetchCards: () => void;
  setCurrentIndex: (index: number) => void;
}

// Dedup guard: prevent duplicate next-card requests
let _nextCardInFlight = false;
let _prefetchInFlight = false;

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  cards: [],
  currentIndex: 0,
  isLoading: false,
  isLoadingMore: false,
  error: null,

  startSession: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await callStartSession();
      set({
        sessionId: result.session_id,
        cards: result.cards.map((c) => ({
          id: c.id,
          text: c.text,
          format: c.format,
          move: c.move,
        })),
        currentIndex: 0,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to start session',
      });
    }
  },

  // Fire-and-forget: returns void, never throws
  sendSignal: (cardId, eventType, dwellMs) => {
    const { sessionId } = get();
    if (!sessionId) return;

    // Don't await — fire and forget
    callRecordSignal({
      session_id: sessionId,
      card_id: cardId,
      event_type: eventType,
      dwell_ms: dwellMs,
    })
      .then((result) => {
        // If backend returned a next card, append to buffer
        if (result.next_card) {
          set((state) => {
            // Deduplicate to prevent React Native duplicate key errors
            const exists = state.cards.some(c => c.id === result.next_card!.id);
            if (exists) return state;
            return {
              cards: [...state.cards, result.next_card as FeedCard],
              isLoadingMore: false,
            };
          });
        }
      })
      .catch((err) => {
        // Log only — never crash UI for background signal failures
        console.warn('[sendSignal]', eventType, err.message);
      });
  },

  // Fire-and-forget with dedup — single card request
  requestNextCard: () => {
    const { sessionId } = get();
    if (!sessionId || _nextCardInFlight) return;

    _nextCardInFlight = true;
    set({ isLoadingMore: true });

    callNextCard(sessionId)
      .then((result) => {
        if (result.next_card) {
          set((state) => {
            const exists = state.cards.some(c => c.id === result.next_card!.id);
            if (exists) return state;
            return {
              cards: [...state.cards, result.next_card as FeedCard],
              isLoadingMore: false,
            };
          });
        } else {
          // No card available yet — keep loading indicator
          // It might be generating; we'll retry shortly
          set({ isLoadingMore: true });
        }
      })
      .catch((err) => {
        console.warn('[requestNextCard]', err.message);
        set({ isLoadingMore: false });
      })
      .finally(() => {
        _nextCardInFlight = false;
      });
  },

  // Prefetch multiple cards in advance — called when 3+ cards from end
  prefetchCards: () => {
    const { sessionId } = get();
    if (!sessionId || _prefetchInFlight) return;

    _prefetchInFlight = true;

    // Request 3 cards in parallel
    const requests = Array.from({ length: 3 }, () => callNextCard(sessionId));
    
    Promise.allSettled(requests)
      .then((results) => {
        const newCards: FeedCard[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.next_card) {
            newCards.push(r.value.next_card as FeedCard);
          }
        }
        if (newCards.length > 0) {
          set((state) => {
            const existingIds = new Set(state.cards.map(c => c.id));
            const unique = newCards.filter(c => !existingIds.has(c.id));
            if (unique.length === 0) return state;
            return { cards: [...state.cards, ...unique] };
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        _prefetchInFlight = false;
      });
  },

  setCurrentIndex: (index) => set({ currentIndex: index }),
}));
