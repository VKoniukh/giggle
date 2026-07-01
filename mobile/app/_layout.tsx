/**
 * Root Layout
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE SINGLE SOURCE OF TRUTH for auth orchestration.
 * Pattern: reference app (rork-binary-heatmap-app)
 *
 * supabase.auth.onAuthStateChange lives HERE and ONLY here.
 * Auth store is a DUMB state holder.
 */

import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '@/src/store/authStore';
import { supabase } from '@/src/services/supabase';
import { COLORS } from '@/src/constants/theme';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isOnboarded = useAuthStore((s) => s.isOnboarded);
  const setSession = useAuthStore((s) => s.setSession);
  const checkOnboardingStatus = useAuthStore((s) => s.checkOnboardingStatus);

  // ═══════════════════════════════════════════════════════════════════════════
  // CENTRAL AUTH ORCHESTRATOR — the ONLY onAuthStateChange listener
  // Pattern from reference app: no bootstrap(), onAuthStateChange emits
  // INITIAL_SESSION on boot.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    let isMounted = true;
    let onboardingChecked = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!isMounted) return;
        console.log(`[Root] Auth event: ${event}`);

        if (event === 'SIGNED_OUT') {
          onboardingChecked = false;
          setSession(null);
        } else if (event === 'INITIAL_SESSION') {
          if (newSession) {
            setSession(newSession);
            // Check onboarding only once on initial session
            if (!onboardingChecked) {
              onboardingChecked = true;
              checkOnboardingStatus();
            }
          } else {
            // No session at all — stop loading immediately
            setSession(null);
          }
        } else if (event === 'SIGNED_IN' && newSession) {
          setSession(newSession);
          if (!onboardingChecked) {
            onboardingChecked = true;
            checkOnboardingStatus();
          }
        } else if (event === 'TOKEN_REFRESHED' && newSession) {
          // Silently update session tokens — no loading, no onboarding recheck
          useAuthStore.setState({
            session: newSession,
            user: newSession.user ?? null,
          });
        }
        // Other events are ignored
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Route guard — navigation based on auth state
  useEffect(() => {
    if (isLoading) return;

    const inAuth = segments[0] === 'auth';
    const inOnboarding = segments[0] === 'onboarding';

    if (!session && !inAuth) {
      router.replace('/auth');
    } else if (session && !isOnboarded && !inOnboarding) {
      router.replace('/onboarding/language');
    } else if (session && isOnboarded && inAuth) {
      // Only redirect away from auth, NOT from onboarding
      // (user may be in recalibration mode from Settings)
      router.replace('/(tabs)');
    }
  }, [session, isLoading, isOnboarded, segments]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="auth" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
});
