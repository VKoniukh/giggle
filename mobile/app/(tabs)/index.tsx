// ============================================================================
// Feed Screen — TikTok/Reels-style vertical scroll
// Source: docs/03 §Signal Semantics, docs/06 §record-signal
//
// How it works (like TikTok/Reels):
// - FlatList with pagingEnabled snaps to full-screen cards
// - onMomentumScrollEnd determines which card is visible (stable API)
// - Dwell time tracked per card via useEffect on currentIndex
// - Signals (skip/back/heart) sent fire-and-forget (never block UI)
// - Heart changes icon + haptic; no re-render of entire list
// - ListFooterComponent shows loading when generating new cards
// - Prefetch triggers 3 cards before end for seamless scrolling
// ============================================================================

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet,
  Dimensions, ActivityIndicator, NativeSyntheticEvent,
  NativeScrollEvent, Share,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSessionStore, FeedCard } from '@/src/store/sessionStore';
import { COLORS, SPACING, FONT, RADIUS, TAB_BAR_HEIGHT } from '@/src/constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Dwell normalization (docs/03 §Signal Vector): 3s on 7 words and 3s on
// 100 words are different events. ~220 words per minute reading speed.
function estimateReadRatio(text: string, dwellMs: number): number {
  const words = text.trim().split(/\s+/).length;
  const expectedMs = Math.max(1200, (words / 220) * 60_000);
  return Math.round(Math.min(dwellMs / expectedMs, 1.5) * 100) / 100;
}

// ─── Card Component (memoized, handles its own heart state) ─────────────────
interface CardItemProps {
  card: FeedCard;
  height: number;
  onHeart: (card: FeedCard) => void;
  onShare: (card: FeedCard) => void;
}

function CardItem({ card, height, onHeart, onShare }: CardItemProps) {
  const [hearted, setHearted] = useState(false);

  const handleHeart = useCallback(() => {
    if (hearted) return;
    setHearted(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onHeart(card);
  }, [hearted, card, onHeart]);

  const handleShare = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onShare(card);
  }, [card, onShare]);

  return (
    <View style={[styles.cardContainer, { height }]}>
      <View style={styles.cardContent}>
        <Text style={styles.cardText}>{card.text}</Text>
        {card.format && (
          <Text style={styles.cardFormat}>{card.format}</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionButton, hearted && styles.actionButtonHearted]}
          onPress={handleHeart}
        >
          <Text style={[styles.heartIcon, hearted && styles.heartIconActive]}>
            {hearted ? '♥' : '♡'}
          </Text>
        </Pressable>

        <Pressable style={styles.actionButton} onPress={handleShare}>
          <Text style={styles.shareIcon}>↗</Text>
        </Pressable>
      </View>
    </View>
  );
}

const MemoizedCardItem = React.memo(CardItem);

// ─── Feed Screen ────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const {
    cards, currentIndex, isLoading, isLoadingMore, error,
    startSession, sendSignal, requestNextCard, prefetchCards, setCurrentIndex,
  } = useSessionStore();

  const flatListRef = useRef<FlatList>(null);
  const dwellStartRef = useRef<number>(Date.now());
  const prevIndexRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentImpressionsRef = useRef<Set<string>>(new Set());

  const CARD_HEIGHT = SCREEN_HEIGHT - TAB_BAR_HEIGHT - insets.top;

  // ─── Start session on mount ─────────────────────────────────────────────
  useEffect(() => {
    startSession();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // ─── Dwell tracking + Prefetch logic ──────────────────────────────────────
  useEffect(() => {
    const prevIndex = prevIndexRef.current;

    if (prevIndex === currentIndex && dwellStartRef.current === 0) {
      dwellStartRef.current = Date.now();
      return;
    }

    if (prevIndex !== currentIndex && cards.length > 0 && cards[prevIndex]) {
      const dwellMs = Date.now() - dwellStartRef.current;
      const prevCard = cards[prevIndex];
      const direction = currentIndex > prevIndex ? 'skip' : 'back';
      sendSignal(prevCard.id, direction, dwellMs, {
        estimatedReadRatio: estimateReadRatio(prevCard.text, dwellMs),
        position: prevIndex,
      });
    }

    dwellStartRef.current = Date.now();
    prevIndexRef.current = currentIndex;

    // ── Prefetch logic ──
    const remaining = cards.length - currentIndex - 1;

    if (remaining <= 3 && remaining > 1) {
      prefetchCards();
    } else if (remaining <= 1) {
      requestNextCard();

      if (remaining === 0) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          requestNextCard();
        }, 3000);
      }
    }
  }, [currentIndex, cards.length]);

  // ─── Impression: the card became VISIBLE ─────────────────────────────────
  // This is what makes shown_at honest server-side: delivered → shown happens
  // when the user actually sees the card, not when the buffer prefetched it.
  useEffect(() => {
    const card = cards[currentIndex];
    if (card && !sentImpressionsRef.current.has(card.id)) {
      sentImpressionsRef.current.add(card.id);
      sendSignal(card.id, 'impression', undefined, { position: currentIndex });
    }
  }, [currentIndex, cards]);

  // ─── Scroll handler ─────────────────────────────────────────────────────
  const handleScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = e.nativeEvent.contentOffset.y;
    const newIndex = Math.round(offsetY / CARD_HEIGHT);
    if (newIndex >= 0 && newIndex < cards.length) {
      setCurrentIndex(newIndex);
    }
  }, [CARD_HEIGHT, cards.length, setCurrentIndex]);

  const handleHeart = useCallback((card: FeedCard) => {
    const dwellMs = Date.now() - dwellStartRef.current;
    sendSignal(card.id, 'heart', dwellMs, {
      estimatedReadRatio: estimateReadRatio(card.text, dwellMs),
    });
  }, [sendSignal]);

  // Share must actually SHARE — the signal means "this text performs a
  // social function" (docs/03) and is only recorded on a completed share.
  const handleShare = useCallback(async (card: FeedCard) => {
    try {
      const result = await Share.share({ message: card.text });
      if (result.action === Share.sharedAction) {
        sendSignal(card.id, 'share');
      }
    } catch {
      // user dismissed or share unavailable — no signal
    }
  }, [sendSignal]);

  // ─── Render item (only real cards) ──────────────────────────────────────
  const renderCard = useCallback(({ item }: { item: FeedCard }) => (
    <MemoizedCardItem
      card={item}
      height={CARD_HEIGHT}
      onHeart={handleHeart}
      onShare={handleShare}
    />
  ), [CARD_HEIGHT, handleHeart, handleShare]);

  const keyExtractor = useCallback((item: FeedCard) => item.id, []);

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: CARD_HEIGHT,
    offset: CARD_HEIGHT * index,
    index,
  }), [CARD_HEIGHT]);

  // ─── Loading footer (ListFooterComponent — NOT in data array) ───────────
  const renderFooter = useCallback(() => {
    if (!isLoadingMore) return null;
    return (
      <View style={[styles.loadingFooter, { height: CARD_HEIGHT }]}>
        <ActivityIndicator size="small" color={COLORS.accent} />
        <Text style={styles.loadingText}>Генеруємо ще...</Text>
      </View>
    );
  }, [isLoadingMore, CARD_HEIGHT]);

  // ─── Loading state ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={styles.stateContainer}>
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={styles.stateText}>Завантаження...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.stateContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={startSession}>
          <Text style={styles.retryText}>Спробувати знову</Text>
        </Pressable>
      </View>
    );
  }

  if (cards.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <Text style={styles.stateText}>Генеруємо картки...</Text>
        <ActivityIndicator size="small" color={COLORS.textSecondary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  // ─── Main feed ──────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        ref={flatListRef}
        data={cards}
        renderItem={renderCard}
        keyExtractor={keyExtractor}
        pagingEnabled
        snapToInterval={CARD_HEIGHT}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        getItemLayout={getItemLayout}
        ListFooterComponent={renderFooter}
        initialNumToRender={2}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    paddingHorizontal: SPACING.screenPadding,
  },
  stateText: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  errorText: {
    ...FONT.regular,
    fontSize: FONT.size.body,
    color: COLORS.destructive,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.bgElevated,
  },
  retryText: {
    ...FONT.medium,
    fontSize: FONT.size.body,
    color: COLORS.textPrimary,
  },
  cardContainer: {
    width: SCREEN_WIDTH,
    flexDirection: 'row',
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.screenPadding + SPACING.md,
    paddingRight: 72,
  },
  cardText: {
    ...FONT.regular,
    fontSize: FONT.size.title3,
    color: COLORS.textPrimary,
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  cardFormat: {
    ...FONT.regular,
    fontSize: FONT.size.caption1,
    color: COLORS.textTertiary,
    marginTop: SPACING.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  actions: {
    position: 'absolute',
    right: SPACING.screenPadding,
    bottom: 120,
    alignItems: 'center',
    gap: SPACING.lg,
  },
  actionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.bgElevated,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.separator,
  },
  actionButtonHearted: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accent,
  },
  heartIcon: {
    fontSize: 24,
    color: COLORS.accent,
  },
  heartIconActive: {
    fontSize: 26,
  },
  shareIcon: {
    fontSize: 22,
    color: COLORS.share,
  },
  loadingFooter: {
    width: SCREEN_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...FONT.regular,
    fontSize: FONT.size.footnote,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
  },
});
