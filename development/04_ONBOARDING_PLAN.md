# Phase 4 — Onboarding Flow

> **Source of truth:** [docs/03_PRODUCT_SYSTEM.md](../docs/03_PRODUCT_SYSTEM.md) §Onboarding
> **Ключовий принцип:** "Onboarding не закінчується перед feed. Користувач не бачить моменту 'калібрування завершене'."

---

## Філософія онбордінгу

> [!CAUTION]
> **НЕ починати банально з:** опитувань жанрів ("dark humor чи dad jokes", "які теми любиш").
> Це стандартний recommender. Ми будуємо Personal Resonance Engine.

Онбордінг збирає три типи інформації:

| Тип | Що знімаємо | Зберігаємо де |
|-----|-------------|---------------|
| **Світ** (World) | Які реальності знайомі | `user_minds.onboarding_context.familiar_worlds[]` |
| **Мова** (Language) | Мова генерації + культурний код | `user_minds.language_state` |
| **Дозвіл** (Permission) | Куди можна заходити | `user_minds.boundaries` |
| **Резонанс** (Probes) | Які шляхи у сміх працюють | Перші 8-12 diagnostic cards → events |

---

## 3 екрани онбордінгу (IMPLEMENTED)

### Крок 1: `language.tsx` — Мова і культурний контекст

**Збирає:**
- Мова контенту (auto-detect від device + confirm) → `language_state.primary`
- Культурний контекст (країна проживання) → `language_state.cultural_context`

**Мови:** `uk` (Українська), `en` (English), `pl` (Polska)
**Країни:** UA, PL, US, GB, DE, CZ, CA, IL, OTHER

**UI:** Три language-карточки з прапорами + pill-shaped country tags. Auto-detect від device locale.
Підтримує recalibration mode (завантажує існуючі значення з user_minds).

### Крок 2: `world.tsx` — Хто ти у цьому світі

**Збирає:**
- Знайомі світи → `onboarding_context.familiar_worlds[]`

**Знайомі світи (tags для вибору):**
```
software_engineering    migration           relationships
corporate_life          parenthood          entrepreneurship
academia                medicine            creative_arts
student_life            freelance           remote_work
service_industry        city_life
```

**UI:** Animated tags з емоджі. Мінімум 1, максимум 8 вибраних. Підказка: "Це допоможе нам говорити твоєю мовою, не чужою."

### Крок 3: `permissions.tsx` — Що дозволено

**Збирає:**
- Дозволені зони → `boundaries.allowed[]`
- Обмежені зони → `boundaries.restricted[]`
- Заборонені зони → `boundaries.forbidden[]`

**Категорії з відповідним UI:**
```
profanity       → "Мат і грубість"
dark_humor      → "Чорний гумор (смерть, хвороби)"
sex             → "Секс і тілесність"  
absurd          → "Повний абсурд"
cringe          → "Соціальний крінж"
aggression      → "Агресивний гумор"
politics        → "Політика"
religion        → "Релігія"
violence        → "Жорстокість"
```

**UI:** Для кожної категорії — три стани: ✅ "Можна" / ⚠️ "Обережно" / ❌ "Ні"
Підказка: "Ми не будемо тестувати твої межі. Але знати їх — важливо."

### Плавний перехід: `probes` → Перші діагностичні картки у feed

**НЕ окремий екран, а перші 8-12 карток у feed!** (IMPLEMENTED)

Користувач бачить: "Давай подивимося, що тебе проб'є" → і далі показуються діагностичні картки. Це вже IS стрічка. Немає моменту "калібрування завершене".

Картки обираються з `quality_recipes` за:
- `language` = мова користувача
- Не суперечать `boundaries`
- `familiar_worlds` впливають на пріоритет, але не фільтрують (probe має бути ортогональним)
- Максимальна діагностична різниця між картками

**Перша серія (ортогональні проби з docs/06 §start-session):**
```
recognition + dry voice
absurdity + unresolved incongruity
tender imperfection
social catastrophe
linguistic literalism
```

**Після першого ❤️:**
1. Система відкриває гілку: що САМЕ спрацювало
2. Дає щось достатньо ІНШЕ, щоб не замкнути профіль
3. `onboarding_completed = true` в `user_minds`

---

## Рекалібрація (з Settings)

Доступна в Settings → "Перекалібрувати":
- Повертає на Steps 1-2 (world + permissions)
- **НЕ видаляє** нитки, канон, історію
- Лише оновлює `onboarding_context` і `boundaries`
- Trigger reflection з новим контекстом
- Use case: людина переїхала, змінила роботу, хоче розширити/звузити межі

---

## Трасування до документації

| Компонент | docs/ секція |
|-----------|-------------|
| "НЕ анкета" | 03, §Onboarding ≠ анкета |
| 3 типи інформації | 03, §Три типи інформації з onboarding |
| Feed = продовження onboarding | 03, §Feed І Є продовження onboarding |
| Перші 8-12 діагностичних проб | 03, §Перші 8-12 карток — діагностичні probes |
| Ортогональні проби | 03, §"одна тема — різні механізми" |
| Після першого сигналу | 03, §"Після першого сильного сигналу..." |
| Diagnostic cards з quality fund | 06, §start-session |

---

## Валідація

- [ ] Новий юзер після auth потрапляє в onboarding
- [ ] World screen: мова auto-detect + confirm працює
- [ ] World screen: familiar_worlds зберігаються в user_minds
- [ ] Permissions screen: boundaries зберігаються в user_minds
- [ ] Перехід у feed непомітний (probes виглядають як звичайні картки)
- [ ] Diagnostic probes відповідають language + boundaries
- [ ] Після першого ❤️ — onboarding_completed = true
- [ ] Рекалібрація з Settings працює (оновлює контекст, не видаляє нитки)
- [ ] Повторний вхід після onboarding → одразу feed
