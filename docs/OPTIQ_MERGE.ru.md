# Слияние дизайна Optiq / Night Fiber

## Базовая ветка (под последний Vercel-деплой)

Работаем **только от**:

```
ветка:  claude/fix-network-routing-QsxCh
коммит: c3bb187 (на момент настройки агента)
```

Это актуальная логика: OSRM, Sergek-топология, консолидация, лассо, ветки, ручной кабель, KMZ.

ID деплоя Vercel: `dpl_DR5pszv4PXGgASXs858D2i2SQNKV` — в облаке агента нет токена Vercel, поэтому SHA сверь в Dashboard → Deployments → этот деплой → **Source / Commit**. Если commit ≠ `c3bb187`, напиши SHA — переключимся на него.

## Как влить zip `optiq (1).zip`

**Не заменяй репо целиком** — потеряешь фиксы маршрутизации.

1. Распакуй zip в отдельную папку, например `optiq-unpacked/`.
2. Убедись, что база — `claude/fix-network-routing-QsxCh` (актуальная).
3. Создай ветку для UI:
   ```bash
   git checkout claude/fix-network-routing-QsxCh
   git pull origin claude/fix-network-routing-QsxCh
   git checkout -b cursor/optiq-night-fiber-91b6
   ```
4. Скопируй **только UI-файлы** из zip поверх репо (не затирай `components/Network/*`, `hooks/useNetwork.ts`, импортеры без сравнения):
   - `app/globals.css`, `app/layout.tsx`, `app/page.tsx`
   - `components/Sidebar/Sidebar.tsx`, `components/Sidebar/*Tab.tsx`
   - `components/Brand/Logo.tsx`, `components/Inspector/Inspector.tsx`, `components/AI/AIDrawer.tsx`
   - `components/Geocoding/GeocodeSearch.tsx`
   - `components/Map/MapContainer.tsx` — **осторожно**: в zip только цвета линий; не откатывай click-handlers
   - `package.json` (+ `npm install` для `lucide-react`)
   - `tailwind.config.js` при наличии
5. После копирования **обязательно вручную**:
   - В `page.tsx` оставить вызовы `net.runPass1Osrm`, `rebuildCablesFromLayout`, `EntityEditor` или подключить `Inspector` к тем же props.
   - `AIDrawer` — подключить к `/api/chat` и `ChatPanel` logic (или оставить `ChatPanel`, стилизовать).
   - Inspector: `onEntityClick` в `MapContainer` уже есть в production — передать в Inspector.
6. Проверка:
   ```bash
   npm install --legacy-peer-deps
   npm run build
   npm test
   ```
7. Push и Vercel:
   ```bash
   git add -A && git commit -m "ui: Night Fiber (optiq) on production routing base"
   git push -u origin cursor/optiq-night-fiber-91b6
   ```
   В Vercel: Preview этого PR/ветки, сравни с `dpl_DR5pszv4...`.

## Загрузка zip в облако агента

Чтобы агент сам смержил: положи архив в репозиторий, например `samples/optiq.zip`, или распакуй в `samples/optiq/` и напиши в чат «мержи optiq из samples».

## Что не трогать из production

- `components/Network/SergekTopology.ts`, `Consolidation.ts`, `mergeParallelRoutes.ts`, `OSRMRouter.ts`
- `hooks/useNetwork.ts` (кроме мелких пропсов для UI)
- `components/Import/KmlStructured.ts`, `ExcelImporter.ts`
