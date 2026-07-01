# Phase 3 — Mobile App Foundation

> **Source of truth:** [docs/03_PRODUCT_SYSTEM.md](../docs/03_PRODUCT_SYSTEM.md) — signals, feed, canon
> **Reference app:** Life Pattern (rork-binary-heatmap-app) — stack, auth, Supabase integration

---

## Стек (з reference app, оновлений)

| Технологія | Версія | Навіщо |
|-----------|--------|--------|
| Expo SDK | ~54+ | Фреймворк |
| React Native | 0.81+ | UI |
| Expo Router | ~6 | File-based routing |
| Zustand | ^5 | State management (як в reference) |
| @supabase/supabase-js | ^2.94+ | DB + Auth client |
| React Query | ^5 | Server state, caching |
| Zod | ^4 | Validation (shared з Edge Functions) |
| expo-apple-authentication | ~8 | Apple Sign In |
| expo-haptics | ~15 | Тактильний фідбек на heart/share |
| expo-sharing | ~14 | Share функціонал |

---

## Архітектура (адаптована з reference)

```
app/
├── app/
│   ├── _layout.tsx                  ← Root Layout (auth orchestrator, як в reference)
│   ├── auth.tsx                     ← Auth screen
│   ├── (onboarding)/                ← Onboarding flow (Phase 4)
│   │   ├── _layout.tsx
│   │   ├── world.tsx
│   │   ├── permissions.tsx
│   │   └── probes.tsx → feed
│   ├── (tabs)/                      ← Main app
│   │   ├── _layout.tsx
│   │   ├── feed.tsx                 ← Головний екран — стрічка карток
│   │   ├── canon.tsx                ← Personal Canon
│   │   └── settings.tsx
│   └── settings/
│       ├── recalibrate.tsx          ← Перепройти onboarding (Steps 1-2)
│       └── about.tsx
├── src/
│   ├── components/
│   │   ├── Card.tsx                 ← Текстова картка
│   │   ├── FeedStack.tsx            ← Стек карток з вертикальним скролом
│   │   ├── HeartButton.tsx          ← ❤️ з haptic feedback
│   │   ├── ShareButton.tsx          ← ↗️
│   │   ├── LoadingShimmer.tsx       ← Loader коли frontier порожній
│   │   └── OnboardingTag.tsx        ← Tag для вибору світів/дозволів
│   ├── services/
│   │   ├── supabase.ts              ← Клієнт (як в reference)
│   │   └── api.ts                   ← Edge Functions calls
│   ├── store/
│   │   ├── authStore.ts             ← Auth state (як в reference)
│   │   ├── feedStore.ts             ← Feed state + prefetch buffer
│   │   ├── sessionStore.ts          ← Active session tracking
│   │   └── settingsStore.ts         ← User preferences
│   ├── hooks/
│   │   ├── useAuth.ts               ← Auth hooks
│   │   ├── useGoogleAuth.ts         ← Google OAuth (як в reference)
│   │   ├── useAppleAuth.ts          ← Apple Auth (як в reference)
│   │   ├── useFeed.ts               ← Feed logic + prefetch
│   │   ├── useSession.ts            ← Session lifecycle
│   │   └── useSignalCollector.ts    ← Implicit signals (dwell, scroll)
│   ├── types/
│   │   └── db.ts                    ← TypeScript types for all tables
│   ├── constants/
│   │   └── theme.ts                 ← Design tokens
│   └── utils/
│       └── signal.ts                ← Signal vector computation
```

---

## Ключові архітектурні рішення

### Auth (з reference app)
- `_layout.tsx` = **єдиний** `onAuthStateChange` listener (як в reference)
- Zustand authStore = dumb state holder (як в reference)
- Google + Apple sign in
- PKCE flow

### Feed UI
- Вертикальний стек карток (scroll down = next card)
- 2 кнопки: ❤️ Heart + ↗️ Share
- Haptic feedback на heart
- Implicit signals: dwell_ms вимірюється з моменту impression до наступної дії

### Signal Collection
```
impression → start timer
  user reads → dwell_ms accumulates
  user hearts → explicit 'heart' event + dwell_ms + estimated_read_ratio
  user scrolls past → implicit 'skip' event + dwell_ms
  user shares → explicit 'share' event
  user goes back → 'back' event (slow burn indicator)
```

### Prefetch Strategy
- Клієнт тримає 2-3 prefetched cards
- Після кожного `record-signal` отримує наступну ready card
- Якщо frontier порожній → показати LoadingShimmer (MVP — лоадер ОК)

---

## Трасування до документації

| UI компонент | docs/ секція |
|-------------|-------------|
| ❤️ Heart кнопка | 03, §Signal Semantics — "Це спрацювало" |
| ↗️ Share кнопка | 03, §Signal Semantics — "Соціальна функція" |
| Feed як stacked cards | 01, §Контрольований хаос — послідовність, не рандом |
| Personal Canon | 03, §Personal Canon — "не saved posts, а зростаюча колекція" |
| Implicit signals | 03, §Signal Semantics — dwell, fast skip, back/reread |
| Prefetch | 06, §next-card — "2-4 ready cards в буфері" |
| Loading state | 06, §next-card, Note — "для MVP нормально показати лоадер" |

---

## Валідація

- [ ] Auth працює (email + Google + Apple)
- [ ] Feed показує картки з backend
- [ ] ❤️ відправляє heart event через `record-signal`
- [ ] ↗️ відправляє share event через `record-signal`
- [ ] Implicit dwell_ms збирається коректно
- [ ] Prefetch працює — наступна картка підвантажується без затримки
- [ ] Personal Canon показує hearted cards
- [ ] Навігація: feed ↔ canon ↔ settings
