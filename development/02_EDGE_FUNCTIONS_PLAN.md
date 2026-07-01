# Phase 2 — Edge Functions & AI Contracts

> **Source of truth:** [docs/06_EDGE_FUNCTIONS_AND_AI.md](../docs/06_EDGE_FUNCTIONS_AND_AI.md)
> **Також:** [docs/04_ORCHESTRATION.md](../docs/04_ORCHESTRATION.md) — тактичні правила, hard constraints

---

## Як деплоїти

### Через Supabase Dashboard (поки немає CLI)

1. Dashboard → **Edge Functions** → **New Function**
2. Назва функції = назва папки (наприклад, `start-session`)
3. Вставити код з `index.ts`
4. Для shared код — вкласти в той самий файл (Supabase Dashboard не підтримує imports між файлами, тому при мануальному деплої потрібно bundlити)

### Через Supabase CLI (коли підключимо)

```bash
supabase functions deploy start-session
supabase functions deploy record-signal
supabase functions deploy next-card
supabase functions deploy ai-worker
```

### Environment Variables (обов'язково!)

В Dashboard → **Edge Functions** → **Secrets** додати:
- `OPENAI_API_KEY` — ключ OpenAI API
- `SUPABASE_SERVICE_ROLE_KEY` — service role для bypass RLS (вже існує в Supabase)

---

## 4 Edge Functions

| Функція | Викликає GPT? | Latency | Тригер |
|---------|--------------|---------|--------|
| `start-session` | Ні (але створює ai_run) | <100ms | Початок сесії |
| `record-signal` | Ні | <100ms | Кожна реакція (heart/skip/share) |
| `next-card` | Ні | <50ms | Запит наступної картки |
| `ai-worker` | **ТАК** | 2-15s | Background via `waitUntil()` або Cron |

### Background Processing Architecture

```
record-signal відповідає користувачу за <100ms
  └── EdgeRuntime.waitUntil() запускає ai-worker паралельно
      └── ai_runs таблиця = durable queue на випадок timeout
          └── Supabase Cron (раз на хвилину) піднімає завислі jobs
```

**Чому не просто `waitUntil()`?**
- `waitUntil()` має ліміт 150s (free) / 400s (paid)
- Якщо Edge Function crashed → job втрачений
- `ai_runs` як durable queue = надійний fallback
- Supabase Cron = простий pickup: `SELECT * FROM ai_runs WHERE status = 'queued' AND created_at < now() - interval '1 minute'`

---

## Shared Code (_shared/)

### `constants.ts` — тактичні магічні числа

Всі числа з [docs/06_EDGE_FUNCTIONS_AND_AI.md](../docs/06_EDGE_FUNCTIONS_AND_AI.md):

```
HEAT_DELTA_HEART = 0.10
FATIGUE_DELTA_HEART = 0.04
NOVELTY_DEBT_DELTA_HEART = 0.05
MIN_FRONTIER_SIZE = 3
MAX_SAME_THREAD_CONSECUTIVE = 2
MAX_SAME_FORMAT_IN_5 = 3
REFLECTION_TRIGGER_HEARTS_IN_5 = 2
REFLECTION_TRIGGER_CARDS_SINCE = 8
STRATEGIC_TRIGGER_SESSIONS = 3
STRATEGIC_TRIGGER_SHOWN = 50
STRATEGIC_TRIGGER_CANON = 5
```

### `prompts/` — 5-layer prompt architecture

Порядок критичний для кешування (статичний префікс → динамічний суфікс):

| Layer | Файл | Зміст | Кешується? |
|-------|------|-------|------------|
| A | `constitution.ts` | Product Constitution | ✅ Так |
| B | `mode-contracts.ts` | Reflector / Composer rules | ✅ Так (per mode) |
| C | `quality-constitution.ts` | Avoid/Prefer rules | ✅ Так |
| D | `static-exemplars.ts` | Contrastive examples | ✅ Так |
| E | `user-packet.ts` | Dynamic user context builder | ❌ Ні (unique per user) |

---

## Версіонування

Кожна функція містить `VERSION` константу:

```typescript
const FUNCTION_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1';
const SCHEMA_VERSION = 'v1';
```

Ці значення записуються в `ai_runs.prompt_version` і `ai_runs.schema_version` при кожному виклику. Це дозволяє:
- Відстежити які промпти генерували які картки
- Порівняти якість між версіями промптів
- Зрозуміти, коли зміна промпту покращила/погіршила resonance

---

## Трасування до документації

| Компонент | docs/ секція |
|-----------|-------------|
| `start-session` | 06, §1 — start-session |
| `record-signal` tactical reactions | 06, §2 — record-signal |
| `next-card` card selection formula | 06, §3 — next-card |
| `ai-worker` 4 modes | 06, §4 — ai-worker |
| Reflector contract | 06, §Reflector Contract |
| Composer contract | 06, §Composer Contract |
| 5-layer prompts | 06, §Prompt Architecture |
| Hard constraints | 04, §Hard Constraints |
| 9 operations | 04, §9 операцій оркестрації |
| Thread versioning | 05, §State Versioning |
| Cost control | 06, §Cost Control |
| Trigger conditions | 06, §Trigger Conditions |

---

## Валідація після деплою

- [ ] `start-session` створює session і повертає перші картки
- [ ] `record-signal` записує event за <100ms і повертає наступну картку
- [ ] `record-signal` коректно оновлює heat/fatigue/novelty_debt
- [ ] `next-card` обирає картку за score formula, не порушує hard constraints
- [ ] `ai-worker` в режимі COMPOSE генерує валідні structured outputs
- [ ] `ai-worker` в режимі REFLECT оновлює threads через optimistic locking
- [ ] Token usage записується в `ai_runs` (input_tokens, output_tokens, estimated_cost)
- [ ] `waitUntil()` працює — ai-worker запускається у background
- [ ] OPENAI_API_KEY доступний через `Deno.env.get('OPENAI_API_KEY')`
