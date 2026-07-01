# Phase 5 — Core Loop Polish

> **Source of truth:** [docs/04_ORCHESTRATION.md](../docs/04_ORCHESTRATION.md) — 9 operations, 4 loops, hard constraints
> **Також:** [docs/03_PRODUCT_SYSTEM.md](../docs/03_PRODUCT_SYSTEM.md) — anti-burnout laws, north-star metrics

---

## Що тут відточується

Phase 5 — це не нові функції, а **fine-tuning** механік із Phase 2-4:
- Card Selection Formula (точний scoring)
- Hard Constraints (залізні правила)
- Thread Breathing (fatigue → rest → callback)
- Rolling Frontier (живий мікробуфер)
- Anti-Burnout закони
- Personal Canon UX

---

## Card Selection Formula

З docs/06 §next-card:

```
card_score =
    queue_priority                              ← базовий пріоритет від composer
  + move_fit(current_session_need, card.move)   ← чи підходить тип руху
  + thread_heat(card.source_threads)            ← наскільки нитка "гаряча"
  + novelty_bonus(card.semantic_distance)       ← бонус за відхилення
  + callback_readiness(card, session)           ← чи готовий callback
  - thread_fatigue(card.source_threads)         ← штраф за втому нитки
  - format_repetition(card.format, recent)      ← штраф за повтор формату
  - voice_repetition(card.recipe.voice, recent) ← штраф за повтор голосу
  - semantic_similarity_to_recent(card, last_3) ← штраф за семантичну близькість
```

### Hard Constraints (перед score — відсікають)

```
✗ не більше 2 близьких карток однієї нитки підряд
✗ не повторювати format 3 рази з 5 карток
✗ не показувати stale card (thread version змінилась)
✗ не callback без достатньої паузи
✗ не high-risk card після boundary-negative signal
✓ обов'язково погашати novelty debt
```

---

## Rolling Frontier

З docs/04 §Rolling Frontier:

```
slot 1 — anchor / likely hit (deepen)
slot 2 — nearby mutation
slot 3 — transfer or contrast
slot 4 — wildcard
slot 5 — callback candidate (optional)
slot 6 — replacement candidate (optional)
```

- 2-4 ready cards
- 2-3 speculative candidates
- Все прив'язане до `state_version` / `thread_version`
- Після сильного сигналу частина кандидатів стає stale

---

## Thread Breathing

### Автоматичні переходи

```
hit → heat ↑, fatigue ↑
  → якщо fatigue > 0.7 → status = 'resting'
  → resting мінімум N карток (не 3 хвилини, а 3-5 інших карток)
  → після паузи → status = 'dormant' або 'active' (якщо callback)

Серія skips → heat ↓
  → якщо heat < 0.2 AND confidence < 0.4 → status = 'retired'
```

### Callback механіка

```
Нитка перейшла в resting
  → через 5+ карток від інших ниток
  → якщо shared history достатня
  → callback з НОВИМ кутом (не повторення!)
```

---

## Anti-Burnout закони

З docs/03 §Anti-Burnout:

| Закон | Реалізація |
|-------|-----------|
| Hit відкриває гілку, не серію копій | Composer отримує mission з move ≠ копія |
| Попадання підвищує і heat, і fatigue | `record-signal` тактичний update |
| Після кількох близьких попадань — rest | Fatigue threshold → resting |
| Новизна різної дистанції | Frontier slots: mutation, transfer, wildcard |
| Старі нитки повертаються глибше | Callback з більшим контекстом |
| Не кожен текст має бути найсмішнішим | Temperature management |

---

## Personal Canon (UI polish)

З docs/03 §Personal Canon:

- Хронологічний список hearted текстів
- Кожна картка показує: text, move type, thread indicator
- Swipe to remove (card.status = 'shown', виходить з канону)
- Можливість перечитати
- **НЕ** показувати діаграми типу "73% deadpan"
- Коли канон > 50 текстів → додати ⭐ для суперхітів (future)

---

## Трасування до документації

| Механіка | docs/ секція |
|----------|-------------|
| Card Selection Formula | 06, §Card Selection Formula |
| Hard Constraints | 06, §Hard Constraints + 04, §Hard Constraints |
| Rolling Frontier | 04, §Rolling Frontier |
| 9 операцій оркестрації | 04, §9 операцій |
| Thread lifecycle | 05, §Thread статуси |
| heat/confidence/fatigue | 04, §heat vs confidence vs fatigue |
| Anti-Burnout закони | 03, §Anti-Burnout закони |
| Personal Canon | 03, §Personal Canon |
| Нитка = гіпотеза | 04, §Нитка — це гіпотеза |
| Як нитка розвивається | 04, §Як одна нитка реально розвивається |

---

## Валідація

- [ ] Card selection обирає diverse картки (Thread Diversity > 2 з 20)
- [ ] Hard constraints НЕ порушуються (автоматичний тест)
- [ ] Нитки з fatigue > threshold переходять у resting
- [ ] Callbacks відбуваються після достатньої паузи
- [ ] Breathing Index > 0 після 3 сесій (перевірити через view)
- [ ] Personal Canon показує тексти хронологічно
- [ ] Видалення з канону працює
- [ ] Novelty debt погашається (wildcard/transfer з'являються)
- [ ] Формати не повторюються 3 рази підряд
