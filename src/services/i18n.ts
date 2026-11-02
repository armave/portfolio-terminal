import { options, type VNode } from 'preact';
import { RU_TRANSLATIONS } from './i18n-ru';

export type AppLanguage = 'en' | 'ru';

const EN_DOCUMENT_TITLE = 'Margin Portfolio Terminal — Tradernet Armenia Edition';
const RU_DOCUMENT_TITLE = 'Маржинальный портфель — терминал Tradernet (Армения)';

/** Exact UI copy translations. Dynamic portfolio values and user-entered data are left untouched. */
const RU = RU_TRANSLATIONS;

const TEXT_ATTRIBUTES = ['aria-label', 'alt', 'placeholder', 'title', 'label', 'data-tooltip'] as const;
let currentLanguage: AppLanguage = 'en';
const languageListeners = new Set<(language: AppLanguage) => void>();

export function getAppLanguage(): AppLanguage {
  return currentLanguage;
}

function russianPlural(value: number, one: string, few: string, many: string): string {
  const lastTwo = value % 100;
  const last = value % 10;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

function translateDynamicText(normalized: string): string | undefined {
  const replaceCommandHelp = normalized.match(/^Please replace \[(.+)\] with a value before running this command\.$/i);
  if (replaceCommandHelp) return 'Замените [' + replaceCommandHelp[1] + '] на значение перед выполнением команды.';

  const switchedView = normalized.match(/^Switched view to (.+)\.$/i);
  if (switchedView) {
    const viewNames: Record<string, string> = {
      COMBINED: 'Общий портфель',
      CASH_CUSHION: 'Баланс',
      BALANCE: 'Баланс',
      SETTINGS: 'Настройки',
      CLOSED_HISTORY: 'История закрытых сделок',
      GUEST_HISTORY: 'Лоты'
    };
    return 'Выполнено переключение на раздел ' + (viewNames[switchedView[1]] || switchedView[1]) + '.';
  }

  const invalidCalendarDate = normalized.match(/^Invalid calendar date "(.+)"\. Use YYYY-MM-DD or "Mar 25"\.$/i);
  if (invalidCalendarDate) return 'Некорректная календарная дата "' + invalidCalendarDate[1] + '". Используйте ГГГГ-ММ-ДД или "Mar 25".';
  const invalidDate = normalized.match(/^Invalid date "(.+)"\. Use YYYY-MM-DD or "Mar 25"\.$/i);
  if (invalidDate) return 'Некорректная дата "' + invalidDate[1] + '". Используйте ГГГГ-ММ-ДД или "Mar 25".';
  const unrecognizedDate = normalized.match(/^Unrecognized date "(.+)"\. Try "on YYYY-MM-DD", "on Mar 25", "yesterday", or "3 days ago"\.$/i);
  if (unrecognizedDate) return 'Не удалось распознать дату "' + unrecognizedDate[1] + '". Используйте "on YYYY-MM-DD", "on Mar 25", "yesterday" или "3 days ago".';
  const unrecognizedExitDate = normalized.match(/^Unrecognized exit date:\s*(.+)$/i);
  if (unrecognizedExitDate) return 'Не удалось распознать дату выхода: ' + unrecognizedExitDate[1];

  const noOpenPosition = normalized.match(/^No open position found for (.+)\.$/i);
  if (noOpenPosition) return 'Не найдена открытая позиция ' + noOpenPosition[1] + '.';
  const noOpenScenarioPosition = normalized.match(/^No open position found for (.+)\. Buy scenarios require an existing position\.$/i);
  if (noOpenScenarioPosition) return 'Не найдена открытая позиция ' + noOpenScenarioPosition[1] + '. Для сценария покупки нужна существующая позиция.';
  const noOpenShares = normalized.match(/^No valid open shares found for (.+)\.$/i);
  if (noOpenShares) return 'Не найдено допустимое количество открытых акций для ' + noOpenShares[1] + '.';

  const sold = normalized.match(/^Sold ([\d,.]+) ([A-Z0-9.-]+) @ \$(\d+(?:\.\d{2})?)$/i);
  if (sold) return 'Продано ' + sold[1] + ' акций ' + sold[2] + ' по цене $' + sold[3] + '.';

  const settingsLoadError = normalized.match(/^\[Settings Error\]: Could not load saved broker assumptions \((.+)\)\. Using defaults\.$/i);
  if (settingsLoadError) return '[Ошибка настроек]: Не удалось загрузить сохранённые параметры брокера (' + settingsLoadError[1] + '). Используются значения по умолчанию.';

  const marketDataFailure = normalized.match(/^\[Market Data Error\]: Could not fetch (.+)\. (.+)\. Retained tracked price: (.+)\. Set manually via: price (.+) <number>\.$/i);
  if (marketDataFailure) return '[Ошибка рыночных данных]: Не удалось получить котировку ' + marketDataFailure[1] +
    '. ' + marketDataFailure[2] + '. Сохранена отслеживаемая цена: ' + marketDataFailure[3] +
    '. Установить вручную: price ' + marketDataFailure[4] + ' <number>.';

  const unsupportedAiAction = normalized.match(/^\[AI Action Error\]: Unsupported action "(.+)"\. No changes were made\.$/i);
  if (unsupportedAiAction) return '[Ошибка действия ИИ]: Неподдерживаемое действие "' + unsupportedAiAction[1] + '". Изменения не внесены.';

  const executedBuy = normalized.match(/^\[Executed Buy\]: Added (.+?) (.+?) @ (.+?)\. Outlay: (.+?) \(Comm: (.+?)\)\. Funded: (.+?) cash \| \+(.+?) margin debt\. Free Cash remaining: (.+?)\. Total Margin Debt: -(.+?) \(was -(.+?)\)\.$/i);
  if (executedBuy) return '[Покупка выполнена]: Добавлено ' + executedBuy[1] + ' ' + executedBuy[2] +
    ' @ ' + executedBuy[3] + '. Сумма: ' + executedBuy[4] + ' (комиссия: ' + executedBuy[5] +
    '). Оплачено денежными средствами: ' + executedBuy[6] + ' | +маржинальный долг: ' + executedBuy[7] +
    '. Остаток свободных средств: ' + executedBuy[8] + '. Общий маржинальный долг: -' + executedBuy[9] + ' (до операции: -' + executedBuy[10] + ').';

  const cashClosed = normalized.match(/^\[Cash Holding Closed\]: Sold ([\d,.]+) ([A-Z0-9.-]+) @ (.+?)\. Net credited: \+(.+?) \(Debt paid: (.+?), Free Cash added: (.+?)\)\.$/i);
  if (cashClosed) return '[Денежная позиция закрыта]: Продано ' + cashClosed[1] + ' акций ' + cashClosed[2] +
    ' @ ' + cashClosed[3] + '. Зачислено чистыми: +' + cashClosed[4] +
    ' (погашение долга: ' + cashClosed[5] + ', добавлено свободных средств: ' + cashClosed[6] + ').';

  const cashPartial = normalized.match(/^\[Cash Holding Partial Sell\]: Sold ([\d,.]+) ([A-Z0-9.-]+) @ (.+?)\. Remaining: (.+?) shares\. Net credited: \+(.+?) \(Debt paid: (.+?), Free Cash added: (.+?)\)\.$/i);
  if (cashPartial) return '[Частичная продажа денежной позиции]: Продано ' + cashPartial[1] + ' акций ' + cashPartial[2] +
    ' @ ' + cashPartial[3] + '. Остаток: ' + cashPartial[4] + ' акций. Зачислено чистыми: +' + cashPartial[5] +
    ' (погашение долга: ' + cashPartial[6] + ', добавлено свободных средств: ' + cashPartial[7] + ').';

  const positionClosed = normalized.match(/^\[Position Closed\]: Sold ([\d,.]+) ([A-Z0-9.-]+) @ (.+?)\. Net credited: \+(.+?) \(Debt paid: (.+?), Free Cash added: (.+?)\)\. Remaining Debt: -(.+?)\. Free Cash: (.+?)\.$/i);
  if (positionClosed) return '[Позиция закрыта]: Продано ' + positionClosed[1] + ' акций ' + positionClosed[2] +
    ' @ ' + positionClosed[3] + '. Зачислено чистыми: +' + positionClosed[4] +
    ' (погашение долга: ' + positionClosed[5] + ', добавлено свободных средств: ' + positionClosed[6] +
    '). Остаток долга: -' + positionClosed[7] + '. Свободные средства: ' + positionClosed[8] + '.';

  const partialSell = normalized.match(/^\[Partial Sell\]: Sold ([\d,.]+) ([A-Z0-9.-]+) @ (.+?)\. Net credited: \+(.+?) \(Debt paid: (.+?), Free Cash added: (.+?)\)\. Remaining: (.+?) shares\.$/i);
  if (partialSell) return '[Частичная продажа]: Продано ' + partialSell[1] + ' акций ' + partialSell[2] +
    ' @ ' + partialSell[3] + '. Зачислено чистыми: +' + partialSell[4] +
    ' (погашение долга: ' + partialSell[5] + ', добавлено свободных средств: ' + partialSell[6] +
    '). Остаток: ' + partialSell[7] + ' акций.';

  const targetUpdate = normalized.match(/^\[Target Updated\]: (.+) PT updated to (.+)\.$/i);
  if (targetUpdate) return '[Целевая цена обновлена]: Целевая цена ' + targetUpdate[1] + ' установлена на ' + targetUpdate[2] + '.';
  const priceUnchanged = normalized.match(/^\[Price Unchanged\]: No valid price amount supplied\. Enter: price (.+) <number>\.$/i);
  if (priceUnchanged) return '[Цена не изменена]: Не указана корректная цена. Введите: price ' + priceUnchanged[1] + ' <number>.';
  const priceUpdated = normalized.match(/^\[Price Updated\]: (.+) market price set to (.+)\.$/i);
  if (priceUpdated) return '[Цена обновлена]: Рыночная цена ' + priceUpdated[1] + ' установлена на ' + priceUpdated[2] + '.';
  const marginSynced = normalized.match(/^\[Margin Synced\]: Total margin balance explicitly set to -(.+)\.$/i);
  if (marginSynced) return '[Маржинальный баланс синхронизирован]: Общий маржинальный баланс установлен на -' + marginSynced[1] + '.';

  const cashAdded = normalized.match(/^Added ([\d,.]+) ([A-Z0-9.-]+) to cash holdings(?: @ \$(.+))?\.$/i);
  if (cashAdded) return 'В денежные активы добавлено ' + cashAdded[1] + ' акций ' + cashAdded[2] +
    (cashAdded[3] ? ' по цене $' + cashAdded[3] : '') + '.';
  const cashRemoved = normalized.match(/^Removed ([A-Z0-9.-]+) from cash holdings\.$/i);
  if (cashRemoved) return 'Акции ' + cashRemoved[1] + ' удалены из денежных активов.';

  const balanceUpdated = normalized.match(/^\[Balance\]: Current balance\/debt updated\. Balance: (.+) \| Margin debt: -(.+)\.$/i);
  if (balanceUpdated) return '[Баланс]: Баланс и долг обновлены. Баланс: ' + balanceUpdated[1] + ' | Маржинальный долг: -' + balanceUpdated[2] + '.';
  const balanceAdded = normalized.match(/^\[Balance\]: Added (.+) (.+) to balance holdings\. Syncing online quote\.\.\.$/i);
  if (balanceAdded) return '[Баланс]: В активы баланса добавлено ' + balanceAdded[1] + ' ' + balanceAdded[2] + '. Синхронизация онлайн-котировки…';
  const balanceRemoved = normalized.match(/^\[Balance\]: Removed (.+) from balance holdings\.$/i);
  if (balanceRemoved) return '[Баланс]: ' + balanceRemoved[1] + ' удалён из активов баланса.';

  const hypotheticalSubtitle = normalized.match(/^Hypothetical projection after buying \+(.+) shares at (.+) · no order placed$/i);
  if (hypotheticalSubtitle) return 'Гипотетический прогноз после покупки +' + hypotheticalSubtitle[1] + ' акций по цене ' + hypotheticalSubtitle[2] + ' · ордер не отправляется.';

  const exitPreset = normalized.match(/^(.+) vs (.+)$/i);
  if (exitPreset && (/^today$/i.test(exitPreset[1]) || /\d+\s+days?/i.test(exitPreset[1]))) {
    const day = (value: string) => /^today$/i.test(value) ? 'сегодня' : translateText(value, 'ru');
    return day(exitPreset[1]) + ' и ' + day(exitPreset[2]);
  }

  const exitReportHeader = normalized.match(/^\[(EXIT COMPARISON|MULTI-DATE EXIT COMPARISON|STAGED EXIT):\s*(.+)\]$/i);
  if (exitReportHeader) {
    const labels: Record<string, string> = {
      'EXIT COMPARISON': 'СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА',
      'MULTI-DATE EXIT COMPARISON': 'СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА ПО ДАТАМ',
      'STAGED EXIT': 'ПОЭТАПНЫЙ ВЫХОД'
    };
    return '[' + labels[exitReportHeader[1].toUpperCase()] + ': ' + exitReportHeader[2] + ']';
  }
  const buyReportHeader = normalized.match(/^\[BUY MORE:\s*(.+)\]$/i);
  if (buyReportHeader) return '[ДОПОЛНИТЕЛЬНАЯ ПОКУПКА: ' + buyReportHeader[1] + ']';

  const exitResultLine = normalized.match(/^(.+?) · (\$[\d,.]+) → ([+-]?\$[\d,.]+) net P&L( · BEST)?$/i);
  if (exitResultLine) {
    const day = /^today$/i.test(exitResultLine[1]) ? 'Сегодня' : translateText(exitResultLine[1], 'ru');
    return day + ' · ' + exitResultLine[2] + ' → ' + exitResultLine[3] + ' чистая прибыль/убыток' +
      (exitResultLine[4] ? ' · ЛУЧШИЙ' : '');
  }
  const bestExit = normalized.match(/^BEST: (.+) at (\$[\d,.]+) · ([+-]?\$[\d,.]+) net$/i);
  if (bestExit) return 'ЛУЧШИЙ: ' + (/^today$/i.test(bestExit[1]) ? 'сегодня' : translateText(bestExit[1], 'ru')) + ' по цене ' + bestExit[2] + ' · ' + bestExit[3] + ' чистыми';
  const feeNote = normalized.match(/^Fees included: (.+)\.$/i);
  if (feeNote) return 'Учтённые расходы: ' + feeNote[1]
    .replace(/buy commission/gi, 'комиссия за покупку')
    .replace(/sell commission/gi, 'комиссия за продажу')
    .replace(/estimated margin interest/gi, 'расчётные проценты по марже') + '.';

  const buyScenarioLine = normalized.match(/^Cash needed: (.+) incl\. fee$/i);
  if (buyScenarioLine) return 'Необходимая сумма: ' + buyScenarioLine[1] + ' включая комиссию';
  const averageEntry = normalized.match(/^Average entry: (.+) → (.+)$/i);
  if (averageEntry) return 'Средняя цена входа: ' + averageEntry[1] + ' → ' + averageEntry[2];
  const netPnlAt = normalized.match(/^Net P&L at (quote|target|-10%): (.+) → (.+)$/i);
  if (netPnlAt) {
    const label = netPnlAt[1].toLowerCase() === 'quote' ? 'текущей котировке' :
      netPnlAt[1].toLowerCase() === 'target' ? 'целевой цене' : 'снижении на 10%';
    return 'Чистая прибыль/убыток при ' + label + ': ' + netPnlAt[2] + ' → ' + netPnlAt[3];
  }
  const finalMarginBalance = normalized.match(/^Final margin balance: (.+) → (.+)$/i);
  if (finalMarginBalance) return 'Итоговый маржинальный баланс: ' + finalMarginBalance[1] + ' → ' + finalMarginBalance[2];
  const extraMarginCost = normalized.match(/^Extra margin cost: (.+)\/day$/i);
  if (extraMarginCost) return 'Дополнительные расходы по марже: ' + extraMarginCost[1] + '/день';
  const tradeoff = normalized.match(/^Trade-off: quote P&L changes by (.+); downside P&L changes by (.+)\.$/i);
  if (tradeoff) return 'Компромисс: прибыль/убыток по текущей котировке меняется на ' + tradeoff[1] +
    '; прибыль/убыток при снижении цены меняется на ' + tradeoff[2] + '.';


  const liveQuotesRefreshed = normalized.match(/^\[System\]: Live market quotes refreshed for (\d+) assets\.$/i);
  if (liveQuotesRefreshed) return '[Система]: Обновлены актуальные рыночные котировки для ' + liveQuotesRefreshed[1] + ' активов.';

  const adminAction = normalized.match(/^Only administrators can (.+)\.$/i);
  if (adminAction) {
    const actions: Record<string, string> = {
      'reset the portfolio': 'сбрасывать портфель',
      'reset broker rules': 'сбрасывать правила брокера',
      'save broker rules': 'сохранять правила брокера',
      'manage guest assignments': 'управлять назначениями гостям',
      'change guest assignments': 'изменять назначения гостям'
    };
    return 'Только администраторы могут ' + (actions[adminAction[1].toLowerCase()] || adminAction[1]) + '.';
  }

  const backupExport = normalized.match(/^\[Backup\]: Exported state to (.+)\.$/i);
  if (backupExport) return '[Резервная копия]: Состояние экспортировано в файл ' + backupExport[1] + '.';

  const backupImport = normalized.match(/^\[Backup Import\]: Imported (.+) into this browser\. Check KV cloud status for sync results\.$/i);
  if (backupImport) return '[Импорт резервной копии]: Файл ' + backupImport[1] +
    ' импортирован в этот браузер. Проверьте состояние синхронизации с облаком KV.';

  const backupError = normalized.match(/^\[Backup Error\]: Could not import backup \((.+)\)\.$/i);
  if (backupError) return '[Ошибка импорта резервной копии]: Не удалось импортировать резервную копию (' + backupError[1] + ').';
  const backupToast = normalized.match(/^Backup import failed: (.+)$/i);
  if (backupToast) return 'Не удалось импортировать резервную копию: ' + backupToast[1];

  const simulationResult = normalized.match(/^\[Sim (.+) @ \$(.+) in (\d+)d\]: Gross \$(.+) \| Comms -\$(.+) \| Margin -\$(.+) → Net P&L: ([+-])\$(.+)$/i);
  if (simulationResult) {
    return '[Симуляция ' + simulationResult[1] + ' @ $' + simulationResult[2] + ' через ' + simulationResult[3] +
      ' дн.]: Валовая прибыль: $' + simulationResult[4] + ' | Комиссии: -$' + simulationResult[5] +
      ' | Маржинальные проценты: -$' + simulationResult[6] + ' → Чистая прибыль/убыток: ' + simulationResult[7] + '$' + simulationResult[8];
  }

  const prefixes: Array<[string, string, string]> = [
    ['Name for ', 'Name for ', ''],
    ['Role for ', 'Role for ', ''],
    ['Language for ', 'Language for ', ''],
    ['New password for ', 'New password for ', ''],
    ['Updated ', 'Updated', ' '],
    ['Synced: ', 'Synced', ': '],
    ['Synced ', 'Synced', ' '],
    ['MARGIN: ', 'MARGIN', ': '],
    ['Combined Breakeven: ', 'Combined Breakeven', ': '],
    ['Exit Comparison · ', 'Exit Comparison', ' · '],
    ['Buy More Projection · ', 'Buy More Projection', ' · '],
    ['Read news: ', 'Read news', ': '],
    ['Stocktwits unavailable: ', 'Stocktwits unavailable', ': '],
    ['Quote status: ', 'Quote status', ': '],
    ['Assigned stock value: ', 'Assigned stock value', ': '],
    ['Immediately pull latest quote for ', 'Immediately pull latest quote for', ' '],
    ['Review recent news and margin-position risks for ', 'Review recent news and margin-position risks for', ' '],
    ['[AI Action Error]: ', '[AI Action Error]', ': '],
    ['[KV Cloud Error]: ', '[KV Cloud Error]', ': '],
    ['Cloud pull failed: ', 'Cloud pull failed', ': '],
    ['[Market Data Error]: ', '[Market Data Error]', ': '],
    ['[Sell Error]: ', 'Sell Error', ': '],
    ['[Freedom] Active sell target sync: ', '[Freedom] Active sell target sync', ': '],
    ['Unable to process saved closed-history cashflows: ', 'Unable to process saved closed-history cashflows', ': '],
    ['Automatic Freedom cashflow sync failed: ', 'Automatic Freedom cashflow sync failed', ': '],
    ['Freedom cashflow processing failed: ', 'Freedom cashflow processing failed', ': '],
    ['Unable to load TradeNet executed trades: ', 'Unable to load TradeNet executed trades', ': '],
    ['Unable to load active TradeNet orders: ', 'Unable to load active TradeNet orders', ': '],
    ['[Guest Portfolio Sync Error]: ', '[Guest Portfolio Sync Error]', ': '],
    ['[KV Cloud Sync Error]: ', '[KV Cloud Sync Error]', ': '],
    ['[Settings Error]: ', '[Settings Error]', ': '],
    ['[Warning]: ', '[Warning]', ': '],
    ['[Error]: ', '[Error]', ': '],
    ['[Backup]: ', '[Backup]', ': '],
    ['[Backup Import]: ', '[Backup Import]', ': '],
    ['[Backup Error]: ', '[Backup Error]', ': '],
    ['[CLI Error]: ', '[CLI Error]', ': '],
    ['[CLI]: ', '[CLI]', ': '],
    ['[AI Advisor]: ', '[AI Advisor]', ': '],
    ['[System]: ', '[System]', ': '],
  ];
  for (const [prefix, dictionaryKey, separator] of prefixes) {
    if (normalized.startsWith(prefix)) {
      return (RU[dictionaryKey] || dictionaryKey) + separator + normalized.slice(prefix.length);
    }
  }

  const latestPortfolioQuote = normalized.match(/^Latest portfolio quote · (.+)$/i);
  if (latestPortfolioQuote) {
    return RU['Latest portfolio quote'] + ' · ' + translateText(latestPortfolioQuote[1], 'ru');
  }

  const acrossAssets = normalized.match(/^(.+) \| Across (\d+) Assets$/i);
  if (acrossAssets) {
    const count = Number(acrossAssets[2]);
    return acrossAssets[1] + ' | По ' + count + (count === 1 ? ' активу' : ' активам');
  }

  const trancheSummary = normalized.split(' | ').map((part) => {
    const match = part.match(/^(.+?): ([\d,.]+)sh @ PT (.+)$/i);
    return match ? match[1] + ': ' + match[2] + ' акц. @ ЦУ ' + match[3] : part;
  });
  if (trancheSummary.some((part, index) => part !== normalized.split(' | ')[index])) {
    return trancheSummary.join(' | ');
  }

  const externalLinkLabel = normalized.match(/^Open (.+) on (.+) in a new tab$/i);
  if (externalLinkLabel) {
    const provider = RU[externalLinkLabel[2]] || externalLinkLabel[2];
    return 'Открыть ' + externalLinkLabel[1] + ' через ' + provider + ' в новой вкладке';
  }

  const missingMarginPosition = normalized.match(/^No active margin position was found for (.+)\. Select an active margin ticker and try again\.$/i);
  if (missingMarginPosition) {
    return 'Не найдена активная маржинальная позиция ' + missingMarginPosition[1] +
      '. Выберите активный маржинальный тикер и повторите попытку.';
  }

  const positionReviewTitle = normalized.match(/^(.+) · Position Review$/i);
  if (positionReviewTitle) return positionReviewTitle[1] + ' · Анализ маржинальной позиции';

  const reportTitles: Array<[string, string]> = [
    ['HYPOTHETICAL BUY:', 'ПОКУПКА В СЦЕНАРИИ:'],
    ['MULTI-DATE EXIT COMPARISON:', 'СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА ПО ДАТАМ:'],
    ['EXIT COMPARISON:', 'СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА:'],
    ['STAGED EXIT:', 'ПОЭТАПНЫЙ ВЫХОД:']
  ];
  for (const [prefix, translatedPrefix] of reportTitles) {
    if (normalized.toUpperCase().startsWith(prefix)) {
      return translatedPrefix + normalized.slice(prefix.length);
    }
  }

  const rows = normalized.match(/^Rows (.+) of (\d+)$/i);
  if (rows) return `Строки ${rows[1]} из ${rows[2]}`;
  const page = normalized.match(/^Page (\d+) of (\d+)$/i);
  if (page) return `Страница ${page[1]} из ${page[2]}`;
  const milestone = normalized.match(/^(EOW|NTD) · \+(\d+)d$/i);
  if (milestone) {
    const label = milestone[1].toUpperCase() === 'EOW' ? 'До конца недели' : 'Следующий торговый день';
    return `${label} · +${milestone[2]} дн.`;
  }
  const positionValue = normalized.match(/^Position value ([\d,]+(?:\.[\d]+)?)(?: \(already\s*([\d.,]+)% below trigger\))?$/i);
  if (positionValue) {
    return positionValue[2]
      ? `Стоимость позиции ${positionValue[1]} (уже на ${positionValue[2]}% ниже порога)`
      : `Стоимость позиции ${positionValue[1]}`;
  }

  const buffer = normalized.match(/^([\d.,]+)% buffer$/i);
  if (buffer) return 'Запас: ' + buffer[1] + '%';

  const recordRange = normalized.match(/^(\d+) [/] (\d+) records$/i);
  if (recordRange) {
    const total = Number(recordRange[2]);
    return recordRange[1] + ' / ' + recordRange[2] + ' ' + russianPlural(total, 'запись', 'записи', 'записей');
  }

  const unassigned = normalized.match(/^(· )?(\d+) unassigned$/i);
  if (unassigned) return (unassigned[1] || '') + 'Без назначения: ' + unassigned[2];

  const showTranches = normalized.match(/^Show (\d+) tranches$/i);
  if (showTranches) {
    return `Показать ${showTranches[1]} ${russianPlural(Number(showTranches[1]), 'лот', 'лота', 'лотов')}`;
  }

  const count = normalized.match(/^(\d+) (tranches|records|holdings|days|hrs|shares)$/i);
  if (count) {
    const amount = Number(count[1]);
    const noun = count[2].toLowerCase();
    if (noun === 'tranches') return `${amount} ${russianPlural(amount, 'лот', 'лота', 'лотов')}`;
    if (noun === 'records') return `${amount} ${russianPlural(amount, 'запись', 'записи', 'записей')}`;
    if (noun === 'holdings') return `${amount} ${russianPlural(amount, 'позиция', 'позиции', 'позиций')}`;
    if (noun === 'days') return `${amount} дн.`;
    if (noun === 'hrs') return `${amount} ч`;
    return `${amount} акций`;
  }

  const riskPrefixes = ['Healthy', 'No margin debt', 'Elevated', 'Stop-out level', 'Margin-call level'];
  const riskPrefix = riskPrefixes.find((prefix) => normalized === prefix || normalized.startsWith(prefix + ' ·'));
  if (riskPrefix) {
    return (RU[riskPrefix] || riskPrefix) + normalized.slice(riskPrefix.length)
      .replace(/\bnegative equity\b/g, RU['negative equity'])
      .replace(/\bequity\b/g, 'собственного капитала')
      .replace(/\bmaintenance\b/g, 'по нормативу поддерживающей маржи');
  }

  if (normalized.startsWith('e.g. quote ')) {
    return 'например: quote ' + normalized.slice('e.g. quote '.length);
  }
  return undefined;
}

export function translateText(value: string, language: AppLanguage = currentLanguage): string {
  if (language === 'en') return value;
  if (value.includes('\n')) return value.split('\n').map((line) => translateText(line, language)).join('\n');
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\s+/g, ' ');
  if (!normalized) return value;
  const translated = RU[normalized] ?? translateDynamicText(normalized);
  if (!translated) return value;
  const start = value.indexOf(trimmed);
  const end = start + trimmed.length;
  return value.slice(0, start) + translated + value.slice(end);
}

function translateVNodeValue(value: unknown): unknown {
  if (typeof value === 'string') return translateText(value);
  if (Array.isArray(value)) return value.map(translateVNodeValue);
  if (value && typeof value === 'object' && 'props' in value) {
    const props = (value as VNode).props as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(props, 'children')) {
      props.children = translateVNodeValue(props.children);
    }
    for (const attribute of TEXT_ATTRIBUTES) {
      const attributeValue = props[attribute];
      if (typeof attributeValue === 'string') {
        props[attribute] = translateText(attributeValue);
      }
    }
  }
  return value;
}

const previousVNodeHook = options.vnode;
options.vnode = (vnode) => {
  previousVNodeHook?.(vnode);
  translateVNodeValue(vnode);
};

function updateDocumentLanguage(language: AppLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.title = language === 'ru' ? RU_DOCUMENT_TITLE : EN_DOCUMENT_TITLE;
}

export function setAppLanguage(language: AppLanguage | null | undefined): void {
  const nextLanguage: AppLanguage = language === 'ru' ? 'ru' : 'en';
  updateDocumentLanguage(nextLanguage);
  if (currentLanguage === nextLanguage) return;
  currentLanguage = nextLanguage;
  for (const listener of languageListeners) listener(nextLanguage);
}

export function subscribeAppLanguage(listener: (language: AppLanguage) => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}
