// ============================================================================
// Settings Screen — Profile display + Recalibration
// Source: development/04_ONBOARDING_PLAN.md §Рекалібрація
//
// "Повертає на Steps 1-3 (language + world + permissions)
//  НЕ видаляє нитки, канон, історію
//  Лише оновлює onboarding_context і boundaries"
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/src/services/supabase';
import { useAuthStore } from '@/src/store/authStore';
import { COLORS, SPACING, FONT, RADIUS } from '@/src/constants/theme';

// Language/Country labels — settings displays whatever is stored
// Falls back to showing the raw ID if not in this map
const LANG_LABELS: Record<string, string> = {
  uk: 'Українська 🇺🇦', pl: 'Polski 🇵🇱', cs: 'Čeština 🇨🇿', sk: 'Slovenčina 🇸🇰',
  hr: 'Hrvatski 🇭🇷', bg: 'Български 🇧🇬', sr: 'Српски 🇷🇸', ru: 'Русский 🌐',
  en: 'English 🇬🇧', de: 'Deutsch 🇩🇪', nl: 'Nederlands 🇳🇱', sv: 'Svenska 🇸🇪',
  da: 'Dansk 🇩🇰', no: 'Norsk 🇳🇴', fr: 'Français 🇫🇷', es: 'Español 🇪🇸',
  pt: 'Português 🇵🇹', it: 'Italiano 🇮🇹', ro: 'Română 🇷🇴', el: 'Ελληνικά 🇬🇷',
  hu: 'Magyar 🇭🇺', fi: 'Suomi 🇫🇮', lt: 'Lietuvių 🇱🇹', lv: 'Latviešu 🇱🇻',
  et: 'Eesti 🇪🇪', tr: 'Türkçe 🇹🇷', ja: '日本語 🇯🇵', ko: '한국어 🇰🇷',
  zh: '中文 🇨🇳', hi: 'हिन्दी 🇮🇳', ar: 'العربية 🌐', he: 'עברית 🇮🇱',
  vi: 'Tiếng Việt 🇻🇳', th: 'ภาษาไทย 🇹🇭', id: 'Bahasa Indonesia 🇮🇩',
};

const COUNTRY_LABELS: Record<string, string> = {
  UA: 'Україна 🇺🇦', PL: 'Polska 🇵🇱', CZ: 'Česko 🇨🇿', SK: 'Slovensko 🇸🇰',
  RO: 'România 🇷🇴', HU: 'Magyarország 🇭🇺', BG: 'България 🇧🇬', HR: 'Hrvatska 🇭🇷',
  RS: 'Србија 🇷🇸', LT: 'Lietuva 🇱🇹', LV: 'Latvija 🇱🇻', EE: 'Eesti 🇪🇪',
  DE: 'Deutschland 🇩🇪', GB: 'UK 🇬🇧', FR: 'France 🇫🇷', NL: 'Nederland 🇳🇱',
  BE: 'Belgique 🇧🇪', AT: 'Österreich 🇦🇹', CH: 'Schweiz 🇨🇭', IE: 'Ireland 🇮🇪',
  ES: 'España 🇪🇸', IT: 'Italia 🇮🇹', PT: 'Portugal 🇵🇹', GR: 'Ελλάδα 🇬🇷',
  SE: 'Sverige 🇸🇪', NO: 'Norge 🇳🇴', DK: 'Danmark 🇩🇰', FI: 'Suomi 🇫🇮',
  US: 'USA 🇺🇸', CA: 'Canada 🇨🇦', MX: 'México 🇲🇽', BR: 'Brasil 🇧🇷',
  AR: 'Argentina 🇦🇷', IL: 'Israel 🇮🇱', TR: 'Türkiye 🇹🇷', JP: '日本 🇯🇵',
  KR: '한국 🇰🇷', CN: '中国 🇨🇳', AU: 'Australia 🇦🇺', NZ: 'NZ 🇳🇿',
  OTHER: 'Інше 🌍',
};

interface ProfileData {
  language: string | null;
  country: string | null;
  worlds: string[];
}

export default function SettingsScreen() {
  const { user, signOut } = useAuthStore();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);

  // Load profile data — refresh on every focus (after recalibration)
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      supabase
        .from('user_minds')
        .select('language_state, onboarding_context')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setProfile({
              language: data.language_state?.primary || null,
              country: data.language_state?.cultural_context || null,
              worlds: data.onboarding_context?.familiar_worlds || [],
            });
          }
        });
    }, [user])
  );

  const handleSignOut = () => {
    Alert.alert('Вийти?', '', [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Вийти', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleRecalibrate = () => {
    Alert.alert(
      'Перекалібрувати?',
      'Ти зможеш змінити мову, світи та межі.\nТвої нитки, канон та історія залишаться.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Перекалібрувати',
          onPress: () => {
            router.push({
              pathname: '/onboarding/language',
              params: { recalibration: 'true' },
            });
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Налаштування</Text>
        </View>

        {/* Profile Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Профіль</Text>

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Мова</Text>
              <Text style={styles.rowValue}>
                {profile?.language ? (LANG_LABELS[profile.language] || profile.language) : '—'}
              </Text>
            </View>

            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowLabel}>Країна</Text>
              <Text style={styles.rowValue}>
                {profile?.country ? (COUNTRY_LABELS[profile.country] || profile.country) : '—'}
              </Text>
            </View>

            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowLabel}>Світи</Text>
              <Text style={styles.rowValue}>
                {profile?.worlds?.length ? `${profile.worlds.length} обрано` : '—'}
              </Text>
            </View>
          </View>

          <Pressable style={styles.recalibrateButton} onPress={handleRecalibrate}>
            <Text style={styles.recalibrateText}>🔄 Перекалібрувати</Text>
            <Text style={styles.recalibrateHint}>Змінити мову, світи, межі</Text>
          </Pressable>
        </View>

        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Акаунт</Text>

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue}>{user?.email || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Sign Out */}
        <View style={styles.section}>
          <Pressable style={styles.card} onPress={handleSignOut}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: COLORS.destructive }]}>Вийти</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
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
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  title: {
    ...FONT.bold,
    fontSize: FONT.size.largeTitle,
    color: COLORS.textPrimary,
    letterSpacing: -1,
  },
  section: {
    paddingHorizontal: SPACING.screenPadding,
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...FONT.semibold,
    fontSize: FONT.size.footnote,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  card: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.separator,
  },
  rowLabel: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
  },
  rowValue: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textSecondary,
    maxWidth: '60%',
    textAlign: 'right',
  },
  recalibrateButton: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.md,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    gap: 2,
  },
  recalibrateText: {
    ...FONT.medium,
    fontSize: FONT.size.body,
    color: COLORS.accent,
  },
  recalibrateHint: {
    ...FONT.regular,
    fontSize: FONT.size.caption1,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
});
