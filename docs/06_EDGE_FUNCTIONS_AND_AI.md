# Layer 5 — Edge Functions & AI Contracts

> Цей документ описує 4 Edge Functions, prompt-архітектуру з 5 шарами, Reflector/Composer contracts з різними правами, structured output schemas, cost control і trigger conditions. Це операційний шар — **як саме код і AI взаємодіють**.

---

## Архітектурний принцип

> **GPT не повинен одночасно інтерпретувати користувача, змінювати його пам'ять, вирішувати ритм стрічки й писати тексти.**

Потрібно розділити **права**, не будувати агентів:

```
Механічний оркестратор  → вирішує КОЛИ й ЯКИЙ тип руху потрібен
Reflector               → має право лише ЗАПРОПОНУВАТИ зміни до розуміння
Composer                → має право лише МАТЕРІАЛІЗУВАТИ задані гіпотези в тексти
Postgres                → єдина пам'ять і джерело істини
Жоден свайп             → не чекає GPT
```

---

## 4 Edge Functions

### 1. `start-session`

Викликається на початку сесії.

```
1. Створити запис у sessions
2. Обрати 2–4 готових diagnostic cards із quality_recipes
3. Поставити їх у frontier (cards зі status=queued)
4. Створити cold_start_compose ai_run
5. Повернути перші картки НЕГАЙНО
```

Користувач після onboarding **не чекає генерацію**. Перші ready probes підбираються за:
- мовою
- дозволеними межами
- знайомими світами
- максимальною діагностичною різницею

```
Приклад першої серії:
recognition + dry voice
absurdity + unresolved incongruity
tender imperfection
social catastrophe
linguistic literalism
```

---

### 2. `record-signal`

Головна fast-loop function. **Не викликає GPT.**

```
1. Записати immutable event
2. Обчислити signal_vector
3. Виконати bounded tactical update:
   ├── thread heat / fatigue adjustments
   ├── session rhythm updates
   └── novelty_debt recalculation
4. Оновити session rhythm_state
5. За потреби створити reflect / compose ai_run
6. Вибрати наступну ready card (same logic as next-card)
7. Повернути наступну картку
```

### Тактичні реакції

**Після `heart` (❤️):**
```
thread.heat     += 0.10
thread.fatigue  += 0.04
session.strong_signals += 1
session.novelty_debt   += 0.05
card.status = 'hearted'              — auto-save to Personal Canon
card.quality_state = 'canon_candidate'
schedule reflection if 2+ hearts in last 5 cards
avoid near-copy generation
```

**Після `share` (↗️):**
```
social_utility signal registered
schedule reflection
do NOT automatically increase comic confidence same as heart
```

**Після fast skip:**
```
small local penalty
no immediate thread destruction
increase penalty only after repeated related skips
```

> [!IMPORTANT]
> Механіка **не повинна** сама піднімати `thread.confidence` із 0.4 до 0.8. Вона оновлює heat/fatigue і накопичує докази. Семантичну впевненість переглядає Reflector.

---

### 3. `next-card`

Може бути окремою або частиною `record-signal`. **Не викликає GPT.**

```
1. Заблокувати сесію на коротку транзакцію
2. Знайти найкращу queued card
3. Перевірити thread versions (не stale?)
4. Перевірити session hard constraints
5. Позначити shown, встановити shown_at
6. Створити impression event
7. Якщо frontier < 3 → створити compose ai_run
> [!NOTE]
> **MVP Затримки (Loading):** Оскільки генерація (`compose`) запускається заздалегідь (коли у `frontier` залишається менше 3 карток), у більшості випадків наступна картка вже буде готова. Але для MVP **абсолютно нормально** показати лоадер, якщо користувач свайпає занадто швидко і черга пуста. Ми не ускладнюємо систему Fallback-механізмами на старті.
```

### Card Selection Formula

```
card_score =
    queue_priority
  + move_fit(current_session_need, card.move)
  + thread_heat(card.source_threads)
  + novelty_bonus(card.semantic_distance)
  + callback_readiness(card, session)
  - thread_fatigue(card.source_threads)
  - format_repetition(card.format, recent_formats)
  - voice_repetition(card.recipe.voice, recent_voices)
  - semantic_similarity_to_recent(card, last_3_shown)
```

### Hard Constraints (перед score)

```
✗ не більше 2 близьких карток однієї нитки
✗ не повторювати format 3 рази
✗ не показувати stale card
✗ не callback без достатньої паузи
✗ не high-risk card після boundary-negative signal
✓ обов'язково погашати novelty debt
```

> AI створює можливості, але **послідовність контролює продукт**.

---

### 4. `ai-worker`

**Єдина функція, яка викликає OpenAI API.**

Бере `ai_runs` зі статусом `queued` і працює в одному з режимів:

```
REFLECT             — аналіз сигналів, patch ниток
COMPOSE             — генерація карток по місіях
STRATEGIC_REFLECT   — довгострокова ревізія
DISTILL_QUALITY     — очистка рецептів для фонду
```

### Execution model

```
record-signal відповідає користувачу
  └── EdgeRuntime.waitUntil() паралельно запускає ai-worker
      └── ai_runs як durable queue на випадок timeout
          └── pg_cron раз на хвилину піднімає завислі jobs
```

---

## Reflector Contract

> **Reflector не пише жарти. Він дивиться на докази.**

### Input

```
active threads
thread open questions
last 8–15 shown cards + their recipes
raw event vectors
personal canon exemplars (3–6)
counterexamples
current session rhythm
```

### Output Schema

```json
{
  "observations": [
    {
      "claim": "string — семантичне твердження",
      "evidence_for": ["card_id"],
      "evidence_against": ["card_id"],
      "confidence": 0.67,
      "alternative_explanations": ["string"]
    }
  ],
  "thread_operations": [
    {
      "operation": "strengthen | weaken | split | merge | retire | create",
      "thread_id": "uuid | null",
      "expected_version": 4,
      "confidence_delta": 0.08,
      "patch": {},
      "evidence_card_ids": ["card_id"]
    }
  ],
  "session_adjustment": {
    "novelty_target": 0.72,
    "threads_to_rest": ["thread_id"],
    "avoid_next_moves": ["deepen"],
    "desired_temperature": 0.45
  },
  "compose_missions": [
    {
      "move": "transfer",
      "thread_ids": ["thread_01"],
      "purpose": "test whether mechanism survives outside work",
      "target_context": "relationships",
      "semantic_distance": 0.5
    }
  ]
}
```

### Reflector Rules

```
✓ Посилатися на конкретні card IDs
✓ Завжди називати альтернативне пояснення
✓ Шукати counterevidence
✓ Формулювати open question
✓ Розділяти тему, оператор, голос, emotional payoff

✗ НЕ ставити психологічних діагнозів
✗ НЕ перетворювати один hit на стабільну істину
✗ НЕ вигадувати insight без доказу
✗ НЕ генерувати user-facing тексти
```

---

## Composer Contract

> **Composer не змінює нитки. Він матеріалізує задані місії.**

### Input

```json
{
  "move": "transfer",
  "thread": {
    "core": "performing competence inside uncontrollable systems",
    "mechanism": "formal language accidentally exposes private disorder"
  },
  "target_context": "relationships",
  "constraints": {
    "voice": "dry participant",
    "emotional_fuel": "tender recognition",
    "avoid": ["therapy clichés", "burnout vocabulary", "direct explanation", "obvious punchline"]
  },
  "canon_exemplars": ["text_1", "text_2"],
  "recent_sequence": [{"move": "deepen", "voice": "dry_insider", "format": "two_line"}]
}
```

### Output Schema

```json
{
  "candidates": [
    {
      "text": "Сказав, що у стосунках усе стабільно.\nМи вже третій місяць стабільно уникаємо теми.",
      "move": "transfer",
      "source_thread_ids": ["thread_01"],
      "recipe": {
        "reality": "relationship status update",
        "charged_tension": "performing relational stability",
        "transformation": "stability vocabulary exposes avoidance",
        "voice": "dry participant",
        "emotional_fuel": ["recognition", "tender discomfort"],
        "distance": "self-inclusive",
        "format": "two_line_observation",
        "novelty_axis": "new context, established mechanism",
        "semantic_distance": 0.48
      },
      "hypothesis_tested": "formal stability language can expose relational avoidance",
      "expected_learning": {
        "if_heart": "mechanism transfers beyond professional contexts",
        "if_stop_without_heart": "context relevant but voice or compression off",
        "if_fast_skip": "weak signal, combine with nearby evidence"
      },
      "similarity_risk": 0.18
    }
  ]
}
```

### Composer Rules

```
✓ Кожен candidate тестує ОКРЕМУ гіпотезу
✓ Семантична компресія
✓ Точне впізнавання, не generic observations
✓ Fresh containers, psychologically correct distance

✗ НЕ модифікувати user model
✗ НЕ кілька surface variations одного жарту
✗ НЕ AI-sounding philosophical language
✗ НЕ explanatory punchlines
✗ НЕ merely inserting personal nouns
✗ НЕ copying previous syntax
```

---

## Prompt Architecture — 5 шарів

### A. Product Constitution (статична, для всіх)

```
You are part of a system that discovers how a particular person
enters mirth through text.

You are not recommending genres.
You are not creating a psychological diagnosis.
You are not maximizing similarity to previous winners.
A strong reaction opens a question and a branch; it does not
justify repetition.

Distinguish:
- charged reality
- comic transformation
- voice
- emotional fuel
- distance
- format
- contextual familiarity
- novelty

Treat every user model as a provisional hypothesis.
```

### B. Mode Contract

**Reflector:**
```
You may update hypotheses, uncertainty, open questions and recommended moves.
You may not generate user-facing texts.
Every claim must cite evidence IDs and include an alternative explanation.
```

**Composer:**
```
You may generate textual experiments from supplied missions.
You may not modify the user model.
Each candidate must test a distinct hypothesis.
Do not produce several surface variations of one joke.
```

### C. Quality Constitution

```
Avoid:
- generic observations
- AI-sounding philosophical language
- explanatory punchlines
- obvious wordplay
- merely inserting personal nouns
- copying previous syntax
- transforming specificity into stereotype

Prefer:
- semantic compression
- exact hidden recognition
- voice consistency
- fresh containers
- psychologically correct distance
- surprising but legible transformation
```

### D. Static Exemplars

Contrastive examples (не "20 гарних жартів"):

```
bad generic text          → why it is generic
good compressed text      → which mechanism makes it work
surface copy              → deep mutation
topic transfer            → mechanism transfer
```

### E. Dynamic User Packet (наприкінці)

```
active threads
session state
recent sequence (move, voice, format, temperature, distance, reaction)
canon (3–6 exemplars)
anti-patterns
current mission
```

> [!TIP]
> **Порядок критичний для кешування.** OpenAI prompt caching працює за точним збігом початкового префікса. Статичну constitution, schemas і exemplars (шари A-D) — на початку. Динамічний user packet (шар E) — наприкінці. Це знижує latency і вартість.

---

## Cost Control

```
next-card            → не викликає модель
record-signal        → не викликає модель (тактичний update)
1 composition call   → генерує 5–8 кандидатів, після відсіву 3–5 у frontier
reflection           → лише на значущому накопиченні
strategic reflection → раз на кілька сесій
```

### У prompt передається не вся історія, а:

```
активні нитки
кілька counterexamples
остання meaningful window (8–15 карток)
3–6 канонічних текстів
fatigue/novelty constraints
короткий strategic summary
```

> Історія з тисячі карток **не повинна** щоразу летіти в контекст.

### Дві якості викликів

```
дешевший composition  → частіше, менша модель допустима
сильніший reflection  → рідше, точність критична
```

На початку — одна модель у двох prompt modes. Архітектура не зміниться при розділенні.

---

## Trigger Conditions Summary

### Reflection Trigger

```
heart (кожен heart — сильний сигнал)
share
2 heart серед останніх 5 карток
6–8 карток після останньої reflection
суперечність між очікуваним і фактичним сигналом
session end
frontier planning inconsistent with current evidence
```

### Composition Trigger

```
ready frontier < 3
reflection created new compose missions
current queued cards became stale
session needs callback/wildcard not available
```

### Strategic Reflection Trigger

```
3 завершені сесії
30–50 показаних карток
5 нових canon cards
кілька ниток із семантичною близькістю
повернення після довгої перерви
```

### Strategic Reflection Rights

```
merge threads
split a vague thread
retire false hypotheses
wake dormant threads
compress strategic summary
identify shared mechanisms across domains
nominate quality recipes
```

---

## State Patch Application

AI patches застосовуються через **optimistic locking**:

```sql
UPDATE threads
SET confidence = LEAST(confidence + :delta, 1),
    version = version + 1,
    updated_at = now()
WHERE id = :thread_id
  AND version = :expected_version;
```

Якщо `affected_rows = 0` → patch **не застосовується** → ai_run status = `conflict` → може бути переобчислений з новим snapshot.

> Дві паралельні AI-відповіді **не переписують одна одну.**

---

## GPT повертає тільки Structured Output

```
Edge Function:
  1. збирає контекст
  2. викликає модель із strict JSON Schema
  3. отримує typed JSON
  4. валідовує versions
  5. застосовує дозволені операції транзакційно
```

> [!CAUTION]
> Модель **не повинна** мати tool для `update_thread`. Вона лише пропонує patch, а код вирішує, чи він допустимий.

---

## Фінальна форма системи

```
POSTGRES REMEMBERS
    raw events
    provisional threads
    session rhythm
    cards and lineage
    AI decisions and versions

EDGE FUNCTIONS CONTROL
    latency
    transactions
    tactical updates
    frontier selection
    job triggering
    retries
    patch validation

REFLECTOR UNDERSTANDS
    what may have worked
    what remains uncertain
    which hypotheses should change
    what should be tested next

COMPOSER MATERIALIZES
    semantic missions
    into distinct textual resonance attempts

STRATEGIC REFLECTOR CULTIVATES
    long-term threads
    shared language
    callbacks
    quality recipes
```

В коді:

```
7 tables
4 Edge Functions
1 AI worker (4 modes)
2 primary prompt contracts
1 deterministic frontier selector
```

> **Факти зберігає база. Невизначене значення інтерпретує GPT. Ритм контролює оркестратор. Користувач власними реакціями постійно переписує напрямок.**
