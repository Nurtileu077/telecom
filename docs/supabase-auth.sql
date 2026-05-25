-- OPTIQ: роли через Supabase Auth (опционально)
-- В Dashboard → Authentication включите Email provider.
-- При создании пользователя или через Admin API задайте user_metadata:
--   { "role": "engineer" }  |  "field"  |  "viewer"

-- Пример обновления роли существующему пользователю (service role, не в клиенте):
-- update auth.users set raw_user_meta_data = raw_user_meta_data || '{"role":"field"}'::jsonb
-- where email = 'montazhnik@example.com';
