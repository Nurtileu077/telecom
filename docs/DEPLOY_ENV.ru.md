# Переменные окружения OPTIQ (прод)

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | для облака | URL проекта Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | для облака | anon key |
| `NEXT_PUBLIC_OPTIQ_ORG_ID` | рекомендуется | UUID организации для `org_id` в строках проектов |
| `NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH` | прод | `1` — без magic link нельзя читать/писать проекты в Supabase |
| `ANTHROPIC_API_KEY` | для чата | только на сервере (API route) |

## Supabase (один раз)

1. Выполнить `docs/supabase-rls.sql`
2. Выполнить `docs/supabase-field-photos.sql`
3. Authentication → Email: включить, **Confirm email** по желанию; для входа по паролю — пользователь с паролем в **Users → Add user**
4. В `user_metadata` задать `role` и `org_id` (совпадает с `NEXT_PUBLIC_OPTIQ_ORG_ID`)
5. **Database → Publications → supabase_realtime** — включить таблицу `gpon_projects` (событие `UPDATE`), иначе после сохранения коллеги проект не подтянется автоматически
6. Realtime для Presence (по умолчанию)

## Курсоры коллег

Несколько вкладок/браузеров с одним `?project=<id>` — в шапке «В проекте: N», на карте цветные метки с именем. Нужен Supabase и сеть.
