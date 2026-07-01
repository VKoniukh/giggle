# GIGGLE — Development Master Index

> **Ціль:** Перетворити архітектурне бачення з `docs/` у працюючий MVP.
> Кожен файл у `development/` має прямий зв'язок із документацією в `docs/`.
> Нічого не реалізується без трасування до джерела.

---

## Структура development/

```
development/
├── 00_DEVELOPMENT_INDEX.md              ← ЦЕЙ ФАЙЛ
├── 01_DATABASE_PLAN.md                  ← план міграцій, RLS, Views
├── 02_EDGE_FUNCTIONS_PLAN.md            ← архітектура edge functions, prompt caching
├── 03_MOBILE_APP_PLAN.md                ← структура мобільного додатку
├── 04_ONBOARDING_PLAN.md                ← логіка калібрування і збору даних
├── 05_CORE_LOOP_PLAN.md                 ← card selection, breathing, metrics
└── 06_OBSERVABILITY_PLAN.md             ← unit economics, quality dashboard
```

---

## Трасування до docs/

| Development Phase | Первинне джерело в docs/ |
|---|---|
| `01_DATABASE_PLAN` | [05_DATA_ARCHITECTURE.md](../docs/05_DATA_ARCHITECTURE.md) — таблиці, JSONB контракти, views |
| `02_EDGE_FUNCTIONS_PLAN` | [06_EDGE_FUNCTIONS_AND_AI.md](../docs/06_EDGE_FUNCTIONS_AND_AI.md) — 4 endpoints, prompt architecture |
| `03_MOBILE_APP_PLAN` | [03_PRODUCT_SYSTEM.md](../docs/03_PRODUCT_SYSTEM.md) — signals, feed, canon |
| `04_ONBOARDING_PLAN` | [03_PRODUCT_SYSTEM.md](../docs/03_PRODUCT_SYSTEM.md) — onboarding flow |
| `05_CORE_LOOP_PLAN` | [04_ORCHESTRATION.md](../docs/04_ORCHESTRATION.md) — 9 operations, 4 loops, hard constraints |
| `06_OBSERVABILITY_PLAN` | [04_ORCHESTRATION.md](../docs/04_ORCHESTRATION.md) + [05_DATA_ARCHITECTURE.md](../docs/05_DATA_ARCHITECTURE.md) — quality dashboard, unit economics |

### Cross-cutting principles (застосовуються скрізь)
- [01_VISION_AND_PHILOSOPHY.md](../docs/01_VISION_AND_PHILOSOPHY.md)
- [02_LAUGH_TOPOLOGY.md](../docs/02_LAUGH_TOPOLOGY.md)
- [00_MASTER_INDEX.md](../docs/00_MASTER_INDEX.md) — ключові принципи

---

## AI Model Strategy

### Вибір моделей (на основі аналізу поточного ринку)

| Роль | Модель | Input/1M | Output/1M | Обґрунтування |
|------|--------|----------|-----------|---------------|
| **Composer** (часто, 5-8 кандидатів) | `gpt-4.1-mini` → fallback `gpt-5.4-mini` | $0.40 → $0.75 | $1.60 → $4.50 | Творча генерація тексту. Частіша операція, тому cost-efficiency критична. Structured outputs підтримуються |
| **Reflector** (рідко, висока точність) | `gpt-4.1` → fallback `gpt-5.4` | $2.00 → $2.50 | $8.00 → $15.00 | Семантичний аналіз ниток. Потрібна висока якість reasoning. Рідша операція — дорожча модель виправдана |
| **Strategic Reflector** (дуже рідко) | Та сама що Reflector | — | — | Раз на 3+ сесії, дорожча модель ок |
| **Distill Quality** (рідко) | Та сама що Composer | — | — | Очистка рецептів — творча задача |

### Prompt Caching стратегія
Порядок у промпті критичний для кешування:
```
[A] Product Constitution    ─┐
[B] Mode Contract           │ STATIC PREFIX → кешується (75-90% знижка)
[C] Quality Constitution    │
[D] Static Exemplars        ─┘
[E] Dynamic User Packet      → VARIABLE SUFFIX → повна ціна
```

### Приблизний Unit Economics (MVP estimate)
```
1 composition call  = ~2K input + ~1.5K output = ~$0.003 (mini)
1 reflection call   = ~3K input + ~1K output   = ~$0.014 (full)
1 session (~25 cards) ≈ 3 compose + 2 reflect  = ~$0.037/session
1.5 sessions/day × 30 = ~$1.67/MAU
```

> **Модель є конфігурацією, не хардкодом.** В `constants.ts` зберігаємо `MODEL_COMPOSE` і `MODEL_REFLECT` як env variables.

---

## Технічний стек (підтверджений)

### Backend: Supabase
- **Postgres** — єдине джерело істини
- **Auth** — email/password + Google + Apple (з референсу)
- **Edge Functions** (Deno) — 4 endpoints
- **EdgeRuntime.waitUntil()** — підтримується! Background processing до 150s (free) / 400s (paid)
- **Supabase Cron** — для pickup завислих ai_runs
- **RLS** — Row Level Security на всіх таблицях

### Mobile: Expo React Native (з референсу)
- **Expo SDK ~54** / React Native 0.81+
- **Expo Router ~6** (file-based routing)
- **Zustand** — state management
- **@supabase/supabase-js** — DB + Auth client
- **React Query** — server state
- **EAS Build** — TestFlight / production builds

### AI: OpenAI
- **Structured Outputs** — strict JSON schemas
- **Prompt Caching** — static prefix strategy

---

## Мова як параметр

Мова контенту = параметр користувача, збирається на onboarding:
- `user_minds.language_state.primary` — основна мова генерації
- `user_minds.language_state.cultural_context` — культурний код (UA, PL, US тощо)
- Система генерує контент мовою яку обрав користувач
- AI адаптує не тільки мову, а й **тембр, ритм, рівень** під те що лайкає людина

---

## Порядок виконання

```
Phase 1: Database        → SQL міграції реалізуються у `supabase/migrations/`
Phase 2: Edge Functions  → Код розгортається у `supabase/functions/`
Phase 3: Mobile App      → Expo проект в корені (або `mobile/`)
Phase 4: Onboarding      → Специфічні екрани та логіка у мобільному додатку
Phase 5: Core Loop       → Відточення скорингу карток та ритму у функціях та додатку
Phase 6: Observability   → Views у `supabase/migrations/` та дашборд
```

> **Кожен `PLAN.md` файл — це точна специфікація імплементації, прив'язана до ідей з `docs/`**
