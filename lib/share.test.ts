import { describe, it, expect } from 'vitest';
import { shareLink, MESSENGER_LABEL } from './share';

describe('shareLink', () => {
  it('WhatsApp без телефона открывает выбор чата', () => {
    expect(shareLink('whatsapp', 'Наряд на 21.07')).toBe(
      'https://wa.me/?text=%D0%9D%D0%B0%D1%80%D1%8F%D0%B4%20%D0%BD%D0%B0%2021.07',
    );
  });

  it('телефон чистится от скобок и пробелов', () => {
    expect(shareLink('whatsapp', 'привет', '+7 (777) 000-00-00'))
      .toContain('wa.me/77770000000?text=');
  });

  it('перенос строки и кириллица не ломают адрес', () => {
    const link = shareLink('telegram', 'Участок: Зеренда\nОсталось 2 000 м');
    expect(link.startsWith('https://t.me/share/url?url=&text=')).toBe(true);
    expect(decodeURIComponent(link.split('text=')[1])).toContain('Зеренда');
    expect(decodeURIComponent(link.split('text=')[1])).toContain('\n');
  });

  it('у каждого мессенджера есть имя для кнопки', () => {
    expect(MESSENGER_LABEL.whatsapp).toBe('WhatsApp');
    expect(MESSENGER_LABEL.telegram).toBe('Telegram');
  });
});
