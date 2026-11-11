import { getAppLanguage, translateText } from '../../services/i18n';

const MARKET_EVENT_RU_COPY: Record<string, string> = {
  'Upcoming and recent events': 'Предстоящие и недавние события',
  'Earnings': 'Отчётность',
  'Dividends': 'Дивиденды',
  'Daily price history': 'Дневная история цен',
  'Load daily history': 'Загрузить дневную историю',
  'Refresh history': 'Обновить историю',
  'Loading events…': 'Загрузка событий…',
  'Loading history…': 'Загрузка истории…',
  'Partial provider coverage': 'Неполные данные провайдера',
  'Events unavailable': 'События недоступны',
  'No earnings events in this period.': 'Нет событий отчётности за этот период.',
  'Earnings unavailable': 'Данные об отчётности недоступны',
  'No dividend events in this period.': 'Нет дивидендных событий за этот период.',
  'Dividends unavailable': 'Данные о дивидендах недоступны',
  'Daily history unavailable': 'Дневная история недоступна',
  'Finnhub history unavailable; daily candles were loaded from Freedom TradeNet.': 'История Finnhub недоступна; дневные свечи загружены из Freedom TradeNet.',
  'No historical prices loaded.': 'Исторические цены не загружены.',
  'Observed time unavailable': 'Время наблюдения недоступно',
  'Received': 'Получено',
  'Estimate': 'Оценка',
  'Actual': 'Факт',
  'Ex-date': 'Дата отсечки',
  'Amount unavailable': 'Сумма недоступна',
  'Before market': 'До открытия рынка',
  'After market': 'После закрытия рынка',
  'During market': 'Во время торгов',
  'Timing unavailable': 'Время неизвестно',
  'Currency unknown; no conversion applied.': 'Валюта неизвестна; пересчёт не выполнялся.',
  'Exchange coverage is incomplete; freshness remains unknown.': 'Календарь биржи неполный; свежесть данных неизвестна.',
  'Corporate actions': 'Корпоративные действия',
  'Stock splits and reverse splits': 'Дробления и обратные дробления акций',
  'Corporate-action data unavailable': 'Данные о корпоративных действиях недоступны',
  'No verified split events in this period.': 'В этом периоде нет подтверждённых событий дробления.',
  'Apply split to open position': 'Применить дробление к открытой позиции',
  'Split already applied': 'Дробление уже применено',
  'Review required': 'Требуется проверка',
  'Split applied; cost basis preserved.': 'Дробление применено; себестоимость сохранена.',
  'Split evidence saved for review. No position or cash was changed.': 'Данные о дроблении сохранены для проверки. Позиция и денежные средства не изменены.',
  'Could not save this corporate action.': 'Не удалось сохранить это корпоративное действие.',
  'Apply the verified share ratio to every eligible pre-action lot? Total acquisition cost will remain unchanged. No cash receipt or investment profit will be created.': 'Применить подтверждённое соотношение ко всем подходящим лотам до даты действия? Общая себестоимость останется неизменной. Денежное поступление или инвестиционная прибыль не создаются.',
  'Dividend events are evidence only; cash is recorded when broker settlement is confirmed.': 'Дивиденды являются подтверждающими данными; денежное поступление учитывается после подтверждения расчёта брокером.',
  'Effective date': 'Дата вступления в силу',
  'Share ratio': 'Соотношение акций',
  'Action status': 'Статус действия',
  'Cash dividend': 'Денежный дивиденд',
  'Record dividend evidence': 'Сохранить сведения о дивиденде',
  'Dividend evidence saved': 'Сведения о дивиденде сохранены',
  'No adjustment needed': 'Корректировка не требуется',
  'Split data unavailable': 'Данные о дроблении недоступны',
  'Split': 'Дробление',
  'Reverse split': 'Обратное дробление',
  'Correct close': 'Исправить закрытие',
  'Save correction': 'Сохранить исправление',
  'Cancel': 'Отмена',
  'Corrected': 'Исправлено',
  'Reason for correction': 'Причина исправления',
  'New close price': 'Новая цена закрытия',
  'Enter a corrected close and a reason.': 'Укажите исправленную цену закрытия и причину.',
  'Correction saved to history.': 'Исправление сохранено в истории.',
  'Could not save history correction.': 'Не удалось сохранить исправление истории.',
  'History correction needs review; provider prices are shown unchanged.': 'Исправление истории требует проверки; показаны исходные цены провайдера.',
  'Manual corrections affect this history list only; saved portfolio valuations and P&L are not rewritten.': 'Ручные исправления влияют только на этот список истории; сохранённые оценки портфеля и P&L не изменяются.',
  'Manual correction': 'Ручное исправление'
};

export function marketEventLabel(value: string, language = getAppLanguage()): string {
  return language === 'ru' ? MARKET_EVENT_RU_COPY[value] || translateText(value, 'ru') : value;
}

export function formatMarketEventDate(value: string, language = getAppLanguage()): string {
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    })
    : value;
}

export function marketEventTimingLabel(value: string, language = getAppLanguage()): string {
  switch (value) {
    case 'before_market': return marketEventLabel('Before market', language);
    case 'after_market': return marketEventLabel('After market', language);
    case 'during_market': return marketEventLabel('During market', language);
    default: return marketEventLabel('Timing unavailable', language);
  }
}
