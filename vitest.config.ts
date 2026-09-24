import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    include: ['**/*.test.ts'],
    environment: 'node',
    /**
     * Часовой пояс, в котором работают люди.
     *
     * В UTC ошибки с датами не видны: полночь по местному времени и
     * полночь по Гринвичу — одно и то же, и `toISOString()` от даты из
     * Excel даёт верный день. В Казахстане он даёт вчерашний, и смена
     * ложится в журнал не тем числом. Такое ловится, только если тесты
     * идут в том же поясе, что и работа.
     */
    env: { TZ: 'Asia/Almaty' },
  },
});
