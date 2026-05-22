# Где задать user_metadata в Supabase

## Способ 1 — через интерфейс (проще)

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard) → ваш проект  
2. Слева **Authentication** → **Users**  
3. Клик по строке с вашим email (не «Add user», а существующий пользователь)  
4. Справа откроется панель пользователя  
5. Прокрутите до блока **Raw User Meta Data** (или **User Metadata**)  
6. Вставьте JSON:

```json
{
  "role": "engineer",
  "org_id": "ваш-uuid-из-NEXT_PUBLIC_OPTIQ_ORG_ID"
}
```

7. **Save** / галочка сохранения  

Если блока не видно — нажмите **⋮** у пользователя → **Edit user**.

## Способ 2 — при создании пользователя

**Authentication** → **Users** → **Add user** → Create new user:

- Email + Password  
- Включите **Auto Confirm User**  
- В поле metadata вставьте JSON выше  

## Способ 3 — SQL (для админа)

```sql
update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{
  "role": "engineer",
  "org_id": "ваш-uuid"
}'::jsonb
where email = 'nurtileu2001@gmail.com';
```

## Проверка

После входа в OPTIQ в DevTools → Application → должна быть сессия Supabase.  
Проекты сохраняются только если `org_id` в metadata совпадает с `NEXT_PUBLIC_OPTIQ_ORG_ID`.
