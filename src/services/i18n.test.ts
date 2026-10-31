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

  it('clarifies that full reset does not delete broker-side TradeNet records', () => {
    expect(translateText(
      'Reset the terminal to a blank slate? This clears saved portfolio and history data locally and in KV cloud. It does not delete TradeNet records held by the broker; those read-only records may reappear when broker history is refreshed.',
      'ru'
    )).toBe('Сбросить терминал до пустого состояния? Сохранённые данные портфеля и история будут удалены локально и из облака KV. Записи TradeNet у брокера не удаляются; эта история доступна только для чтения и может появиться снова после обновления данных брокера.');
  });

  it('localizes full-reset history confirmation and failure messages', () => {
    expect(translateText('[System]: Closed trade history cleared from KV cloud.', 'ru'))
      .toBe('История закрытых сделок очищена в облаке KV.');
    expect(translateText('The portfolio was reset in memory, but some local data could not be cleared. Check browser storage before reloading.', 'ru'))
      .toBe('Портфель сброшен в памяти, но не удалось очистить часть локальных данных. Проверьте хранилище браузера перед перезагрузкой.');
    expect(translateText('The portfolio was reset locally, but cloud closed history could not be cleared. Restore cloud access and retry the reset.', 'ru'))
      .toBe('Портфель сброшен локально, но не удалось очистить историю сделок в облаке. Восстановите доступ к облаку и повторите сброс.');
  });

  it('localizes the guest LOTS workspace and assignment history', () => {
    expect(translateText('LOTS', 'ru')).toBe('ЛОТЫ');
    expect(translateText('Your cash-funded purchase allocations, including completed and removed assignments', 'ru'))
      .toBe('Ваши покупки за собственные средства, включая завершённые и снятые с назначения лоты');
    expect(translateText('Open cost basis', 'ru')).toBe('Себестоимость открытых лотов');
    expect(translateText('Open market value', 'ru')).toBe('Рыночная стоимость открытых лотов');
    expect(translateText('All statuses', 'ru')).toBe('Все статусы');
    expect(translateText('Assigned from', 'ru')).toBe('Назначено с');
    expect(translateText('Assigned to', 'ru')).toBe('Назначено по');
    expect(translateText('No assignments match these filters.', 'ru'))
      .toBe('Нет назначений, соответствующих выбранным фильтрам.');
    expect(translateText('Market value is shown only for open assigned holdings. Realized profit/loss is not inferred from assignment history. Pre-feature open assignments are dated when first recorded.', 'ru'))
      .toContain('Рыночная стоимость показывается только для открытых назначенных активов.');
  });

  it('localizes dynamic record counts, unassigned rows, and risk buffers', () => {
    expect(translateText('2 / 8 records', 'ru')).toBe('2 / 8 записей');
    expect(translateText('1 / 1 records', 'ru')).toBe('1 / 1 запись');
    expect(translateText('· 5 unassigned', 'ru')).toBe('· Без назначения: 5');
    expect(translateText('42.5% buffer', 'ru')).toBe('Запас: 42.5%');
  });

  it('localizes guest workspace tooltips and loading states', () => {
    expect(translateText('Partial value: holdings without a valid market quote are excluded.', 'ru'))
      .toBe('Частичная стоимость: активы без корректной рыночной котировки не учитываются.');
    expect(translateText('Current market value of your assigned cash-funded stocks.', 'ru'))
      .toBe('Текущая рыночная стоимость назначенных вам акций, приобретённых за денежные средства.');
    expect(translateText('Loading your assigned tranche history…', 'ru'))
      .toBe('Загрузка истории назначенных вам лотов…');
    expect(translateText('Workspace navigation','ru')).toBe('Навигация по разделам');
    expect(translateText('Read-only order book snapshot · TradeNet','ru'))
      .toBe('Снимок стакана заявок TradeNet · только для чтения');
  });

  it('localizes remaining authentication, guest balance, and trade-history copy', () => {
    expect(translateText('Authentication failed.', 'ru')).toBe('Не удалось пройти аутентификацию.');
    expect(translateText('Could not load guest accounts.', 'ru')).toBe('Не удалось загрузить список гостевых учётных записей.');
    expect(translateText('Loading holdings, trade activity and account allocations…', 'ru'))
      .toBe('Загрузка активов, истории сделок и распределения по счетам…');
    expect(translateText('No stocks are assigned to your account yet.', 'ru')).toBe('Вам пока не назначены акции.');
    expect(translateText('Market quote unavailable. Market value and unrealized P/L will appear when a valid quote is received.', 'ru'))
      .toBe('Рыночная котировка недоступна. Рыночная стоимость и нереализованная прибыль/убыток появятся после получения корректной котировки.');
    expect(translateText('Restoring saved trade history and loading the latest Freedom activity…', 'ru'))
      .toBe('Восстановление сохранённой истории сделок и загрузка последних операций Freedom…');
    expect(translateText('Known net P&L', 'ru')).toBe('Чистая прибыль/убыток по известным сделкам');
  });

  it('localizes dynamic market-depth, position-review, and scenario-report labels', () => {
    expect(translateText('Market depth · AAPL', 'ru')).toBe('Стакан заявок · AAPL');
    expect(translateText('Open market depth for AAPL', 'ru')).toBe('Открыть стакан заявок для AAPL');
    expect(translateText('AAPL · Position Review', 'ru')).toBe('AAPL · Анализ маржинальной позиции');
    expect(translateText('No active margin position was found for NVDA. Select an active margin ticker and try again.', 'ru'))
      .toBe('Не найдена активная маржинальная позиция NVDA. Выберите активный маржинальный тикер и повторите попытку.');
    expect(translateText('HYPOTHETICAL BUY: NVDA', 'ru')).toBe('ПОКУПКА В СЦЕНАРИИ: NVDA');
    expect(translateText('MULTI-DATE EXIT COMPARISON: TSLA', 'ru'))
      .toBe('СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА ПО ДАТАМ: TSLA');
    expect(translateText('Scenario report', 'ru')).toBe('Отчёт по сценарию');
  });

  it('localizes remaining broker and portfolio error messages', () => {
    expect(translateText('Unknown cashflow processing error.', 'ru')).toBe('Неизвестная ошибка обработки денежных потоков.');
    expect(translateText('Automatic Freedom cashflow sync failed: Network error', 'ru'))
      .toBe('Не удалось автоматически синхронизировать денежные потоки Freedom: Network error');
    expect(translateText('Unable to load active TradeNet orders: Timeout', 'ru'))
      .toBe('Не удалось загрузить активные заявки TradeNet: Timeout');
    expect(translateText('Something went wrong.', 'ru')).toBe('Что-то пошло не так.');
    expect(translateText('Portfolio-wide Margin Review', 'ru')).toBe('Обзор маржинального портфеля');
    expect(translateText('Untitled news item', 'ru')).toBe('Новость без заголовка');
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
