import { h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { getAppLanguage, setAppLanguage, subscribeAppLanguage, translateText } from './i18n';

afterEach(() => setAppLanguage('en'));

describe('app localization', () => {
  it('defaults to English', () => {
    expect(getAppLanguage()).toBe('en');
    expect(translateText('Sign out')).toBe('Sign out');
  });

  it('translates Balance background sync states into Russian', () => {
    expect(translateText('Refreshing balance…', 'ru')).toBe('Обновление баланса…');
    expect(translateText('Syncing…', 'ru')).toBe('Синхронизация…');
    expect(translateText('Retry balance refresh', 'ru')).toBe('Повторить обновление баланса');
  });

  it('localizes Market Insights refresh and recovery actions', () => {
    expect(translateText('Failed to load insights: ', 'ru')).toBe('Не удалось загрузить рыночную аналитику: ');
    expect(translateText('Refresh market data', 'ru')).toBe('Обновить рыночные данные');
    expect(translateText('Retry market data refresh', 'ru')).toBe('Повторить обновление рыночных данных');
    expect(translateText('Refresh failed; showing previously loaded market data.', 'ru'))
      .toBe('Не удалось обновить данные; показаны ранее загруженные рыночные данные.');
  });

  it('localizes unpriced cash holding guidance', () => {
    expect(translateText('Unpriced holdings', 'ru')).toBe('Позиции без котировки');
    expect(translateText('Their market value and allocation are unavailable until a valid quote is received.', 'ru'))
      .toBe('Их рыночная стоимость и доля распределения недоступны до получения действительной котировки.');
    expect(translateText('Priced market value', 'ru')).toBe('Рыночная стоимость позиций с котировкой');
  });

  it('localizes the administrator equity badge description', () => {
    expect(translateText('Current portfolio equity from available market quotes and broker cash balance.', 'ru'))
      .toBe('Текущий капитал портфеля по доступным рыночным котировкам и денежному балансу брокера.');
  });

  it('localizes unavailable margin valuation guidance', () => {
    expect(translateText('Unrealized return unavailable', 'ru')).toBe('Нереализованная доходность недоступна');
    expect(translateText('Unpriced positions', 'ru')).toBe('Позиции без котировки');
    expect(translateText('Market valuation incomplete', 'ru')).toBe('Рыночная оценка неполная');
    expect(translateText('Margin risk estimate unavailable until every holding has a valid market quote.', 'ru'))
      .toBe('Оценка маржинального риска недоступна, пока для всех активов не получены корректные рыночные котировки.');
  });

  it('localizes portfolio quote coverage labels', () => {
    expect(translateText('Fresh', 'ru')).toBe('Свежие');
    expect(translateText('Stale', 'ru')).toBe('Устарело');
    expect(translateText('Delayed', 'ru')).toBe('С задержкой');
    expect(translateText('Time unknown', 'ru')).toBe('Время неизвестно');
    expect(translateText('Not fetched', 'ru')).toBe('Не получено');
    expect(translateText('Margin quote coverage', 'ru')).toBe('Покрытие котировками маржинальных позиций');
    expect(translateText('No margin positions', 'ru')).toBe('Нет маржинальных позиций');
  });

  it('translates known UI copy into Russian and leaves unknown text unchanged', () => {
    expect(translateText('User management', 'ru')).toBe('Управление пользователями');
    expect(translateText('Settings', 'ru')).toBe('Настройки');
    expect(translateText('Unknown market symbol', 'ru')).toBe('Unknown market symbol');
    expect(translateText('Cash-funded stock holdings', 'ru')).toBe('Акции, приобретённые за денежные средства');
    expect(translateText('Active tranches and guest assignments', 'ru')).toBe('Активные лоты и назначения гостям');
    expect(translateText('User management table', 'ru')).toBe('Таблица управления пользователями');
    expect(translateText('Bid prices and quantities', 'ru')).toBe('Цены и объёмы заявок на покупку');
    expect(translateText('Ask prices and quantities', 'ru')).toBe('Цены и объёмы заявок на продажу');
  });

  it('localizes the keyboard-scrollable guest assignment table region', () => {
    setAppLanguage('ru');
    const region = h('div', {
      role: 'region',
      'aria-label': 'Guest assignment history table',
      tabindex: 0
    });
    expect(region.props.role).toBe('region');
    expect(region.props['aria-label']).toBe('Таблица истории назначений гостю');
    expect(region.props.tabindex).toBe(0);
  });

  it('translates text and accessible labels when Preact nodes are created', () => {
    setAppLanguage('ru');
    const vnode = h('button', { title: 'Settings', 'aria-label': 'Settings' }, 'Settings');
    expect(vnode.props.children).toBe('Настройки');
    expect(vnode.props.title).toBe('Настройки');
    expect(vnode.props['aria-label']).toBe('Настройки');
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

  it('localizes the data-loss consequences of manual cloud pull and full reset', () => {
    expect(translateText("Pull cloud replaces this device's local portfolio with the shared KV cloud snapshot. Changes that have not synced can be lost.", 'ru'))
      .toBe('Загрузка из облака заменяет локальный портфель на этом устройстве общей версией из облака KV. Несинхронизированные изменения могут быть потеряны.');
    expect(translateText("Reset deletes saved portfolio and history data from this device and KV cloud. TradeNet records held by the broker are not deleted.", 'ru'))
      .toBe('Сброс удаляет сохранённые данные портфеля и историю на этом устройстве и в облаке KV. Записи TradeNet у брокера не удаляются.');
    expect(translateText("Export a JSON backup before pulling cloud state or resetting the portfolio.", 'ru'))
      .toBe('Перед загрузкой из облака или сбросом портфеля экспортируйте резервную копию JSON.');
    expect(translateText("Pulling cloud will replace this device's local portfolio with the shared KV cloud snapshot. Any changes that have not synced can be lost. Export a JSON backup first if you may need them. Continue?", 'ru'))
      .toBe('Загрузка из облака заменит локальный портфель на этом устройстве общей версией из облака KV. Несинхронизированные изменения могут быть потеряны. Сначала экспортируйте резервную копию JSON, если эти данные могут понадобиться. Продолжить?');
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
    expect(translateText('Date', 'ru')).toBe('Дата');
    expect(translateText('Date from', 'ru')).toBe('Дата с');
    expect(translateText('Date to', 'ru')).toBe('Дата по');
    expect(translateText('Value', 'ru')).toBe('Стоимость');
    expect(translateText('Net P&L', 'ru')).toBe('Чистая прибыль/убыток');
    expect(translateText('No assignments match these filters.', 'ru'))
      .toBe('Нет назначений, соответствующих выбранным фильтрам.');
    expect(translateText("Value shows current market value for open tranches and gross sale proceeds for closed trades. Net P&L appears only when the closed trade's net result is available.", 'ru'))
      .toBe('В столбце «Стоимость» показана текущая рыночная стоимость открытых лотов и валовая выручка от продажи закрытых сделок. Чистая прибыль/убыток отображается только при наличии итоговых данных закрытой сделки.');
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
    expect(translateText('No stocks are assigned to your account yet.', 'ru')).toBe('В вашей учётной записи пока нет назначенных акций.');
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

  it('localizes active-order refresh warnings', () => {
    expect(translateText('Freedom active orders are unavailable — existing position targets are unchanged.', 'ru'))
      .toBe('Активные заявки Freedom недоступны — целевые цены позиций оставлены без изменений.');
    expect(translateText('[Freedom Warning] Active-order refresh failed; existing position targets were left unchanged.', 'ru'))
      .toBe('[Предупреждение Freedom] Не удалось обновить активные заявки; целевые цены позиций оставлены без изменений.');
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

  it('localizes terminal badges, external links, and portfolio valuation summaries', () => {
    expect(translateText('ERROR', 'ru')).toBe('ОШИБКА');
    expect(translateText('INFO', 'ru')).toBe('ИНФО');
    expect(translateText('SIM', 'ru')).toBe('СИМУЛЯЦИЯ');
    expect(translateText('COMPARISON', 'ru')).toBe('СРАВНЕНИЕ');
    expect(translateText('BROKER', 'ru')).toBe('БРОКЕР');
    expect(translateText('BALANCE', 'ru')).toBe('БАЛАНС');
    expect(translateText('TV Chart', 'ru')).toBe('График TradingView');
    expect(translateText('TV Ideas', 'ru')).toBe('Идеи TradingView');
    expect(translateText('Open AAPL on TV Chart in a new tab', 'ru'))
      .toBe('Открыть AAPL через График TradingView в новой вкладке');
    expect(translateText('Latest portfolio quote · Updated 1m ago', 'ru'))
      .toBe('Последняя котировка портфеля · Обновлено 1m ago');
    expect(translateText('$12,000 | Across 2 Assets', 'ru')).toBe('$12,000 | По 2 активам');
    expect(translateText('AAPL: 10sh @ PT $200 | MSFT: 5sh @ PT $450', 'ru'))
      .toBe('AAPL: 10 акц. @ ЦУ $200 | MSFT: 5 акц. @ ЦУ $450');
  });

  it('localizes remaining market-data hints and computed margin-risk summaries', () => {
    expect(translateText('Check that FREEDOM_PUBLIC_KEY and FREEDOM_PRIVATE_KEY are configured as Cloudflare Worker secrets. Never expose the private key in browser code.', 'ru'))
      .toBe('Проверьте, что FREEDOM_PUBLIC_KEY и FREEDOM_PRIVATE_KEY заданы как секреты Cloudflare Worker. Никогда не раскрывайте закрытый ключ в клиентском коде.');
    expect(translateText('TBD', 'ru')).toBe('Пока неизвестно');
    expect(translateText('No margin debt', 'ru')).toBe('Нет маржинального долга');
    expect(translateText('negative equity', 'ru')).toBe('отрицательный собственный капитал');
    expect(translateText('Healthy · 75.0% equity (25.0% maintenance)', 'ru'))
      .toBe('Норма · 75.0% собственного капитала (25.0% по нормативу поддерживающей маржи)');
    expect(translateText('Elevated · 32.0% equity (25.0% maintenance)', 'ru'))
      .toBe('Повышенный риск · 32.0% собственного капитала (25.0% по нормативу поддерживающей маржи)');
  });

  it('localizes terminal and CLI feedback while preserving command values', () => {
    expect(translateText('Please replace [shares] with a value before running this command.', 'ru'))
      .toBe('Замените [shares] на значение перед выполнением команды.');
    expect(translateText('Switched view to CASH_CUSHION.', 'ru'))
      .toBe('Выполнено переключение на раздел Баланс.');
    expect(translateText('Sold 2 AAPL @ $190.00', 'ru'))
      .toBe('Продано 2 акций AAPL по цене $190.00.');
    expect(translateText('Added 5 MSFT to cash holdings @ $420.00.', 'ru'))
      .toBe('В денежные активы добавлено 5 акций MSFT по цене $420.00.');
    expect(translateText('Only administrators can reset the portfolio.', 'ru'))
      .toBe('Только администраторы могут сбрасывать портфель.');
    expect(translateText('[System]: Live market quotes refreshed for 4 assets.', 'ru'))
      .toBe('[Система]: Обновлены актуальные рыночные котировки для 4 активов.');
    expect(translateText('[Backup]: Exported state to portfolio.json.', 'ru'))
      .toBe('[Резервная копия]: Состояние экспортировано в файл portfolio.json.');
    expect(translateText('[Backup Import]: Imported backup.json into this browser. Check KV cloud status for sync results.', 'ru'))
      .toBe('[Импорт резервной копии]: Файл backup.json импортирован в этот браузер. Проверьте состояние синхронизации с облаком KV.');
    expect(translateText('[Guest Portfolio Sync Error]: Assigned holdings and history could not be refreshed.', 'ru'))
      .toBe('Ошибка синхронизации гостевого портфеля: Не удалось обновить назначенные активы и историю.');
  });

  it('localizes multiline terminal outputs line by line', () => {
    expect(translateText('Terminal cleared.\nRefreshing all live quotes...', 'ru'))
      .toBe('Терминал очищен.\nОбновление всех актуальных котировок…');
  });

  it('localizes detailed portfolio execution and synchronization logs', () => {
    expect(translateText('[Guest Portfolio Sync Error]: Assigned holdings and history could not be refreshed.', 'ru'))
      .toBe('Ошибка синхронизации гостевого портфеля: Не удалось обновить назначенные активы и историю.');
    expect(translateText('[Warning]: No quotes updated during batch fetch.', 'ru'))
      .toBe('[Предупреждение]: Не удалось обновить ни одной котировки в пакетном запросе.');
    expect(translateText('[Settings Error]: Could not load saved broker assumptions (network). Using defaults.', 'ru'))
      .toBe('[Ошибка настроек]: Не удалось загрузить сохранённые параметры брокера (network). Используются значения по умолчанию.');
    expect(translateText('[Executed Buy]: Added 10 AAPL @ $180.00. Outlay: $1,802.00 (Comm: $2.00). Funded: $1,000.00 cash | +$802.00 margin debt. Free Cash remaining: $0.00. Total Margin Debt: -$1,000.00 (was -$198.00).', 'ru'))
      .toBe('[Покупка выполнена]: Добавлено 10 AAPL @ $180.00. Сумма: $1,802.00 (комиссия: $2.00). Оплачено денежными средствами: $1,000.00 | +маржинальный долг: $802.00. Остаток свободных средств: $0.00. Общий маржинальный долг: -$1,000.00 (до операции: -$198.00).');
    expect(translateText('[Cash Holding Closed]: Sold 5 MSFT @ $420.00. Net credited: +$2,098.00 (Debt paid: $1,000.00, Free Cash added: $1,098.00).', 'ru'))
      .toBe('[Денежная позиция закрыта]: Продано 5 акций MSFT @ $420.00. Зачислено чистыми: +$2,098.00 (погашение долга: $1,000.00, добавлено свободных средств: $1,098.00).');
    expect(translateText('[Balance]: Removed AAPL from balance holdings.', 'ru'))
      .toBe('[Баланс]: AAPL удалён из активов баланса.');
  });

  it('localizes broker errors and scenario-independent price updates', () => {
    expect(translateText('[Market Data Error]: Could not fetch AAPL. Timeout. Retained tracked price: $180.00. Set manually via: price AAPL <number>.', 'ru'))
      .toBe('[Ошибка рыночных данных]: Не удалось получить котировку AAPL. Timeout. Сохранена отслеживаемая цена: $180.00. Установить вручную: price AAPL <number>.');
    expect(translateText('[Target Updated]: AAPL PT updated to $210.00.', 'ru'))
      .toBe('[Целевая цена обновлена]: Целевая цена AAPL установлена на $210.00.');
    expect(translateText('[Price Updated]: MSFT market price set to $420.00.', 'ru'))
      .toBe('[Цена обновлена]: Рыночная цена MSFT установлена на $420.00.');
    expect(translateText('[Margin Synced]: Total margin balance explicitly set to -$1,500.00.', 'ru'))
      .toBe('[Маржинальный баланс синхронизирован]: Общий маржинальный баланс установлен на -$1,500.00.');
    expect(translateText('[CLI]: Unrecognized command. Type "help" for local commands, or prefix with "ask ..." for AI advisor.', 'ru'))
      .toBe('[Команда]: Неизвестная команда. Введите "help" для локальных команд или добавьте префикс "ask ..." для обращения к ИИ-советнику.');
  });

  it('localizes multiline scenario reports and their dynamic labels', () => {
    expect(translateText('[EXIT COMPARISON: AAPL]', 'ru'))
      .toBe('[СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА: AAPL]');
    expect(translateText('[BUY MORE: MSFT]', 'ru')).toBe('[ДОПОЛНИТЕЛЬНАЯ ПОКУПКА: MSFT]');
    expect(translateText('Today · $190.00 → +$100.00 net P&L · BEST', 'ru'))
      .toBe('Сегодня · $190.00 → +$100.00 чистая прибыль/убыток · ЛУЧШИЙ');
    expect(translateText('BEST: today at $190.00 · +$100.00 net', 'ru'))
      .toBe('ЛУЧШИЙ: сегодня по цене $190.00 · +$100.00 чистыми');
    expect(translateText('Fees included: buy commission, sell commission, estimated margin interest.', 'ru'))
      .toBe('Учтённые расходы: комиссия за покупку, комиссия за продажу, расчётные проценты по марже.');
    expect(translateText('Today vs 14 Days', 'ru')).toBe('сегодня и 14 дн.');
    expect(translateText('Hypothetical projection after buying +5 shares at $180.00 · no order placed', 'ru'))
      .toBe('Гипотетический прогноз после покупки +5 акций по цене $180.00 · ордер не отправляется.');
    expect(translateText('NOW Net', 'ru')).toBe('Чистый результат сейчас');
    expect(translateText('Total Fee Friction', 'ru')).toBe('Общие комиссии и расходы');
    expect(translateText('Estimate only · no portfolio changes.', 'ru'))
      .toBe('Только оценка · портфель не изменяется.');
  });

  it('localizes command help examples and simulation output', () => {
    expect(translateText('Usage: compare exits [TICKER] today at 190, tomorrow at 191, after 4 days at 193, in 2 weeks at 195, 1 month later at 200', 'ru'))
      .toBe('Формат: compare exits [TICKER] today at 190, tomorrow at 191, after 4 days at 193, in 2 weeks at 195, 1 month later at 200');
    expect(translateText('Select a ticker tab or specify a ticker (e.g., "sell AAPL today for $180 vs sell 14 days later for $185").', 'ru'))
      .toBe('Выберите вкладку тикера или укажите тикер (например, "sell AAPL today for $180 vs sell 14 days later for $185").');
    expect(translateText('• bought <shares> <ticker> for <price> (e.g. bought 10 AAPL for $185.50)', 'ru'))
      .toBe('• bought <shares> <ticker> for <price> (например, bought 10 AAPL for $185.50)');
    expect(translateText('[Sim AAPL @ $205.00 in 14d]: Gross $200.00 | Comms -$4.00 | Margin -$3.00 → Net P&L: +$193.00', 'ru'))
      .toBe('[Симуляция AAPL @ $205.00 через 14 дн.]: Валовая прибыль: $200.00 | Комиссии: -$4.00 | Маржинальные проценты: -$3.00 → Чистая прибыль/убыток: +$193.00');
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
