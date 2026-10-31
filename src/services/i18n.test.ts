import { h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { getAppLanguage, setAppLanguage, subscribeAppLanguage, translateText } from './i18n';

afterEach(() => setAppLanguage('en'));

describe('app localization', () => {
  it('defaults to English', () => {
    expect(getAppLanguage()).toBe('en');
    expect(translateText('Sign out')).toBe('Sign out');
  });

  it('translates known UI copy into Russian and leaves unknown text unchanged', () => {
    expect(translateText('User management', 'ru')).toBe('Управление пользователями');
    expect(translateText('Unknown market symbol', 'ru')).toBe('Unknown market symbol');
  });

  it('translates text and accessible labels when Preact nodes are created', () => {
    setAppLanguage('ru');
    const vnode = h('button', { title: 'Sign out', 'aria-label': 'Sign out' }, 'Sign out');
    expect(vnode.props.children).toBe('Выйти');
    expect(vnode.props.title).toBe('Выйти');
    expect(vnode.props['aria-label']).toBe('Выйти');
  });

  it('translates dynamic accessibility labels, update text, and quantity counters', () => {
    expect(translateText('Updated 4m ago', 'ru')).toBe('Обновлено 4m ago');
    expect(translateText('Read news: Apple announces results', 'ru')).toBe('Читать новость: Apple announces results');
    expect(translateText('Stocktwits unavailable: Network error', 'ru')).toBe('Stocktwits недоступен: Network error');
    expect(translateText('Assigned stock value: ≥$1,200', 'ru')).toBe('Стоимость назначенных акций: ≥$1,200');
    expect(translateText('3 tranches', 'ru')).toBe('3 лота');
    expect(translateText('2 records', 'ru')).toBe('2 записи');
    expect(translateText('Show 4 tranches', 'ru')).toBe('Показать 4 лота');
  });

  it('localizes dynamic projection, sync, and risk labels', () => {
    expect(translateText('Synced: 12:30 PM', 'ru')).toBe('Синхронизировано: 12:30 PM');
    expect(translateText('Rows 1–8 of 16', 'ru')).toBe('Строки 1–8 из 16');
    expect(translateText('Page 2 of 4', 'ru')).toBe('Страница 2 из 4');
    expect(translateText('EOW · +3d', 'ru')).toBe('До конца недели · +3 дн.');
    expect(translateText('NTD · +1d', 'ru')).toBe('Следующий торговый день · +1 дн.');
    expect(translateText('Position value 90.00 (already10.0% below trigger)', 'ru')).toBe('Стоимость позиции 90.00 (уже на 10.0% ниже порога)');
  });

  it('localizes TradeNet history recovery and accessible table copy', () => {
    expect(translateText('TradeNet refresh failed. Showing saved history, which may be out of date.', 'ru'))
      .toBe('Не удалось обновить историю TradeNet. Показана сохранённая история, которая может быть устаревшей.');
    expect(translateText('Retry TradeNet history', 'ru')).toBe('Повторить загрузку истории TradeNet');
    expect(translateText('Refreshing TradeNet history…', 'ru')).toBe('Обновление истории TradeNet…');
    expect(translateText('Retrying…', 'ru')).toBe('Повторная попытка…');
    expect(translateText('Closed trade history with ticker, closing date, quantity, duration, fees, commissions, and net profit.', 'ru'))
      .toBe('История закрытых сделок с тикером, датой закрытия, количеством акций, сроком удержания, сборами, комиссиями и чистой прибылью.');
  });

  it('localizes full-reset history confirmation and failure messages', () => {
    expect(translateText('[System]: Closed trade history cleared from KV cloud.', 'ru'))
      .toBe('История закрытых сделок очищена в облаке KV.');
    expect(translateText('The portfolio was reset in memory, but some local data could not be cleared. Check browser storage before reloading.', 'ru'))
      .toBe('Портфель сброшен в памяти, но не удалось очистить часть локальных данных. Проверьте хранилище браузера перед перезагрузкой.');
    expect(translateText('The portfolio was reset locally, but cloud closed history could not be cleared. Restore cloud access and retry the reset.', 'ru'))
      .toBe('Портфель сброшен локально, но не удалось очистить историю сделок в облаке. Восстановите доступ к облаку и повторите сброс.');
  });

  it('notifies the app when the selected language changes', () => {
    const changes: string[] = [];
    const unsubscribe = subscribeAppLanguage((language) => changes.push(language));
    setAppLanguage('ru');
    setAppLanguage('en');
    unsubscribe();
    expect(changes).toEqual(['ru', 'en']);
  });
});
