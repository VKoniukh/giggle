# Phase 6 — Observability & Economics

> **Source of truth:** [docs/04_ORCHESTRATION.md](../docs/04_ORCHESTRATION.md) §System Quality Dashboard
> **Також:** [docs/05_DATA_ARCHITECTURE.md](../docs/05_DATA_ARCHITECTURE.md) §Token Economics

---

## Навіщо це потрібно

> [!IMPORTANT]
> Без цього дашборду неможливо відповісти на два питання:
> 1. **Чи алгоритм працює як задумано?** (Quality Dashboard)
> 2. **Скільки це коштує?** (Token Economics)

---

## System Quality Dashboard — "МРТ" алгоритму

З docs/04 §System Quality Dashboard — один `user_id`, п'ять чисел + один графік.

### 5 чисел (вже є як SQL view `user_algorithm_health`)

| # | Метрика | Тривожний сигнал | Де фіксити |
|---|---------|-----------------|------------|
| 1 | **Resonance Rate** | < 15% після 50 карток | Промпти в ai-worker |
| 2 | **Transfer Success** | = 0 після 30 карток | Промпт reflect + якість open_question |
| 3 | **Thread Diversity** | < 2 нитки в 20 картках | Hard constraints у next-card |
| 4 | **Breathing Index** | = 0 після 3 сесій | Fatigue логіка в record-signal |
| 5 | **Depth Progression** | Не росте за 5 сесій | Промпт compose + trigger strategic_reflect |

### Thread Breathing Timeline (візуальний графік)

```
Thread A:  ███▓▓░░░░░░░▓▓████░░░░▓▓▓██████
Thread B:  ░░░░░░████▓▓░░░░░░░░░░████▓▓▓░░
Thread C:  ░░░░░░░░░░░░░░████▓▓▓▓░░░░░░░░░
           ─────────────────────────────────→ time (cards shown)

█ = active (used in shown card)
▓ = resting (exists but not used)
░ = not yet created / dormant
```

**Здоровий алгоритм** показує хвилі — нитки спалахують, гаснуть, повертаються.
**Хворий** — одна суцільна лінія або всі паралельно без дихання.

---

## Token & Cost Dashboard

### Фундаментальна одиниця: Cost per Card Shown

```
Cost per Card Shown = Σ estimated_cost (ai_runs) / COUNT cards (shown | hearted)
```

### Ланцюжок unit economics

```
Cost per Card Shown                         → $0.003 (estimate)
  × Avg Cards per Session (~25)             → $0.075 per session
  × Avg Sessions per Day (~1.5)             → $0.11 per DAU
  × 30 days                                 → $3.38 per MAU
  → Subscription > $3.38 або реклама > цієї суми
```

### Breakdown по операціях (view `cost_breakdown_by_operation`)

| Операція | Частота | Очікувана доля бюджету |
|----------|---------|----------------------|
| compose | ~3 per session | ~40% |
| reflect | ~2 per session | ~35% |
| cold_start_compose | 1 per session | ~10% |
| strategic_reflect | 1 per 3 sessions | ~10% |
| distill_quality | рідко | ~5% |

**Якщо reflect > 60% бюджету** → рефлексія занадто часта або промпт переускладнений.

### Cache Hit Rate

```
cache_hit_rate = SUM(cached_tokens) / SUM(input_tokens + cached_tokens)
```

Очікування: > 50% завдяки prompt caching strategy (static prefix кешується).

### Waste Rate

```
waste_rate = COUNT(cards WHERE status = 'discarded') / COUNT(all generated cards)
```

Очікування: < 30%. Якщо більше — composer генерує занадто багато невалідних кандидатів.

---

## Де показувати (MVP)

### Варіант 1: SQL запити вручну
```sql
SELECT * FROM user_algorithm_health WHERE user_id = '...';
SELECT * FROM user_unit_economics WHERE user_id = '...';
SELECT * FROM cost_breakdown_by_operation WHERE user_id = '...' ORDER BY usage_date DESC;
```

### Варіант 2: Простий admin screen у додатку (Settings → Debug)
- Тільки для адмін-юзерів (`user_minds` можна додати `is_admin` flag)
- 5 метрик + Thread Timeline
- Показувати тільки в debug/development builds

### Варіант 3 (пізніше): Grafana або custom web dashboard
- Підключити Grafana до Supabase Postgres
- Або побудувати окремий web dashboard

---

## Session End Detection

Сесія закінчується коли:
1. Користувач закрив додаток (AppState → background/inactive)
2. Таймаут неактивності: 5 хвилин без interaction
3. Explicit "done" action (якщо додамо)

При session end:
- `sessions.status = 'ended'`
- `sessions.ended_at = now()`
- Trigger final reflection (якщо не було нещодавно)
- Якщо > 3 ended sessions → trigger strategic reflection

---

## Трасування до документації

| Компонент | docs/ секція |
|-----------|-------------|
| 5 quality metrics | 04, §System Quality Dashboard |
| Thread Breathing Timeline | 04, §Thread Breathing Timeline |
| Cost per Card Shown | 05, §Cost per Card Shown |
| Unit economics formula | 05, §Приблизний Unit Economics |
| Cost breakdown view | 05, §SQL View: поопераційна розбивка |
| User unit economics view | 05, §SQL View: unit economics per user |
| Cache hit strategy | 06, §Prompt Architecture — порядок для кешування |
| North-star metrics | 03, §North-Star метрики |

---

## Валідація

- [ ] `user_algorithm_health` view повертає 5 метрик для тестового юзера
- [ ] `cost_breakdown_by_operation` показує витрати по типах операцій
- [ ] `user_unit_economics` рахує cost per card shown
- [ ] Resonance Rate відповідає реальності (ручна перевірка)
- [ ] Transfer Success = 0 коли transferів не було → тривожний сигнал видимий
- [ ] Session end detection працює (AppState → ended)
- [ ] Estimated cost записується в ai_runs при кожному AI виклику
