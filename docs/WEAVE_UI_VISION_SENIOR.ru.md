# Weave — дизайн-видение (бриф для Claude Designer)

**Роль документа:** creative direction + UI/UX spec уровня lead designer.  
**Задача для Claude Designer:** по этому тексту сделать **полный визуальный дизайн** (Figma): дизайн-система, главный экран, модалки, состояния. **Не копировать текущий сайт** — предложить новый, зрелый, дорогой интерфейс.

---

## 0. Одна фраза о продукте

**Weave** — это «Figma для оптики на карте»: инженер видит город, прокладывает одну аккуратную линию волокна от OLT до каждой камеры, получает смету и KMZ. Интерфейс должен ощущаться как **профессиональный CAD в браузере**, а не как внутренний прототип с emoji-кнопками.

---

## 1. Эмоция и характер бренда

### Что должно чувствоваться

| Да | Нет |
|----|-----|
| Спокойная уверенность, точность | «Стартап из 2014», пёстрые градиенты |
| Ночная карта, светящаяся нить волокна | Игровой UI, неон без смысла |
| Инженерное доверие (смета, км, ОРК) | Детский onboarding, мультяшные иллюстрации |
| Воздух, ритм, иерархия | 20 кнопок в одной полоске |
| Тихая премиальность | Корпоративный шаблон «синий + серый» |

### Метафора визуала — «Single thread»

Логотип и акцент строятся на **одной непрерывной линии**, которая:

- на карте идёт **по дороге** (не диагональю через квартал);
- на UI — **связывает шаги** (импорт → построение → проход 1 → проход 2 → экспорт);
- в бренде — **переплетает** два направления (от OLT к абоненту и обратно по жильности ОК).

Не использовать буквальные emoji 📡📂💾 в production UI.

### Референсы по ощущению (не копировать 1:1)

- **Linear** — плотность, типографика, тёмная поверхность  
- **Mapbox Studio** — карта как герой, UI приглушён  
- **Figma** (dark) — панели, rail, чёткие состояния  
- **Raycast** — компактные группы действий  
- **Stripe Dashboard** — спокойные KPI, без крика  

---

## 2. Визуальный язык

### 2.1. Цвет — палитра «Night fiber»

**Base (фон):** не чистый `#000`, а глубокий сине-угольный слойми:

```
Canvas / app background:     #06080F
Surface (sidebar, header):   #0C1018
Elevated (cards, modals):    #141B28
Hover surface:               #1C2538
Border subtle:               rgba(148, 163, 184, 0.10)
Border strong:               rgba(148, 163, 184, 0.18)
```

**Text:**

```
Primary:    #F1F5F9
Secondary:  #94A3B8
Muted:      #64748B
Disabled:   #475569
```

**Accent — «живое волокно» (primary):**

```
Teal glow:   #2DD4BF  (основные CTA, активные вкладки, прогресс)
Teal dim:    rgba(45, 212, 191, 0.12) — фоны кнопок
Glow shadow: 0 0 40px rgba(45, 212, 191, 0.25) — только на primary CTA и логотипе
```

**Secondary accent — «спектр» (для AI, проход 2, схемы):**

```
Indigo soft: #818CF8
```

**Semantic (сдержанно, не кислотно):**

```
Success:  #4ADE80   — сохранено, бюджет OK
Warning:  #FBBF24   — валидация, «нужен проход ①→②»
Danger:   #F87171   — остановить OSRM, удалить
```

**Кабели на карте (не менять логику, только уточнить насыщенность):**

| Тип | Цвет линии | Толщина |
|-----|------------|---------|
| ОК-4 | `#60A5FA` холодный | 2px |
| ОК-8 | `#34D399` | 2.5px |
| ОК-12 | `#A78BFA` | 3px |
| ОК-16 | `#F472B6` | 3px |
| Выделенный | белый контур + glow accent | 4px |

Узлы: OLT — янтарная точка с кольцом; муфта — ромб/крест сварки; ОРК — квадрат с мягким свечением; камера — малый pin.

### 2.2. Типографика

**UI:** **Plus Jakarta Sans** (или **Geist Sans**) — современный, читаемый, не Inter-by-default.  
**Данные / координаты / метраж:** **JetBrains Mono** — только для чисел, KPI, координат.

| Стиль | Size | Weight | Use |
|-------|------|--------|-----|
| Display | 28px | 700 | Empty state title |
| H1 | 20px | 600 | Modal titles |
| H2 | 14px | 600 | Section in sidebar |
| Body | 13px | 400 | Основной текст |
| Caption | 11px | 500 | Подписи, hints |
| Overline | 10px | 600, letter-spacing 0.12em, UPPERCASE | Группы «ИНСТРУМЕНТЫ» |
| Mono KPI | 12px | 500 | `142.3 км`, lat/lon |

Межстрочный интервал body: **1.45**. Никакого текста **8px** в навигации.

### 2.3. Сетка и отступы

- Базовая сетка: **4px**  
- Sidebar width: **280px** (compact) / **320px** (comfort)  
- Header height: **56px** (один ряд; второй ряд — только &lt;1280px как drawer)  
- Радиусы: sm **6px**, md **10px**, lg **14px**, xl **20px** (модалки)  
- Карточки: padding **16–20px**, gap между секциями **24px**

### 2.4. Глубина и материал

- Панели: **1px border** subtle + лёгкая тень `0 4px 24px rgba(0,0,0,0.4)`  
- Модалки: **backdrop blur 12px** + затемнение `rgba(6,8,15,0.75)`  
- Карта: UI «плавает» над картой (glass), не сплошной кирпич  
- **Glass bar** для прогресса OSRM внизу по центру — как у Apple Maps route preview

### 2.5. Иконки

- Стиль: **Lucide-like**, stroke **1.75px**, 20×20 / 24×24  
- Без emoji. Единый набор: import, save, layers, cable, box, chart, tool, map-pin, undo, sparkles (AI)

### 2.6. Motion

- Hover: **150ms** ease  
- Panel open: **200ms** ease-out, translate Y 4px → 0  
- Progress bar: gradient shift subtle  
- **Никаких** bounce/spring на B2B-кнопках  
- Skeleton при загрузке карты — пульс opacity 0.4→0.7

---

## 3. Композиция главного экрана

### 3.1. Layout (desktop 1440+)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  HEADER 56px — brand | project | status | KPI | search | actions | import   │
├───┬────────────────────────────────────────────────────────────────────────┤
│ R │                                                                        │
│ A │                         MAP (hero, 100% height)                        │
│ I │     · легенда кабелей (bottom-right, collapsible)                      │
│ L │     · layer switcher (top-right, pill)                                 │
│   │     · empty state / progress overlay (center / bottom)                 │
│48 │     · entity card (right, 360px, when selection)                       │
│px │                                                                        │
└───┴────────────────────────────────────────────────────────────────────────┘
```

**Rail (48px)** слева — только иконки групп. **Контент панели** 232–272px — раскрывается при выборе группы (как VS Code / Figma).

### 3.2. Header — как я вижу

**Зона 1 — Идентичность (слева)**  
- Mark: переплетённые две дуги + точка сварки (градиент teal→indigo)  
- Wordmark **Weave** 15px bold  
- Под ним в xl: микрослоган одной строкой muted  

**Зона 2 — Проект**  
- Название: inline edit, underline только on focus  
- Status pill: Черновик / В работе / На согласовании / Сдан — цветная обводка, не `<select>` из 2000-х  

**Зона 3 — KPI (центр, chips)**  
Компактные **chips** с mono-числом:

`598 абонентов` · `142.3 км` · `24 ОРК` · `⚠ 3` (кликабельно → статистика)

При routing — chip morphs в progress: `OSRM 67%` с тонкой полоской внутри chip.

**Зона 4 — Поиск**  
Поле с иконкой лупы, placeholder «Адрес или координаты», высота 36px, full rounded pill.

**Зона 5 — Действия (справа)**  
Не 15 кнопок, а:

1. **Segmented control** «Просмотр | Редактирование»  
2. **Overflow menu «Узлы»**: OLT, Муфта, ОРК, Кабель  
3. **Icon group**: Undo, Redo  
4. **Primary** «Импорт» — teal, единственная кричащая кнопка  
5. **Ghost**: Проекты, Сохранить  
6. **AI** — иконка sparkles в indigo ring (не робот emoji)

Вторичные («Перестроить кабели», «Область», «Камеры») — появляются **контекстно** под KPI или в toolbar карты, не в header forever.

### 3.3. Sidebar — navigation rail

**4 группы** (не 10 табов):

| Rail icon | Группа | Внутри |
|-----------|--------|--------|
| Layers | Карта | Слои, легенда, заметки |
| Network | Сеть | Материалы, ОРК-группы, схема дерева |
| Analytics | Анализ | Статистика, оптический бюджет, стоимость |
| Workflow | Процесс | **①② Проходы**, экспорт PDF/KMZ, проекты, снимки |

Активный пункт: **левый accent-bar 3px** + фон teal dim.  
Предупреждения: **amber banner** вверху панели «3 замечания →» — один клик.

**Вкладка «Процесс» — сердце UX:**

Вертикальный **stepper** (всегда виден):

```
○ Импорт          ✓
○ Построение      ✓
● Проход 1        ← active (OSRM)
○ Проход 2
○ Экспорт
```

Кнопки:
- **Прокласть по дорогам** — full width, teal outline → fill on hover  
- Под ней: slider «Отступ от оси, м» 2–12, default 4  
- **Объединить линии** — indigo, disabled until pass 1 done  

Подпись 9px muted: «Сначала проход 1, затем 2».

### 3.4. Карта — hero

- 70–75% визуального веса экрана  
- UI chrome **приглушён** (opacity 0.92 glass), карта **ярче**  
- **Легенда** (bottom-right): карточка 180px, свёрнутая в «ОК-4…16» цветные точки  
- **Базовые карты** (top-right): 4 pill-кнопки иконками, не текстом  

**Empty state** (центр) — не emoji 📡, а:

- Mark 64px с мягким glow  
- Заголовок: «Спроектируйте сеть с нуля»  
- 3 шага в горизонтальных cards (или vertical на узком)  
- Primary CTA: «Импортировать Excel или KMZ»  
- Secondary: «Справка и горячие клавиши»

**Placing mode banner** (top center, glass):  
«Кликните на карту, чтобы поставить OLT» + Esc

**Routing progress** (bottom center):  
Card 400px: заголовок, progress bar gradient teal→indigo, «Остановить» text danger, mono `184/240`

### 3.5. Entity editor (правая карточка)

Не «форма в углу», а **Inspector** 360px:

- Header: тип узла + ID mono + кнопка закрыть  
- Tabs внутри: Параметры | Связи | Сварка (для муфты)  
- Поля: label слева 120px, control справа  
- Footer sticky: **Сохранить** secondary + **Перестроить кабели** warn outline  

Визуал: elevated card, shadow, отступ от края карты 16px.

### 3.6. AI Chat

- **Drawer** справа 400px, не перекрывает KPI  
- Заголовок «Ассистент Weave» + muted «меняет сеть на карте»  
- Сообщения: user — elevated bubble right; assistant — left без тяжёлой рамки  
- Input: pill внизу, send teal  

Floating FAB только если drawer закрыт — **56px circle**, indigo gradient border, icon sparkles.

---

## 4. Модальные окна

### Импорт — wizard (4 шага)

1. **Источник** — drag-drop zone (пунктир border, иконка file), Excel / KMZ / JSON  
2. **Данные** — превью таблицы 5 строк, счётчик точек  
3. **OLT** — карта мини или поля координат по районам  
4. **Параметры** — сторона дороги, резерв кабеля; кнопка «Построить»

Footer: Назад | Далее | **Построить сеть** (primary на шаге 4)

Ширина modal: **640px**, rounded xl.

### Справка

Две колонки: слева hotkeys grid (kbd стилизованные), справа «Работа с картой» иллюстрация-схема pipeline.

### Проекты

Список cards: название, дата, статус pill, hover → Открыть.

---

## 5. Состояния и микро-UX

| Состояние | Поведение |
|-----------|-----------|
| Default | Спокойные borders |
| Hover | Border accent 40%, bg hover |
| Active / selected | Accent bar + teal dim bg |
| Disabled | Opacity 0.35, no hover |
| Loading | Spinner 20px teal, block UI section not full screen |
| Error | Banner top of panel, danger muted bg |

**Toast** (опционально): bottom-right, 3s, «Проект сохранён»

**Undo**: после деструктивного действия — snackbar «Отменить» 5s

---

## 6. Адаптив

- **≥1440:** layout как выше  
- **1280–1439:** KPI сокращаются до чисел без слов; overflow menu для узлов  
- **&lt;1280:** sidebar collapse to rail only; panel overlay; header actions → «⋯» menu  

Мобильный **не проектировать** в v1 (явно desktop tool).

---

## 7. Deliverables для Claude Designer

1. **Figma**: Cover + Design system page (tokens)  
2. **Frames**: 1440×900 — Empty / Network built / OSRM progress / Import step 2 / Entity inspector / AI drawer  
3. **Components**: Button, Input, Select, Chip, KPI, Stepper, Sidebar rail item, Modal, Progress, Map legend  
4. **Logo**: SVG mark + wordmark on dark  
5. **Export**: CSS variables table + 1-page PDF spec  

---

## 8. Промпт для Claude Designer (копировать целиком)

```
Ты — lead product designer (20+ лет UX/UI), специализация: professional tools, geospatial, B2B engineering software.

Создай с нуля визуальный дизайн веб-приложения WEAVE — редактор оптической сети GPON на карте (Казахстан, инженеры связи, проекты видеонаблюдения Sergek). НЕ копируй типичный dark admin template и НЕ используй emoji как иконки.

КОНЦЕПЦИЯ «Night fiber / Single thread»:
Продукт = одна аккуратная линия волокна по дороге от OLT до камеры. Бренд: переплетённая линия, спокойная премиальная тёмная тема, ощущение Linear × Mapbox Studio × Figma dark.

ПАЛИТРА:
Фон #06080F, surface #0C1018, elevated #141B28. Текст #F1F5F9 / #94A3B8 / #64748B. Primary accent teal #2DD4BF с мягким glow на CTA. Secondary indigo #818CF8 для AI и pass 2. Semantic: success #4ADE80, warn #FBBF24, danger #F87171. Кабели на карте: ОК-4 синий, ОК-8 зелёный, ОК-12 фиолетовый, ОК-16 розовый — не менять смысл цветов.

ТИПОГРАФИКА: Plus Jakarta Sans (UI), JetBrains Mono (KPI, координаты). Минимум 11px в UI, overline 10px uppercase для секций. Никакого 8px текста.

LAYOUT 1440px:
- Header 56px: logo mark (переплетённые дуги + точка сварки), project name editable, status pill, KPI chips (абоненты, км, ОРК, warnings), search pill, segmented View/Edit, overflow «Узлы», undo/redo, primary «Импорт», ghost save/projects, AI sparkles icon.
- Left: icon rail 48px + content panel 280px с 4 группами (Карта, Сеть, Анализ, Процесс) — НЕ 10 равных мелких табов.
- Center: Leaflet map hero, glass overlays.
- Right (on selection): Inspector card 360px для OLT/Муфта/ОРК.

ОБЯЗАТЕЛЬНЫЕ ЭКРАНЫ (hi-fi):
1) Empty state — 3 шага pipeline, CTA импорт, без emoji.
2) Сеть построена — sidebar «Процесс» с vertical stepper: Импорт→Построение→Проход1→Проход2→Экспорт; кнопки OSRM и слияние.
3) OSRM progress — bottom glass card, gradient progress bar.
4) Import modal wizard 4 шага, drag-drop.
5) Entity inspector + AI drawer 400px.

КОМПОНЕНТЫ: design system — buttons (primary teal glow, secondary, ghost), inputs, chips, stepper, modal, map legend collapsible, kbd hotkeys, toasts.

СТИЛЬ: 4px grid, radius 10–20px, subtle borders rgba(148,163,184,0.12), shadows мягкие, backdrop blur на overlays, motion 150–200ms без bounce. Иконки stroke 1.75px единый набор.

ЯЗЫК UI: русский. Тон: профессиональный, спокойный, уверенный.

Deliverable: Figma-структура + страница токенов + CSS variables export. Сделай 2 варианта accent (teal primary vs warm copper secondary) на одной странице для сравнения — заказчик выберет teal.
```

---

*Документ для Claude Designer. Реализация в коде — отдельный этап после утверждения макетов.*
