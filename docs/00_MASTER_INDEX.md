# GIGGLE — Product Architecture Master Index

> **Кодова назва:** Giggle  
> **Суть:** Personal Resonance Engine — система, що відкриває унікальну функцію переходу конкретної людини у стан сміху через текст і безперервно поглиблює це знання.  
> **Не є:** recommender, joke generator, meme app, content feed.

---

## Як читати цю документацію

Документи організовані у **шість шарів** — від абстрактного візіонерського до конкретного інженерного. Кожен наступний шар спирається на попередній і не має сенсу без нього.

```
Layer 0  — Філософія сміху та бачення продукту
Layer 1  — Laugh Topology: що система насправді моделює
Layer 2  — Product System: flywheel-логіка та lifecycle
Layer 3  — Orchestration: тактика, оперативність, стратегія
Layer 4  — Data Architecture: таблиці, стани, lineage
Layer 5  — Edge Functions & AI Contracts: prompt-архітектура
```

---

## Карта документів

### Layer 0 — Візія
| Документ | Зміст |
|----------|-------|
| [01_VISION_AND_PHILOSOPHY.md](./01_VISION_AND_PHILOSOPHY.md) | Що таке сміх. Чому це не рекомендер. Що нового створює цей продукт. Чому текст — ідеальний перший медіум. Комедія з аудиторією в одну людину. |

### Layer 1 — Laugh Topology
| Документ | Зміст |
|----------|-------|
| [02_LAUGH_TOPOLOGY.md](./02_LAUGH_TOPOLOGY.md) | 7 глибинних шарів профілю (заряджені нерви, оператори гумору, емоційне паливо, дистанція/дозвіл, голос, соціальна геометрія, метаболізм новизни). 10 типів текстового mirth. Laugh response formula. |

### Layer 2 — Product System
| Документ | Зміст |
|----------|-------|
| [03_PRODUCT_SYSTEM.md](./03_PRODUCT_SYSTEM.md) | Три flywheel (особистий, новизни, колективний). Onboarding → feed → lifecycle. Сигнали (❤️ heart + ↗️ share + implicit). Personal Canon. Quality Fund. Anti-burnout закони. North-star метрики. |

### Layer 3 — Orchestration
| Документ | Зміст |
|----------|-------|
| [04_ORCHESTRATION.md](./04_ORCHESTRATION.md) | 9 операцій оркестрації. 3 рівні (тактичний / оперативний / стратегічний). 4 контури системи (feed loop, tactical loop, semantic reflection, long-memory). Механічні hard constraints. Поділ влади між кодом і AI. |

### Layer 4 — Data Architecture
| Документ | Зміст |
|----------|-------|
| [05_DATA_ARCHITECTURE.md](./05_DATA_ARCHITECTURE.md) | 7 таблиць Postgres (user_minds, sessions, threads, cards, events, ai_runs, quality_recipes). Повні SQL-схеми. JSONB-контракти. State versioning. Thread versioning. Lineage model. |

### Layer 5 — Edge Functions & AI
| Документ | Зміст |
|----------|-------|
| [06_EDGE_FUNCTIONS_AND_AI.md](./06_EDGE_FUNCTIONS_AND_AI.md) | 4 Edge Functions (start-session, record-signal, next-card, ai-worker). Reflector/Composer contracts. Prompt architecture (5 шарів). Structured outputs. Cost control. Trigger conditions. |

---

## Ключові принципи (cross-cutting)

> Ці принципи пронизують усі шари і порушення будь-якого з них знищує суть продукту.

1. **Hypothesis, not identity** — кожна нитка про користувача є тимчасовою гіпотезою, не фіксованою характеристикою
2. **Branch, not copy** — сильне попадання відкриває гілки (deepen, transfer, mutate, contrast), а не серію копій
3. **Falsifiability** — кожна картка знає, що різні реакції на неї означатимуть
4. **Sequence over item** — оптимізується не якість окремої картки, а бажання побачити наступну
5. **AI proposes, code decides** — AI генерує значення, код контролює ритм і обмеження
6. **Facts are immutable** — events ніколи не редагуються; інтерпретації завжди перебудовуються
7. **Personal fact is not depth** — Spring Boot замість Java — це не поглиблення; людська суперечність усередині контексту — це поглиблення
8. **Surprise is a debt** — кожне використання знайомого механізму підвищує novelty_debt
9. **Moat = lineage** — цінність системи у пам'яті про те, як із реакцій конкретної людини народилася її комедійна реальність

---

## Технологічний стек (MVP)

```
Supabase Auth          — автентифікація
Postgres (Supabase)    — єдине джерело істини
Edge Functions (Deno)  — 4 endpoints
OpenAI API             — structured outputs, 2 prompt modes
Mobile App             — текстовий feed (стек визначається окремо)
```

**Не потрібно:** мікросервіси, Kafka, persistent agents, vector database (на старті), Kubernetes, агентний zoo.

---

## Навігаційний принцип

Якщо потрібно зрозуміти **чому** — читай Layer 0-1.  
Якщо потрібно зрозуміти **що будувати** — читай Layer 2-3.  
Якщо потрібно зрозуміти **як будувати** — читай Layer 4-5.

> Ніколи не починай з Layer 4-5 без розуміння Layer 0-1. Це призведе до "рекомендера з AI жартами", а не до Personal Resonance Engine.
