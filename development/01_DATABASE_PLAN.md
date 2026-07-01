# Phase 1 — Database Migrations

> **Source of truth:** [docs/05_DATA_ARCHITECTURE.md](../docs/05_DATA_ARCHITECTURE.md)
> **Також:** [docs/04_ORCHESTRATION.md](../docs/04_ORCHESTRATION.md) — SQL views для quality dashboard

---

## Як деплоїти

Supabase CLI наразі не підключений. Всі міграції виконуються **мануально**:

1. Відкрий Supabase Dashboard → **SQL Editor**
2. Копіюй вміст SQL файлу
3. Натисни **Run**
4. Перевір у **Table Editor**, що таблиці створились

### Порядок виконання (КРИТИЧНИЙ — є foreign keys!)

| # | Файл | Що створює | Залежить від |
|---|------|-----------|-------------|
| 1 | `000_init_tables.sql` | 7 таблиць + indexes + constraints + trigger | `auth.users` (вже існує в Supabase) |
| 2 | `001_views.sql` | 3 аналітичні views | Всі 7 таблиць |
| 3 | `002_rls_policies.sql` | Row Level Security policies | Всі 7 таблиць |

---

## Версіонування міграцій

Кожен SQL файл починається з коментаря:

```sql
-- Migration: 000_init_tables
-- Version: 1.0.0
-- Date: 2026-06-23
-- Source: docs/05_DATA_ARCHITECTURE.md
-- Description: Creates all 7 core tables
```

### Правила версіонування:
- **Нова таблиця/view** → новий файл `003_xxx.sql`
- **Зміна існуючої таблиці** → новий файл `004_alter_xxx.sql` (ALTER TABLE, не перезапис)
- **НІКОЛИ** не редагуємо вже виконані міграції
- Якщо допустив помилку → створюємо `005_fix_xxx.sql`

---

## Що покриває кожен файл

### `000_init_tables.sql`
7 таблиць з повною структурою з документації:
- `user_minds` — стратегічний стан користувача (Layer 4, §1)
- `sessions` — ритм сесії (Layer 4, §2)
- `threads` — живі семантичні нитки (Layer 4, §3) ← **серце пам'яті**
- `cards` — матеріалізовані експерименти (Layer 4, §4)
- `events` — незмінний журнал реакцій (Layer 4, §5) ← **immutable!**
- `ai_runs` — lineage, audit, queue (Layer 4, §6)
- `quality_recipes` — колективний фонд (Layer 4, §7)

**Плюс:**
- CHECK constraints для всіх enum полів
- Indexes по user_id, status, session_id, created_at
- `updated_at` trigger function
- Foreign keys зі збереженням referential integrity

### `001_views.sql`
- `user_algorithm_health` — 5 метрик з Orchestration doc (§ System Quality Dashboard)
- `cost_breakdown_by_operation` — витрати по типу операції (Data Architecture, § Token Economics)
- `user_unit_economics` — cost per card shown, per session, per active day

### `002_rls_policies.sql`
- Кожна user-specific таблиця: `SELECT/INSERT/UPDATE` тільки для `auth.uid() = user_id`
- `quality_recipes`: read-only для автентифікованих (колективний фонд)
- `ai_runs`: доступ через service role (Edge Functions)

---

## Валідація після деплою

- [ ] Всі 7 таблиць видимі в Table Editor
- [ ] Enum CHECK constraints працюють (спробуй вставити невалідний status)
- [ ] Views `user_algorithm_health`, `cost_breakdown_by_operation`, `user_unit_economics` створені
- [ ] RLS увімкнений на всіх таблицях (іконка 🔒 в Table Editor)
- [ ] Foreign keys працюють (спробуй вставити card з неіснуючим user_id)

---

## Трасування до документації

| Таблиця | docs/ секція | Ключові JSONB контракти |
|---------|-------------|----------------------|
| `user_minds` | 05, §1 | `onboarding_context`, `boundaries`, `language_state`, `known_anti_patterns`, `unexplored_frontiers` |
| `sessions` | 05, §2 | `rhythm_state` (recent_moves, novelty_debt, risk_budget, temperature) |
| `threads` | 05, §3 | `emotional_payoffs`, `working_voices`, `confirmed_contexts`, `contexts_to_try`, `avoid`, `positive_evidence`, `counter_evidence` |
| `cards` | 05, §4 | `recipe`, `expected_learning`, `source_thread_versions` |
| `events` | 05, §5 | `signal_vector`, `metadata` |
| `ai_runs` | 05, §6 | `input_snapshot`, `expected_versions`, `output` |
| `quality_recipes` | 05, §7 | `recipe` |
