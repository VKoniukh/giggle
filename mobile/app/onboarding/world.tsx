// ============================================================================
// Onboarding Step 2: World — Знайомі світи
// Source: docs/03 §Onboarding, development/04_ONBOARDING_PLAN.md
//
// Language/country is now collected in step 1 (language.tsx).
// This screen ONLY collects familiar_worlds.
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

// docs/04: "Знайомі світи — tags для вибору"
const WORLDS = [
  { id: 'software_engineering', label: 'IT / Розробка', emoji: '💻' },
  { id: 'corporate_life', label: 'Корпоративне життя', emoji: '🏢' },
  { id: 'relationships', label: 'Стосунки', emoji: '💕' },
  { id: 'parenthood', label: 'Батьківство', emoji: '👶' },
  { id: 'migration', label: 'Міграція / Еміграція', emoji: '✈️' },
  { id: 'entrepreneurship', label: 'Підприємництво', emoji: '🚀' },
  { id: 'academia', label: 'Наука / Академія', emoji: '🎓' },
  { id: 'medicine', label: 'Медицина', emoji: '🏥' },
  { id: 'creative_arts', label: 'Творчість', emoji: '🎨' },
  { id: 'student_life', label: 'Студентство', emoji: '📚' },
  { id: 'freelance', label: 'Фріланс', emoji: '☕' },
  { id: 'remote_work', label: 'Віддалена робота', emoji: '🏠' },
  { id: 'service_industry', label: 'Сфера послуг', emoji: '🍽️' },
  { id: 'city_life', label: 'Міське життя', emoji: '🌆' },
];

export default function WorldScreen() {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const router = useRouter();
  const params = useLocalSearchParams<{ recalibration?: string }>();
  const isRecalibration = params.recalibration === 'true';
  const user = useAuthStore((s) => s.user);

  // In recalibration mode, load existing familiar_worlds
  useEffect(() => {
    if (isRecalibration && user) {
      supabase
        .from('user_minds')
        .select('onboarding_context')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.onboarding_context?.familiar_worlds) {
            setSelected(data.onboarding_context.familiar_worlds);
          }
          setInitialLoaded(true);
        });
    } else {
      setInitialLoaded(true);
    }
  }, []);

  const toggleWorld = (id: string) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((w) => w !== id)
        : prev.length < 8 ? [...prev, id] : prev
    );
  };

  const handleNext = async () => {
    if (selected.length < 1) return;
    setLoading(true);
    try {
      // Read current user_minds to preserve language_state (set in step 1)
      const { data: existing } = await supabase
        .from('user_minds')
        .select('language_state, onboarding_context')
        .eq('user_id', user!.id)
        .single();

      // Merge: keep language_state from step 1, update familiar_worlds
      await supabase.from('user_minds').upsert({
        user_id: user!.id,
        onboarding_context: {
          ...(existing?.onboarding_context || {}),
          familiar_worlds: selected,
        },
        // Preserve language_state — already set in language.tsx
        language_state: existing?.language_state || { primary: 'uk', cultural_context: 'UA' },
      }, { onConflict: 'user_id' });

      router.push({
        pathname: '/onboarding/permissions',
        params: isRecalibration ? { recalibration: 'true' } : {},
      });
    } catch (err) {
      console.error('Save world error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!initialLoaded) return null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.step}>
          {isRecalibration ? 'крок 2 / 3' : '2 / 3'}
        </Text>
        <Text style={styles.title}>Які світи тобі знайомі?</Text>
        <Text style={styles.subtitle}>
          Це допоможе нам говорити твоєю мовою, не чужою
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.tags}
        showsVerticalScrollIndicator={false}
      >
        {WORLDS.map((world) => {
          const isSelected = selected.includes(world.id);
          const atLimit = selected.length >= 8 && !isSelected;
          return (
            <Pressable
              key={world.id}
              style={[
                styles.tag,
                isSelected && styles.tagSelected,
                atLimit && styles.tagDisabled,
              ]}
              onPress={() => toggleWorld(world.id)}
              disabled={atLimit}
            >
              <Text style={styles.tagEmoji}>{world.emoji}</Text>
              <Text style={[
                styles.tagLabel,
                isSelected && styles.tagLabelSelected,
                atLimit && styles.tagLabelDisabled,
              ]}>
                {world.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.counter}>
          {selected.length} / 8
          {selected.length < 1 ? '  —  мін. 1' : ''}
          {selected.length >= 8 ? '  —  максимум' : ''}
        </Text>
        <Pressable
          style={[styles.button, selected.length < 1 && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={selected.length < 1 || loading}
        >
          <Text style={styles.buttonText}>
            {loading ? '...' : 'Далі'}
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
  },
  scroll: {
    flex: 1,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.screenPadding,
    gap: SPACING.sm,
    paddingBottom: SPACING.xl,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.tagActive,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.tagBorder,
    gap: SPACING.xs,
  },
  tagSelected: {
    backgroundColor: COLORS.tagSelected,
    borderColor: COLORS.tagBorderSelected,
  },
  tagEmoji: {
    fontSize: 16,
  },
  tagLabel: {
    ...FONT.medium,
    fontSize: FONT.size.subheadline,
    color: COLORS.textSecondary,
  },
  tagLabelSelected: {
    color: COLORS.textPrimary,
  },
  tagDisabled: {
    opacity: 0.35,
  },
  tagLabelDisabled: {
    color: COLORS.textTertiary,
  },
  footer: {
    paddingHorizontal: SPACING.screenPadding,
    paddingBottom: SPACING.xl,
    gap: SPACING.md,
  },
  counter: {
    ...FONT.regular,
    fontSize: FONT.size.footnote,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
  button: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    ...FONT.semibold,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
  },
});
