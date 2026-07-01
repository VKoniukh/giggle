// ============================================================================
// Personal Canon — Hearted cards collection
// Source: docs/03 §Personal Canon
// "Не saved posts, а зростаюча колекція текстів, які реально пробили людину"
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/src/services/supabase';
import { useAuthStore } from '@/src/store/authStore';
import { COLORS, SPACING, FONT, RADIUS } from '@/src/constants/theme';

interface CanonCard {
  id: string;
  text: string;
  format: string | null;
  shown_at: string;
}

export default function CanonScreen() {
  const [cards, setCards] = useState<CanonCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const user = useAuthStore((s) => s.user);

  const loadCanon = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('cards')
      .select('id, text, format, shown_at')
      .eq('user_id', user.id)
      .eq('status', 'hearted')
      .order('shown_at', { ascending: false });

    setCards(data || []);
  }, [user]);

  useEffect(() => {
    loadCanon();
  }, [loadCanon]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCanon();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Канон</Text>
        <Text style={styles.count}>{cards.length}</Text>
      </View>

      {cards.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>♡</Text>
          <Text style={styles.emptyText}>
            Тексти, які тебе проб'ють,{'\n'}з'являться тут
          </Text>
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.textSecondary}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardText}>{item.text}</Text>
              {item.format && (
                <Text style={styles.cardFormat}>{item.format}</Text>
              )}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
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
  count: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textTertiary,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    color: COLORS.textTertiary,
    marginBottom: SPACING.md,
  },
  emptyText: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textTertiary,
    textAlign: 'center',
    lineHeight: 24,
  },
  list: {
    paddingHorizontal: SPACING.screenPadding,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  card: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.separator,
  },
  cardText: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
    lineHeight: 24,
  },
  cardFormat: {
    ...FONT.regular,
    fontSize: FONT.size.caption1,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
