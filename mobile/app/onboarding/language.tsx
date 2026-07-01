// ============================================================================
// Onboarding Step 1: Language — Мова + Культурний контекст
// Source: docs/03 §Onboarding, development/04_ONBOARDING_PLAN.md
//
// "Вік, країна та мова — це справді потрібний фундамент.
//  Вони дають культурний код, prior-контекст і мову генерації."
//
// UI: Searchable modal pickers (iOS Settings-style)
// Pre-generation: triggers cold_start_compose while user completes steps 2-3
// ============================================================================

import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform,
  NativeModules, TextInput, Modal, FlatList, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/src/services/supabase';
import { useAuthStore } from '@/src/store/authStore';
import { COLORS, SPACING, FONT, RADIUS } from '@/src/constants/theme';

// ─── Data ────────────────────────────────────────────────────────────────────

interface PickerItem {
  id: string;
  label: string;
  flag: string;
}

const LANGUAGES: PickerItem[] = [
  // Slavic
  { id: 'uk', label: 'Українська', flag: '🇺🇦' },
  { id: 'pl', label: 'Polski', flag: '🇵🇱' },
  { id: 'cs', label: 'Čeština', flag: '🇨🇿' },
  { id: 'sk', label: 'Slovenčina', flag: '🇸🇰' },
  { id: 'hr', label: 'Hrvatski', flag: '🇭🇷' },
  { id: 'bg', label: 'Български', flag: '🇧🇬' },
  { id: 'sr', label: 'Српски', flag: '🇷🇸' },
  { id: 'ru', label: 'Русский', flag: '🌐' },
  // Germanic
  { id: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { id: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { id: 'sv', label: 'Svenska', flag: '🇸🇪' },
  { id: 'da', label: 'Dansk', flag: '🇩🇰' },
  { id: 'no', label: 'Norsk', flag: '🇳🇴' },
  // Romance
  { id: 'fr', label: 'Français', flag: '🇫🇷' },
  { id: 'es', label: 'Español', flag: '🇪🇸' },
  { id: 'pt', label: 'Português', flag: '🇵🇹' },
  { id: 'it', label: 'Italiano', flag: '🇮🇹' },
  { id: 'ro', label: 'Română', flag: '🇷🇴' },
  // Other European
  { id: 'el', label: 'Ελληνικά', flag: '🇬🇷' },
  { id: 'hu', label: 'Magyar', flag: '🇭🇺' },
  { id: 'fi', label: 'Suomi', flag: '🇫🇮' },
  { id: 'lt', label: 'Lietuvių', flag: '🇱🇹' },
  { id: 'lv', label: 'Latviešu', flag: '🇱🇻' },
  { id: 'et', label: 'Eesti', flag: '🇪🇪' },
  // Asian & Other
  { id: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { id: 'ja', label: '日本語', flag: '🇯🇵' },
  { id: 'ko', label: '한국어', flag: '🇰🇷' },
  { id: 'zh', label: '中文', flag: '🇨🇳' },
  { id: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { id: 'ar', label: 'العربية', flag: '🌐' },
  { id: 'he', label: 'עברית', flag: '🇮🇱' },
  { id: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { id: 'th', label: 'ภาษาไทย', flag: '🇹🇭' },
  { id: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
];

const COUNTRIES: PickerItem[] = [
  // Eastern Europe
  { id: 'UA', label: 'Україна', flag: '🇺🇦' },
  { id: 'PL', label: 'Polska', flag: '🇵🇱' },
  { id: 'CZ', label: 'Česko', flag: '🇨🇿' },
  { id: 'SK', label: 'Slovensko', flag: '🇸🇰' },
  { id: 'RO', label: 'România', flag: '🇷🇴' },
  { id: 'HU', label: 'Magyarország', flag: '🇭🇺' },
  { id: 'BG', label: 'България', flag: '🇧🇬' },
  { id: 'HR', label: 'Hrvatska', flag: '🇭🇷' },
  { id: 'RS', label: 'Србија', flag: '🇷🇸' },
  { id: 'LT', label: 'Lietuva', flag: '🇱🇹' },
  { id: 'LV', label: 'Latvija', flag: '🇱🇻' },
  { id: 'EE', label: 'Eesti', flag: '🇪🇪' },
  { id: 'MD', label: 'Moldova', flag: '🇲🇩' },
  { id: 'BY', label: 'Беларусь', flag: '🇧🇾' },
  // Western Europe
  { id: 'DE', label: 'Deutschland', flag: '🇩🇪' },
  { id: 'GB', label: 'United Kingdom', flag: '🇬🇧' },
  { id: 'FR', label: 'France', flag: '🇫🇷' },
  { id: 'NL', label: 'Nederland', flag: '🇳🇱' },
  { id: 'BE', label: 'Belgique', flag: '🇧🇪' },
  { id: 'AT', label: 'Österreich', flag: '🇦🇹' },
  { id: 'CH', label: 'Schweiz', flag: '🇨🇭' },
  { id: 'IE', label: 'Ireland', flag: '🇮🇪' },
  // Southern Europe
  { id: 'ES', label: 'España', flag: '🇪🇸' },
  { id: 'IT', label: 'Italia', flag: '🇮🇹' },
  { id: 'PT', label: 'Portugal', flag: '🇵🇹' },
  { id: 'GR', label: 'Ελλάδα', flag: '🇬🇷' },
  // Scandinavia
  { id: 'SE', label: 'Sverige', flag: '🇸🇪' },
  { id: 'NO', label: 'Norge', flag: '🇳🇴' },
  { id: 'DK', label: 'Danmark', flag: '🇩🇰' },
  { id: 'FI', label: 'Suomi', flag: '🇫🇮' },
  // Americas
  { id: 'US', label: 'United States', flag: '🇺🇸' },
  { id: 'CA', label: 'Canada', flag: '🇨🇦' },
  { id: 'MX', label: 'México', flag: '🇲🇽' },
  { id: 'BR', label: 'Brasil', flag: '🇧🇷' },
  { id: 'AR', label: 'Argentina', flag: '🇦🇷' },
  { id: 'CO', label: 'Colombia', flag: '🇨🇴' },
  { id: 'CL', label: 'Chile', flag: '🇨🇱' },
  // Middle East & Asia
  { id: 'IL', label: 'Israel', flag: '🇮🇱' },
  { id: 'TR', label: 'Türkiye', flag: '🇹🇷' },
  { id: 'AE', label: 'UAE', flag: '🇦🇪' },
  { id: 'IN', label: 'India', flag: '🇮🇳' },
  { id: 'JP', label: '日本', flag: '🇯🇵' },
  { id: 'KR', label: '한국', flag: '🇰🇷' },
  { id: 'CN', label: '中国', flag: '🇨🇳' },
  { id: 'SG', label: 'Singapore', flag: '🇸🇬' },
  // Oceania & Africa
  { id: 'AU', label: 'Australia', flag: '🇦🇺' },
  { id: 'NZ', label: 'New Zealand', flag: '🇳🇿' },
  { id: 'ZA', label: 'South Africa', flag: '🇿🇦' },
  { id: 'NG', label: 'Nigeria', flag: '🇳🇬' },
  { id: 'KE', label: 'Kenya', flag: '🇰🇪' },
  // Catch-all
  { id: 'OTHER', label: 'Інше / Other', flag: '🌍' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectDeviceLanguage(): string {
  try {
    const locale =
      Platform.OS === 'ios'
        ? (NativeModules.SettingsManager?.settings?.AppleLocale ||
           NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] || 'uk')
        : NativeModules.I18nManager?.localeIdentifier || 'uk';
    const lang = locale.substring(0, 2).toLowerCase();
    if (LANGUAGES.some(l => l.id === lang)) return lang;
  } catch { /* fallback */ }
  return 'uk';
}

function findItem(items: PickerItem[], id: string): PickerItem | undefined {
  return items.find(i => i.id === id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Searchable Picker Modal
// ═══════════════════════════════════════════════════════════════════════════════

interface PickerModalProps {
  visible: boolean;
  title: string;
  items: PickerItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function PickerModal({ visible, title, items, selectedId, onSelect, onClose }: PickerModalProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      i => i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)
    );
  }, [items, search]);

  // Reset search on open
  useEffect(() => {
    if (visible) setSearch('');
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={pickerStyles.container}>
        {/* Header */}
        <View style={pickerStyles.header}>
          <Text style={pickerStyles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={pickerStyles.done}>Готово</Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={pickerStyles.searchContainer}>
          <TextInput
            style={pickerStyles.searchInput}
            placeholder="Пошук..."
            placeholderTextColor={COLORS.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        {/* List */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedId;
            return (
              <Pressable
                style={[pickerStyles.row, isSelected && pickerStyles.rowSelected]}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={pickerStyles.rowFlag}>{item.flag}</Text>
                <Text style={[pickerStyles.rowLabel, isSelected && pickerStyles.rowLabelSelected]}>
                  {item.label}
                </Text>
                {isSelected && <Text style={pickerStyles.checkmark}>✓</Text>}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenPadding,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  title: {
    ...FONT.bold,
    fontSize: FONT.size.title3,
    color: COLORS.textPrimary,
  },
  done: {
    ...FONT.semibold,
    fontSize: FONT.size.body,
    color: COLORS.accent,
  },
  searchContainer: {
    paddingHorizontal: SPACING.screenPadding,
    paddingBottom: SPACING.md,
  },
  searchInput: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.separator,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenPadding,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.separator,
    gap: SPACING.md,
  },
  rowSelected: {
    backgroundColor: COLORS.accentSoft,
  },
  rowFlag: {
    fontSize: 22,
    width: 32,
    textAlign: 'center',
  },
  rowLabel: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
    flex: 1,
  },
  rowLabelSelected: {
    ...FONT.semibold,
    color: COLORS.accent,
  },
  checkmark: {
    ...FONT.bold,
    fontSize: FONT.size.body,
    color: COLORS.accent,
  },
});


// ═══════════════════════════════════════════════════════════════════════════════
// Language Screen
// ═══════════════════════════════════════════════════════════════════════════════

export default function LanguageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ recalibration?: string }>();
  const isRecalibration = params.recalibration === 'true';
  const user = useAuthStore((s) => s.user);

  const [selectedLang, setSelectedLang] = useState<string>(detectDeviceLanguage());
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  // Picker modals
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);

  // In recalibration mode, load existing values
  useEffect(() => {
    if (isRecalibration && user) {
      supabase
        .from('user_minds')
        .select('language_state')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.language_state) {
            if (data.language_state.primary) setSelectedLang(data.language_state.primary);
            if (data.language_state.cultural_context) setSelectedCountry(data.language_state.cultural_context);
          }
          setInitialLoaded(true);
        });
    } else {
      setInitialLoaded(true);
    }
  }, []);

  const canProceed = selectedLang && selectedCountry;
  const selectedLangItem = findItem(LANGUAGES, selectedLang);
  const selectedCountryItem = findItem(COUNTRIES, selectedCountry);

  const handleNext = async () => {
    if (!canProceed) return;
    setLoading(true);
    try {
      // Read existing row to preserve fields
      const { data: existing } = await supabase
        .from('user_minds')
        .select('*')
        .eq('user_id', user!.id)
        .single();

      const languageState = {
        primary: selectedLang,
        cultural_context: selectedCountry,
      };

      // Upsert language_state, preserving existing data
      await supabase.from('user_minds').upsert({
        user_id: user!.id,
        language_state: languageState,
        ...(existing ? {
          onboarding_completed: existing.onboarding_completed,
          onboarding_context: existing.onboarding_context,
          boundaries: existing.boundaries,
          strategic_summary: existing.strategic_summary,
          known_anti_patterns: existing.known_anti_patterns,
          unexplored_frontiers: existing.unexplored_frontiers,
          profile_version: existing.profile_version,
        } : {}),
      }, { onConflict: 'user_id' });

      // ── PRE-GENERATION: trigger cold_start_compose NOW ──
      // While user completes steps 2-3 (worlds + permissions, ~20-30 sec),
      // ai-worker generates diagnostic probes in the background.
      // When user reaches the feed, cards are already waiting.
      if (!isRecalibration) {
        await supabase.from('ai_runs').insert({
          user_id: user!.id,
          run_type: 'cold_start_compose',
          status: 'queued',
          trigger_reason: 'pre_onboarding_generation',
          input_snapshot: {
            language_state: languageState,
            stage: 'pre_onboarding',
          },
        });
      }

      router.push({
        pathname: '/onboarding/world',
        params: isRecalibration ? { recalibration: 'true' } : {},
      });
    } catch (err) {
      console.error('Save language error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!initialLoaded) return null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.step}>
          {isRecalibration ? 'крок 1 / 3' : '1 / 3'}
        </Text>
        <Text style={styles.title}>Твоя мова</Text>
        <Text style={styles.subtitle}>
          Ми будемо говорити нею — і розуміти твій культурний код
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Language selector */}
        <Text style={styles.sectionTitle}>Мова контенту</Text>
        <Pressable
          style={styles.selectorButton}
          onPress={() => setLangPickerOpen(true)}
        >
          <View style={styles.selectorLeft}>
            <Text style={styles.selectorFlag}>
              {selectedLangItem?.flag || '🌐'}
            </Text>
            <Text style={styles.selectorLabel}>
              {selectedLangItem?.label || 'Обрати мову'}
            </Text>
          </View>
          <Text style={styles.selectorChevron}>›</Text>
        </Pressable>

        {/* Country selector */}
        <Text style={[styles.sectionTitle, { marginTop: SPACING.xl }]}>
          Де ти зараз живеш?
        </Text>
        <Text style={styles.sectionHint}>
          Це допоможе підібрати культурно релевантний контекст
        </Text>
        <Pressable
          style={styles.selectorButton}
          onPress={() => setCountryPickerOpen(true)}
        >
          <View style={styles.selectorLeft}>
            <Text style={styles.selectorFlag}>
              {selectedCountryItem?.flag || '🌍'}
            </Text>
            <Text style={[
              styles.selectorLabel,
              !selectedCountryItem && styles.selectorPlaceholder,
            ]}>
              {selectedCountryItem?.label || 'Обрати країну'}
            </Text>
          </View>
          <Text style={styles.selectorChevron}>›</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.button, !canProceed && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={!canProceed || loading}
        >
          <Text style={styles.buttonText}>
            {loading ? '...' : 'Далі'}
          </Text>
        </Pressable>
      </View>

      {/* Picker Modals */}
      <PickerModal
        visible={langPickerOpen}
        title="Мова контенту"
        items={LANGUAGES}
        selectedId={selectedLang}
        onSelect={setSelectedLang}
        onClose={() => setLangPickerOpen(false)}
      />
      <PickerModal
        visible={countryPickerOpen}
        title="Країна"
        items={COUNTRIES}
        selectedId={selectedCountry}
        onSelect={setSelectedCountry}
        onClose={() => setCountryPickerOpen(false)}
      />
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
  content: {
    paddingHorizontal: SPACING.screenPadding,
    paddingBottom: SPACING.xl,
  },
  sectionTitle: {
    ...FONT.semibold,
    fontSize: FONT.size.headline,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  sectionHint: {
    ...FONT.regular,
    fontSize: FONT.size.footnote,
    color: COLORS.textTertiary,
    marginBottom: SPACING.md,
    marginTop: -SPACING.sm,
  },
  // Selector button (iOS Settings-style)
  selectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: COLORS.separator,
  },
  selectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  selectorFlag: {
    fontSize: 24,
  },
  selectorLabel: {
    ...FONT.medium,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
  },
  selectorPlaceholder: {
    color: COLORS.textTertiary,
  },
  selectorChevron: {
    ...FONT.regular,
    fontSize: 22,
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
    opacity: 0.4,
  },
  buttonText: {
    ...FONT.semibold,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
  },
});
