# Layer 4 — Data Architecture: Tables, State & Lineage

> Цей документ містить повні SQL-схеми 7 таблиць, JSONB-контракти, state/thread versioning і модель lineage. Це **мінімальна пам'ять живої системи** — не enterprise, але й не blob, з якого через місяць неможливо зрозуміти, чому система прийняла рішення.

---

## Чому 7 таблиць, не 3 і не 20

Ранній MVP-варіант із 3 таблицями (`user_state jsonb`, `cards`, `events`) — елегантний, але небезпечний:
- `user_state` blob швидко стає непрозорим
- неможливо відстежити lineage AI рішень
- нитки (threads) — головний живий об'єкт, заслуговують окремої таблиці

Фінальний MVP-каркас:

```
user_minds        — стиснутий стратегічний стан
sessions          — ритм поточної сесії
threads           — живі семантичні нитки (серце пам'яті)
cards             — тексти як матеріалізовані експерименти
events            — сирі реакції, immutable
ai_runs           — lineage, prompt version, input/output
quality_recipes   — колективний фонд (можна пізніше, але модель тримати з дня 1)
```

---

## 1. `user_minds` — Стратегічний стан

Наше компактне бачення на користувача. Не повна пам'ять — **стиснута карта для retrieval**.

```sql
CREATE TABLE user_minds (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id),

  -- Onboarding & boundaries
  onboarding_context   jsonb NOT NULL DEFAULT '{}',
  boundaries           jsonb NOT NULL DEFAULT '{}',
  language_state       jsonb NOT NULL DEFAULT '{}',

  -- Strategic memory
  strategic_summary    text,
  known_anti_patterns  jsonb NOT NULL DEFAULT '[]',
  unexplored_frontiers jsonb NOT NULL DEFAULT '[]',

  -- Versioning
  profile_version      bigint NOT NULL DEFAULT 1,
  last_reflection_at           timestamptz,
  last_strategic_reflection_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
```

### JSONB контракти

**`onboarding_context`:**
```json
{
  "familiar_worlds": ["software_engineering", "migration", "relationships"],
  "language": "uk",
  "life_context_hints": ["backend_developer", "lives_abroad"]
}
```

**`boundaries`:**
```json
{
  "allowed": ["profanity", "dark_humor", "absurd"],
  "restricted": ["politics", "religion"],
  "forbidden": []
}
```

**`strategic_summary`** (natural language, written by Strategic Reflector):
```
"The user responds to dry recognition and formal language accidentally
 exposing private disorder. Evidence currently comes mostly from
 professional contexts; transferability remains uncertain."
```

**`known_anti_patterns`:**
```json
[
  "generic programmer jokes",
  "obvious puns",
  "explaining the punchline",
  "repeated burnout vocabulary"
]
```

**`unexplored_frontiers`:**
```json
[
  "tender human imperfection",
  "linguistic literalism",
  "family ritual absurdity"
]
```

---

## 2. `sessions` — Ритм сесії

Сесія — окрема сутність, бо саме вона несе **драматургію**.

```sql
CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES user_minds(user_id),

  status          text NOT NULL DEFAULT 'active',
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,

  -- Rhythm tracking
  rhythm_state    jsonb NOT NULL DEFAULT '{}',
  cards_shown     int NOT NULL DEFAULT 0,
  strong_signals  int NOT NULL DEFAULT 0,
  cards_since_reflection int NOT NULL DEFAULT 0,

  session_version bigint NOT NULL DEFAULT 1
);
```

### `rhythm_state` контракт

```json
{
  "recent_moves": ["probe", "deepen", "transfer", "wildcard"],
  "recent_thread_ids": ["thread_a", "thread_a", "thread_b"],
  "current_temperature": 0.55,
  "novelty_debt": 0.68,
  "risk_budget": 0.45,
  "intensity": 0.5,
  "formats_recently_used": ["two_line_observation", "dialogue", "fake_notification"],
  "threads_to_rest": ["thread_a"]
}
```

> **`novelty_debt`** — зростає при використанні знайомих ниток/голосів/конструкцій. Навіть якщо картки працюють, система накопичує обов'язок **відійти й здивувати**.

---

## 3. `threads` — Серце пам'яті

Живі семантичні нитки. Кожна — **робоча гіпотеза**, не істина.

```sql
CREATE TABLE threads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES user_minds(user_id),

  -- Semantic content (AI-authored, natural language)
  core               text NOT NULL,
  mechanism          text NOT NULL,
  emotional_payoffs  jsonb NOT NULL DEFAULT '[]',
  working_voices     jsonb NOT NULL DEFAULT '[]',
  confirmed_contexts jsonb NOT NULL DEFAULT '[]',
  contexts_to_try    jsonb NOT NULL DEFAULT '[]',
  avoid              jsonb NOT NULL DEFAULT '[]',
  open_question      text,

  -- Epistemic state
  confidence         numeric NOT NULL DEFAULT 0.3,
  heat               numeric NOT NULL DEFAULT 0.5,
  fatigue            numeric NOT NULL DEFAULT 0.0,
  depth              int NOT NULL DEFAULT 1,

  -- Evidence
  positive_evidence  jsonb NOT NULL DEFAULT '[]',
  counter_evidence   jsonb NOT NULL DEFAULT '[]',

  -- Lifecycle
  status             text NOT NULL DEFAULT 'candidate',
  version            bigint NOT NULL DEFAULT 1,
  last_used_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

### Thread статуси

```
candidate  — нова гіпотеза, потребує перевірки
active     — підтверджена, використовується
resting    — fatigue високий, відпочиває для callback
dormant    — давно не використовувалась
retired    — спростовано або юзер переріс
```

### Приклад повної нитки

```json
{
  "core": "The obligation to perform competence inside systems nobody truly controls",
  "mechanism": "Formal professional language accidentally reveals private human collapse",
  "emotional_payoffs": ["recognition", "relief", "quiet_rebellion"],
  "working_voices": ["dry_insider", "calm_bureaucrat"],
  "confirmed_contexts": ["daily standup", "performance review"],
  "contexts_to_try": ["production incident", "therapy", "relationships"],
  "avoid": ["generic programmer jokes", "obvious tech puns"],
  "open_question": "Is the user responding to the professional context itself, or to formal systems measuring living human disorder?",
  "confidence": 0.64,
  "heat": 0.79,
  "fatigue": 0.36,
  "depth": 3,
  "positive_evidence": ["card_17", "card_31"],
  "counter_evidence": ["card_42"]
}
```

---

## 4. `cards` — Матеріалізовані експерименти

Не просто тексти — кожна картка знає, **яку гіпотезу вона тестує** і **що різні реакції означатимуть**.

```sql
CREATE TABLE cards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid REFERENCES user_minds(user_id),
  session_id             uuid REFERENCES sessions(id),

  -- Content
  text                   text NOT NULL,
  language               text NOT NULL DEFAULT 'uk',
  format                 text,
  move                   text NOT NULL,

  -- Semantic experiment
  recipe                 jsonb NOT NULL DEFAULT '{}',
  hypothesis_tested      text,
  expected_learning      jsonb,

  -- Lineage
  source_thread_ids      uuid[],
  source_thread_versions jsonb,
  parent_card_ids        uuid[],
  generated_by_run_id    uuid REFERENCES ai_runs(id),

  -- Lifecycle
  status                 text NOT NULL DEFAULT 'candidate',
  queue_priority         numeric NOT NULL DEFAULT 0.5,
  scope                  text NOT NULL DEFAULT 'personal',
  quality_state          text,

  shown_at               timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
```

### `move` enum

```
probe, deepen, mutate, transfer, bridge, contrast, callback, wildcard, rest_card
```

### `status` enum

```
candidate → queued → shown → (discarded | hearted)
```

> `hearted` = користувач натиснув ❤️, картка автоматично в Personal Canon.

### `scope` enum

```
personal         — для цього користувача
reusable_exact   — можна показати іншим as-is
reusable_recipe  — механізм переносний, текст ні
global_probe     — діагностична картка для cold start
```

### `recipe` контракт

```json
{
  "reality": "production incident",
  "charged_tension": "performing control while system exposes collective helplessness",
  "transformation": "incident-management language becomes an accidental confession",
  "voice": "calm incident commander",
  "emotional_fuel": ["recognition", "relief"],
  "distance": "self-inclusive, non-hostile",
  "format": "fake status update",
  "novelty_axis": "new context, established mechanism",
  "semantic_distance": 0.34
}
```

### `expected_learning` контракт

```json
{
  "if_heart": "professional ritual is probably part of the resonance",
  "if_stop_without_heart": "context is relevant but voice or compression may be wrong",
  "if_fast_skip": "do not infer immediately; combine with nearby evidence"
}
```

> [!NOTE]
> `source_thread_versions` дозволяє granular staleness check — картка стає stale лише якщо змінилася **саме її** вихідна нитка, а не будь-яка.

---

## 5. `events` — Незмінний журнал реальності

```sql
CREATE TABLE events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES user_minds(user_id),
  session_id          uuid NOT NULL REFERENCES sessions(id),
  card_id             uuid NOT NULL REFERENCES cards(id),

  event_type          text NOT NULL,

  dwell_ms            int,
  estimated_read_ratio numeric,
  position            int,

  signal_vector       jsonb,
  metadata            jsonb,

  created_at          timestamptz NOT NULL DEFAULT now()
);
```

### `event_type` enum

```
impression, stop, skip, heart, share, back
```

### `signal_vector` контракт

```json
{
  "attention": 0.87,
  "mirth": 1.0,
  "identity_resonance": 0.25,
  "social_utility": 0.0,
  "rejection": 0.0,
  "slow_burn_probability": 0.15
}
```

> [!CAUTION]
> **Events НІКОЛИ не редагуються AI.** Це фактичний шар, від якого можна перебудувати всі інтерпретації коли prompts або моделі зміняться.

---

## 6. `ai_runs` — Lineage, Audit & Queue

Одночасно: durable queue, audit log, retries, trace семантичних рішень.

```sql
CREATE TABLE ai_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES user_minds(user_id),
  session_id         uuid REFERENCES sessions(id),

  run_type           text NOT NULL,
  status             text NOT NULL DEFAULT 'queued',
  trigger_reason     text,

  input_snapshot     jsonb,
  expected_versions  jsonb,
  output             jsonb,

  model              text,
  prompt_version     text,
  schema_version     text,

  input_tokens       int,
  output_tokens      int,
  cached_tokens      int,
  estimated_cost     numeric,

  attempts           int NOT NULL DEFAULT 0,
  next_retry_at      timestamptz,

  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

### `run_type` enum

```
cold_start_compose
reflect
compose
strategic_reflect
distill_quality
```

### `status` enum

```
queued → running → completed | failed | conflict
```

> [!TIP]
> Без цієї таблиці через місяць не відповіси: "Чому система вирішила, що користувач любить принизливий гумор?" З нею — бачиш повний ланцюг: input evidence → prompt version → model output → accepted patch → generated cards → subsequent reactions.

---

## 7. `quality_recipes` — Колективний фонд

Колективний фонд відділений від персональних карток.

```sql
CREATE TABLE quality_recipes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  recipe              jsonb NOT NULL,
  diagnostic_purpose  text,

  source_card_id      uuid REFERENCES cards(id),
  source_run_id       uuid REFERENCES ai_runs(id),

  privacy_state       text NOT NULL DEFAULT 'clean',
  language            text NOT NULL DEFAULT 'uk',

  usage_count         int NOT NULL DEFAULT 0,
  strong_hit_count    int NOT NULL DEFAULT 0,
  weak_hit_count      int NOT NULL DEFAULT 0,

  prior_strength      numeric NOT NULL DEFAULT 0.5,
  semantic_embedding  vector,  -- pgvector, додати пізніше

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

> [!NOTE]
> **Відповідь на роздум щодо очищення фактури:**
> Ми справді можемо і будемо зберігати вдалі тексти без змін (як `scope = reusable_exact`), адже ультраприватних даних ми не збираємо. Але механізм очищення до "рецепту" (`scope = reusable_recipe`) потрібен з іншої причини! **Гіперспецифічний текст (наприклад, внутрішній жарт про конкретного менеджера або специфічний проєкт) просто не буде смішним для іншої людини, яка не знає контексту.** Ми очищаємо фактуру, щоб відділити *універсальний механізм резонансу* від *локальної оболонки*, і так зробити Quality Fund ефективним для всіх.

---

## State Versioning — як не втрачати живість

### Глобальний version недостатньо

Версіонування по `user_state.profile_version` — занадто грубо. Користувач міг дати сигнал щодо нитки про стосунки, але wildcard-картка про мовний абсурд усе ще валідна.

### Thread-level versioning

Кожна картка пам'ятає:

```json
{
  "source_thread_versions": {
    "thread_01": 4,
    "thread_07": 2
  }
}
```

Картка стає **stale** лише коли:
1. Змінилася саме **її** вихідна нитка
2. Новий сигнал **суперечить** її гіпотезі
3. Session rhythm зробив її **недоречною**
4. Стала надто **схожою** на щойно показаний текст

### Optimistic locking для AI patches

```sql
UPDATE threads
SET confidence = LEAST(confidence + 0.08, 1),
    version = version + 1,
    updated_at = now()
WHERE id = 'thread_01'
  AND version = 4;  -- expected_version
```

Якщо thread уже має version 5 → patch не застосовується → job позначається `conflict` → може бути переобчислений.

---

## Lineage Model

```
                    ┌─ ai_runs ─────────────────┐
                    │  input_snapshot            │
                    │  expected_versions         │
                    │  output (patches + cards)  │
                    │  model, prompt_version     │
                    └───────┬───────────────────┘
                            │ generates
                    ┌───────▼───────┐
    ┌───────────┐   │    cards      │   ┌──────────┐
    │  threads  │◄──│ source_thread │──►│  events  │
    │ (version) │   │ _ids/versions │   │(immutable)│
    └───────────┘   │ parent_card_  │   └──────────┘
                    │ ids           │
                    │ generated_by_ │
                    │ run_id        │
                    └───────────────┘
```

> **Moat = lineage.** Не в кількості текстів і не в моделі. А в пам'яті про те, як із реакцій конкретної людини поступово народилася її власна комедійна реальність.

## Облік Токенів та Unit Economics

> [!IMPORTANT]
> Ми не будуємо billing system. Ми будуємо **інструмент для однієї відповіді:** скільки коштує зробити одного користувача щасливим один день? Без цього числа неможливо вибрати між підпискою, рекламою чи freemium.

### Фундаментальна одиниця: Cost per Card Shown

Все зводиться до одного числа. Не cost per AI call (бо один call генерує 3–5 карток, а деякі з них discarded). Не cost per session (бо сесії різної довжини). А:

```
Cost per Card Shown = Сума estimated_cost усіх ai_runs / Кількість cards зі status 'shown' або 'hearted'
```

Звідси виростає вся економіка:

```
Cost per Card Shown                              → $0.003 (приклад)
  × Avg Cards per Session (~25)                  → $0.075 per session
  × Avg Sessions per Day (~1.5)                  → $0.11 per DAU
  × 30 days                                      → $3.38 per MAU
  → Підписка має бути > $3.38 або реклама покривати цю суму
```

### Як зберігати (вже закладено в `ai_runs`)

Поля `input_tokens`, `output_tokens`, `cached_tokens` та `estimated_cost` записуються в `ai_runs` **при завершенні кожного AI-виклику**. OpenAI повертає `usage` об'єкт у відповіді — ми просто зберігаємо його.

> [!TIP]
> **`estimated_cost` рахувати на момент запису**, а не пізніше. Формула проста: `(input_tokens × input_price + output_tokens × output_price) / 1_000_000`. Ціни можна тримати як конфіг в Edge Function. Якщо ціни зміняться — старі записи зберігають історичну вартість, нові — нову.

### SQL View: поопераційна розбивка

```sql
CREATE VIEW cost_breakdown_by_operation AS
SELECT
  user_id,
  run_type,
  date_trunc('day', completed_at) AS usage_date,
  COUNT(*)                        AS operations,
  SUM(input_tokens)               AS input_tokens,
  SUM(output_tokens)              AS output_tokens,
  SUM(cached_tokens)              AS cached_tokens,
  SUM(estimated_cost)             AS cost_usd
FROM ai_runs
WHERE status = 'completed'
GROUP BY user_id, run_type, date_trunc('day', completed_at);
```

**Що це дає:** одним запитом бачимо, скільки коштує `compose` vs `reflect` vs `strategic_reflect` для конкретного юзера за конкретний день. Якщо `reflect` з'їдає 60% бюджету — рефлексія занадто часта або промпт переускладнений.

### SQL View: unit economics per user

```sql
CREATE VIEW user_unit_economics AS
SELECT
  ar.user_id,
  COUNT(DISTINCT ar.id)                          AS total_ai_calls,
  SUM(ar.estimated_cost)                         AS total_cost_usd,
  COUNT(DISTINCT c.id) FILTER (
    WHERE c.status IN ('shown', 'hearted')
  )                                               AS cards_shown,
  ROUND(
    SUM(ar.estimated_cost)
    / NULLIF(COUNT(DISTINCT c.id) FILTER (
        WHERE c.status IN ('shown', 'hearted')
      ), 0), 5
  )                                               AS cost_per_card_shown,
  COUNT(DISTINCT s.id)                            AS total_sessions,
  ROUND(
    SUM(ar.estimated_cost)
    / NULLIF(COUNT(DISTINCT s.id), 0), 4
  )                                               AS cost_per_session,
  ROUND(
    SUM(ar.estimated_cost)
    / NULLIF(COUNT(DISTINCT date_trunc('day', s.started_at)), 0), 4
  )                                               AS cost_per_active_day
FROM ai_runs ar
LEFT JOIN cards c ON c.user_id = ar.user_id
LEFT JOIN sessions s ON s.user_id = ar.user_id
WHERE ar.status = 'completed'
GROUP BY ar.user_id;
```

### Як читати результати

```
SELECT * FROM user_unit_economics WHERE user_id = '...';

→ cost_per_card_shown:  $0.0031
→ cost_per_session:     $0.072
→ cost_per_active_day:  $0.108
→ total_ai_calls:       47
→ cards_shown:          134
```

**Ключові рішення, які звідси випливають:**

| Питання | Де відповідь |
|---------|--------------|
| Скільки коштує підписка? | `cost_per_active_day × 30 × markup` |
| Яка операція найдорожча? | `cost_breakdown_by_operation` → найбільший `cost_usd` по `run_type` |
| Чи виправдовує себе reflection? | Порівняти resonance_rate (з quality dashboard) до і після reflection runs |
| Скільки карток ми "викидаємо"? | `cards` зі status=discarded / total generated — waste rate |
| Чи cached_tokens реально економлять? | `cached_tokens / (input_tokens + cached_tokens)` — cache hit rate |
