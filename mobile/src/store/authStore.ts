// ============================================================================
// Auth Store — Zustand
// ============================================================================

import { create } from 'zustand';
import { supabase } from '../services/supabase';
import type { Session, User } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isOnboarded: boolean;

  setSession: (session: Session | null) => void;
  setOnboarded: (value: boolean) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  checkOnboardingStatus: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  isLoading: true,
  isOnboarded: false,

  setSession: (session) => {
    if (!session) {
      // Signed out — immediately stop loading, reset state
      set({
        session: null,
        user: null,
        isLoading: false,
        isOnboarded: false,
      });
      return;
    }

    // Signed in — set session but KEEP isLoading=true until onboarding check completes
    set({
      session,
      user: session.user ?? null,
      // Don't set isLoading=false here — wait for checkOnboardingStatus
    });
  },

  setOnboarded: (value) => set({ isOnboarded: value }),

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, isOnboarded: false });
  },

  checkOnboardingStatus: async () => {
    const user = get().user;
    if (!user) {
      set({ isLoading: false });
      return;
    }

    try {
      const { data } = await supabase
        .from('user_minds')
        .select('onboarding_completed')
        .eq('user_id', user.id)
        .single();

      set({
        isOnboarded: data?.onboarding_completed ?? false,
        isLoading: false,
      });
    } catch {
      // No user_minds row yet — user hasn't started onboarding
      set({
        isOnboarded: false,
        isLoading: false,
      });
    }
  },
}));
