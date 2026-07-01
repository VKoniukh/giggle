// ============================================================================
// Onboarding Step 3: Permissions — Boundaries
// Source: docs/03 §Onboarding, development/04_ONBOARDING_PLAN.md
// "Ми не будемо тестувати твої межі. Але знати їх — важливо."
//
// Recalibration mode:
//   - Loads existing boundaries as defaults
//   - Does NOT set onboarding_completed again
//   - Triggers reflection with 'recalibration' reason
// ============================================================================

import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/src/services/supabase';
import { useAuthStore } from '@/src/store/authStore';
import { COLORS, SPACING, FONT, RADIUS } from '@/src/constants/theme';

// docs/04: "3 стани: ✅ Можна / ⚠️ Обережно / ❌ Ні"
type PermissionLevel = 'allowed' | 'restricted' | 'forbidden';

const CATEGORIES = [
  { id: 'profanity', label: 'Мат і грубість', emoji: '🤬' },
  { id: 'dark_humor', label: 'Чорний гумор', emoji: '💀' },
  { id: 'sex', label: 'Секс і тілесність', emoji: '🔥' },
  { id: 'absurd', label: 'Повний абсурд', emoji: '🌀' },
  { id: 'cringe', label: 'Соціальний крінж', emoji: '😬' },
  { id: 'aggression', label: 'Агресивний гумор', emoji: '⚡' },
  { id: 'politics', label: 'Політика', emoji: '🏛️' },
  { id: 'religion', label: 'Релігія', emoji: '🙏' },
];

const LEVEL_CONFIG: Record<PermissionLevel, { label: string; color: string }> = {
  allowed: { label: '✅', color: COLORS.success },
  restricted: { label: '⚠️', color: COLORS.warning },
  forbidden: { label: '❌', color: COLORS.destructive },
};

export default function PermissionsScreen() {
  const [permissions, setPermissions] = useState<Record<string, PermissionLevel>>(
    Object.fromEntries(CATEGORIES.map((c) => [c.id, 'allowed']))
  );
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const router = useRouter();
  const params = useLocalSearchParams<{ recalibration?: string }>();
  const isRecalibration = params.recalibration === 'true';
  const { user, setOnboarded } = useAuthStore();

  // In recalibration mode, load existing boundaries
  useEffect(() => {
    if (isRecalibration && user) {
      supabase
        .from('user_minds')
        .select('boundaries')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.boundaries) {
            const b = data.boundaries as { allowed?: string[]; restricted?: string[]; forbidden?: string[] };
            const restored: Record<string, PermissionLevel> = {};
            CATEGORIES.forEach((c) => {
              if (b.forbidden?.includes(c.id)) restored[c.id] = 'forbidden';
              else if (b.restricted?.includes(c.id)) restored[c.id] = 'restricted';
              else restored[c.id] = 'allowed';
            });
            setPermissions(restored);
          }
          setInitialLoaded(true);
        });
    } else {
      setInitialLoaded(true);
    }
  }, []);

  const cyclePermission = (id: string) => {
    setPermissions((prev) => {
      const current = prev[id];
      const next: PermissionLevel =
        current === 'allowed' ? 'restricted' :
        current === 'restricted' ? 'forbidden' : 'allowed';
      return { ...prev, [id]: next };
    });
  };

  const handleDone = async () => {
    setLoading(true);
    try {
      // Build boundaries object from permissions
      const boundaries = {
        allowed: Object.entries(permissions)
          .filter(([_, v]) => v === 'allowed')
          .map(([k]) => k),
        restricted: Object.entries(permissions)
          .filter(([_, v]) => v === 'restricted')
          .map(([k]) => k),
        forbidden: Object.entries(permissions)
          .filter(([_, v]) => v === 'forbidden')
          .map(([k]) => k),
      };

      if (isRecalibration) {
        // Recalibration: update boundaries, trigger reflection, go back to tabs
        // development/04 §Рекалібрація: "НЕ видаляє нитки, канон, історію"
        await supabase.from('user_minds').update({
          boundaries,
        }).eq('user_id', user!.id);

        // Trigger reflection with recalibration context so AI re-evaluates
        // with new boundaries. This uses existing event-driven flow:
        // insert ai_run → pg_net trigger → ai-worker picks it up
        await supabase.from('ai_runs').insert({
          user_id: user!.id,
          run_type: 'strategic_reflect',
          status: 'queued',
          trigger_reason: 'recalibration',
          input_snapshot: { boundaries, reason: 'user_recalibrated_profile' },
        });

        // Navigate back to tabs
        router.replace('/(tabs)');
      } else {
        // First-time onboarding: set boundaries + mark completed
        await supabase.from('user_minds').update({
          boundaries,
          onboarding_completed: true,
        }).eq('user_id', user!.id);

        setOnboarded(true);
        router.replace('/(tabs)');
      }
    } catch (err) {
      console.error('Save permissions error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!initialLoaded) return null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.step}>
          {isRecalibration ? 'крок 3 / 3' : '3 / 3'}
        </Text>
        <Text style={styles.title}>Що дозволено?</Text>
        <Text style={styles.subtitle}>
          Ми не будемо тестувати твої межі.{'\n'}Але знати їх — важливо.
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {CATEGORIES.map((cat) => {
          const level = permissions[cat.id];
          const config = LEVEL_CONFIG[level];
          return (
            <Pressable
              key={cat.id}
              style={styles.row}
              onPress={() => cyclePermission(cat.id)}
            >
              <View style={styles.rowLeft}>
                <Text style={styles.rowEmoji}>{cat.emoji}</Text>
                <Text style={styles.rowLabel}>{cat.label}</Text>
              </View>
              <View style={[styles.badge, { borderColor: config.color }]}>
                <Text style={styles.badgeText}>{config.label}</Text>
              </View>
            </Pressable>
          );
        })}

        <View style={styles.legend}>
          <Text style={styles.legendText}>✅ Можна  ⚠️ Обережно  ❌ Ні</Text>
          <Text style={styles.legendHint}>Тапни щоб змінити</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleDone}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? '...' : isRecalibration ? 'Зберегти' : 'Поїхали 🚀'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingHorizontal: SPACING.screenPadding,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
  },
  step: {
    ...FONT.medium,
    fontSize: FONT.size.caption1,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  title: {
    ...FONT.bold,
    fontSize: FONT.size.title1,
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    ...FONT.regular,
    fontSize: FONT.size.subheadline,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    lineHeight: 22,
  },
  scroll: {
    flex: 1,
  },
  list: {
    paddingHorizontal: SPACING.screenPadding,
    gap: 2,
    paddingBottom: SPACING.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.separator,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  rowEmoji: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  rowLabel: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
  },
  badge: {
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 16,
  },
  legend: {
    alignItems: 'center',
    marginTop: SPACING.lg,
    gap: SPACING.xs,
  },
  legendText: {
    ...FONT.regular,
    fontSize: FONT.size.footnote,
    color: COLORS.textSecondary,
  },
  legendHint: {
    ...FONT.regular,
    fontSize: FONT.size.caption1,
    color: COLORS.textTertiary,
  },
  footer: {
    paddingHorizontal: SPACING.screenPadding,
    paddingBottom: SPACING.xl,
  },
  button: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...FONT.semibold,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
  },
});
