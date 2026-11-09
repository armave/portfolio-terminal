import { useState } from 'preact/hooks';
import type { BrokerCashflow, BrokerExecution } from '../types/broker';
import type { ClosedTrade } from '../types/portfolio';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';
import { reconcileBrokerActivity, type ReconciliationFeedStatus } from '../domain/brokerTransactionReconciliation';
import { getAppLanguage } from '../services/i18n';
import {
  reconcileBrokerQuotePrices,
  type AppQuoteHolding,
  type BrokerQuoteSnapshot,
  type BrokerQuoteReconciliationStatus
} from '../domain/brokerQuoteReconciliation';

export type BrokerReconciliationReviewSection = 'activity' | 'quote';
type RecordBrokerReconciliationReview = (
  section: BrokerReconciliationReviewSection,
  findingId: string,
  findingType: string,
  subject: string,
  reason: string
) => boolean;

export function getBrokerReconciliationReviewIdempotencyKey(
  section: BrokerReconciliationReviewSection,
  findingId: string
): string {
  const id = typeof findingId === 'string' ? findingId.trim() : '';
  if (!id || id.length > 160) return '';
  return `reconciliation-review:${section}:${id}`;
}

export function findBrokerReconciliationReview(
  events: readonly PortfolioTransactionEvent[],
  section: BrokerReconciliationReviewSection,
  findingId: string
): PortfolioTransactionEvent | undefined {
  const key = getBrokerReconciliationReviewIdempotencyKey(section, findingId);
  if (!key) return undefined;
  return events.find((event) =>
    event.type === 'portfolio.reconciliation' &&
    event.actor.type === 'user' &&
    event.source === 'broker-reconciliation-review' &&
    event.idempotencyKey === key &&
    Boolean(event.requestFingerprint?.trim()) &&
    Boolean(event.note?.trim()) &&
    event.positionQuantityDelta === undefined &&
    event.cashHoldingQuantityDelta === undefined &&
    event.cashDelta === undefined &&
    event.marginDebtDelta === undefined
  );
}

const RU_COPY: Record<string, string> = {
  'Reconcile broker activity': 'Сверить активность брокера',
  'Matched': 'Совпадает',
  'Differences found': 'Обнаружены расхождения',
  'History unavailable': 'История недоступна',
  'Provisional review': 'Предварительная проверка',
  'findings': 'расхождений',
  'Read-only comparison of broker executions and cashflows with app-authored journal events. No portfolio data is changed.': 'Сверка исполнений и денежных потоков брокера с журналом операций приложения. Данные портфеля не изменяются.',
  'Review item': 'Отметить проверенным',
  'Reason for review': 'Причина проверки',
  'Record review': 'Записать проверку',
  'Cancel': 'Отмена',
  'Reviewed · not resolved': 'Проверено · не устранено',
  'This is an audit note only. It does not resolve the finding or change portfolio data.': 'Это только запись в аудите. Она не устраняет расхождение и не изменяет данные портфеля.',
  'Enter a reason to record this review.': 'Укажите причину для записи проверки.',
  'Review could not be recorded. No financial data was changed.': 'Не удалось записать проверку. Финансовые данные не изменены.',
  'Reviewed note': 'Записанная причина проверки',
  'Record a review note only; corrections and writeback remain unavailable.': 'Записывается только отметка о проверке; исправления и запись изменений недоступны.',
  'Broker executions': 'Исполнения брокера',
  'Matched executions': 'Совпавшие исполнения',
  'Broker cashflows': 'Денежные потоки брокера',
  'Matched cashflows': 'Совпавшие денежные потоки',
  'App journal executions': 'Исполнения в журнале приложения',
  'App journal cashflows': 'Денежные потоки в журнале приложения',
  'Legacy closed sales': 'Исторические закрытые продажи',
  'Matched legacy sales': 'Совпавшие исторические продажи',
  'Matched legacy sell fills': 'Совпавшие исполнения исторических продаж',
  'provisional items': 'предварительных записей',
  'No confirmed differences were found in the available records; incomplete coverage prevents a full match confirmation.': 'В доступных записях не обнаружено подтверждённых расхождений; неполнота истории не позволяет подтвердить полное совпадение.',
  'Broker history is unavailable; no transaction-level comparison could be confirmed.': 'История брокера недоступна; сверку на уровне транзакций подтвердить невозможно.',
  'Duplicate broker execution': 'Дублирующееся исполнение брокера',
  'Broker execution revision conflict': 'Конфликт версий исполнения брокера',
  'Ambiguous broker order match': 'Неоднозначное совпадение ордера брокера',
  'Unclassified broker execution': 'Нераспознанное исполнение брокера',
  'Duplicate broker cashflow': 'Дублирующийся денежный поток брокера',
  'Broker cashflow revision conflict': 'Конфликт версий денежного потока брокера',
  'Unclassified broker cashflow': 'Нераспознанный денежный поток брокера',
  'Cashflow direction differs': 'Направление денежного потока отличается',
  'Execution not found in app journal': 'Исполнение не найдено в журнале приложения',
  'App trade not found in broker history': 'Сделка приложения не найдена в истории брокера',
  'Execution quantity differs': 'Количество исполнения отличается',
  'Execution price differs': 'Цена исполнения отличается',
  'Commission differs': 'Комиссия отличается',
  'Commission currency differs': 'Валюта комиссии отличается',
  'Execution timestamp differs': 'Время исполнения отличается',
  'Cashflow not found in app journal': 'Денежный поток не найден в журнале приложения',
  'App cashflow not found in broker history': 'Денежный поток приложения не найден в истории брокера',
  'Cashflow amount differs': 'Сумма денежного потока отличается',
  'Cashflow currency differs': 'Валюта денежного потока отличается',
  'Cashflow classification differs': 'Классификация денежного потока отличается',
  'Confirmed': 'Подтверждено',
  'Provisional': 'Предварительно',
  'Broker': 'Брокер',
  'App': 'Приложение',
  'Broker ref': 'ID брокера',
  'App event': 'Событие приложения',
  'Showing first 30 findings': 'Показаны первые 30 расхождений',
  'No transaction-level differences were found in the available records.': 'В доступных записях расхождений на уровне транзакций не обнаружено.',
  'Unmatched records remain provisional until transaction journal coverage is complete. Resolution and writeback are not available in this read-only review.': 'Несовпавшие записи остаются предварительными до полного охвата журнала транзакций. В этой проверке доступны только просмотр и сверка, без исправлений и записи данных.',
  'Legacy closed-sale summaries are matched only when the broker sell fills agree on ticker, date, total quantity and weighted price. They do not establish historical buy executions or cashflows.': 'Исторические сводки закрытых продаж сопоставляются только при совпадении тикера, даты, общего количества и средневзвешенной цены исполнений продажи. Они не подтверждают исторические покупки или денежные потоки.',
  'Legacy closed sales are app summaries, not transaction-journal events.': 'Исторические закрытые продажи — это сводки приложения, а не события журнала транзакций.',
  'The broker execution history is incomplete; absence-based findings are suppressed.': 'История исполнений брокера неполная; выводы об отсутствии записей не делаются.',
  'Broker cashflow history is incomplete; absence-based findings are suppressed.': 'История денежных потоков брокера неполная; выводы об отсутствии записей не делаются.',
  'App transaction journal coverage is incomplete; unmatched records are provisional and are not treated as confirmed omissions.': 'Журнал транзакций приложения заполнен не полностью; несовпавшие записи предварительные и не считаются подтверждёнными пропусками.',
  'The broker and app cashflow records use different currencies; no conversion was attempted.': 'Записи денежных потоков брокера и приложения используют разные валюты; конвертация не выполнялась.',
  'More than one broker order has fills that match this app transaction. No order was selected without a unique match.': 'Несколько ордеров брокера соответствуют этой транзакции приложения. Ордер не выбран, поскольку совпадение неоднозначно.',
  'Multiple nearby broker fills could represent this app transaction, but they do not share a verified order ID. No fills were grouped.': 'Несколько близких по времени исполнений могут относиться к транзакции приложения, но у них нет общего подтверждённого ID ордера. Исполнения не объединялись.',
  'More than one broker order has fills that match an app transaction; manual review is required.': 'Несколько ордеров брокера могут соответствовать транзакции приложения; требуется ручная проверка.',
  'Multiple nearby broker fills lack a shared verified order ID; partial-fill matching was not attempted.': 'У близких по времени исполнений нет общего подтверждённого ID ордера; объединение частичных исполнений не выполнялось.',
  'The same broker execution identifier appears with conflicting facts. No revision was selected because the feed does not identify which record supersedes the other.': 'Один и тот же идентификатор исполнения брокера содержит противоречивые данные. Версия не выбрана, поскольку поток не указывает, какая запись заменяет другую.',
  'The broker execution is missing a usable instrument, supported side or positive quantity and was excluded from matching.': 'В исполнении брокера отсутствует допустимый инструмент, поддерживаемая сторона или положительное количество; запись исключена из сверки.',
  'The same broker cashflow identifier appears with conflicting facts. No revision was selected because the feed does not identify which record supersedes the other.': 'Один и тот же идентификатор денежного потока брокера содержит противоречивые данные. Версия не выбрана, поскольку поток не указывает, какая запись заменяет другую.',
  'The broker cashflow has no usable amount and was excluded from matching.': 'В денежном потоке брокера отсутствует допустимая сумма; запись исключена из сверки.',
  'The broker and app record opposite signed cash movements for the same cashflow. No balance adjustment was made.': 'Брокер и приложение указывают противоположные знаки одного денежного потока. Баланс не корректировался.',
  'The broker history contains the same execution identifier and facts more than once.': 'В истории брокера несколько раз встречается один идентификатор исполнения с одинаковыми данными.',
  'The broker history contains the same cashflow identifier and facts more than once.': 'В истории брокера несколько раз встречается один идентификатор денежного потока с одинаковыми данными.',
  'One or more broker execution rows could not be classified; affected rows were excluded from matching.': 'Некоторые исполнения брокера не удалось распознать; такие записи исключены из сверки.',
  'One or more broker cashflow rows could not be classified; affected rows were excluded from matching.': 'Некоторые денежные потоки брокера не удалось распознать; такие записи исключены из сверки.',
  'One or more broker executions lack a provider-stable execution ID; matching is provisional.': 'У некоторых исполнений отсутствует стабильный идентификатор брокера; сверка предварительная.',
  'One or more broker execution IDs have conflicting revisions; affected records were excluded from matching.': 'Некоторые идентификаторы исполнений содержат конфликтующие версии; такие записи исключены из сверки.',
  'One or more broker cashflows lack a provider-stable cashflow ID; matching is provisional.': 'У некоторых денежных потоков отсутствует стабильный идентификатор брокера; сверка предварительная.',
  'One or more broker cashflow IDs have conflicting revisions; affected records were excluded from matching.': 'Некоторые идентификаторы денежных потоков содержат конфликтующие версии; такие записи исключены из сверки.',
  'No corresponding app-authored trade was found in the available transaction journal.': 'В доступном журнале транзакций не найдена соответствующая сделка приложения.',
  'No corresponding broker execution was found in the available provider history.': 'В доступной истории провайдера не найдено соответствующее исполнение брокера.',
  'The broker fill quantity differs from the app transaction quantity.': 'Количество исполнения брокера отличается от количества в транзакции приложения.',
  'The broker execution price differs from the app transaction price.': 'Цена исполнения брокера отличается от цены транзакции приложения.',
  'The broker commission differs from the app-recorded transaction fee.': 'Комиссия брокера отличается от комиссии, записанной в приложении.',
  'The broker and app transaction fees use different currencies; no conversion was attempted.': 'Комиссии брокера и приложения указаны в разных валютах; конвертация не выполнялась.',
  'The broker and app transaction timestamps differ beyond the normal matching tolerance.': 'Время транзакции брокера и приложения отличается больше допустимого интервала сверки.',
  'No corresponding app-authored cashflow event was found in the available journal.': 'В доступном журнале не найдено соответствующее событие денежного потока приложения.',
  'No corresponding broker cashflow was found in the available provider history.': 'В доступной истории провайдера не найден соответствующий денежный поток брокера.',
  'Broker time': 'Время брокера',
  'App time': 'Время приложения',
  'Broker market prices': 'Рыночные цены брокера',
  'Read-only comparison of app quote observations with broker-reported position prices. No portfolio data is changed.': 'Сверка котировок приложения с ценами позиций, сообщёнными брокером. Данные портфеля не изменяются.',
  'Price differences found': 'Обнаружены расхождения цен',
  'Prices matched': 'Цены совпадают',
  'Provisional price comparison': 'Предварительная сверка цен',
  'Stale broker quote snapshot': 'Устаревший снимок котировок брокера',
  'Broker quote data unavailable': 'Данные котировок брокера недоступны',
  'Compared quote pairs': 'Сопоставленные пары котировок',
  'Price mismatch': 'Расхождение цены',
  'Quote currency mismatch': 'Несовпадение валюты котировки',
  'Conflicting app quotes': 'Противоречивые котировки приложения',
  'Conflicting broker prices': 'Противоречивые цены брокера',
  'App quote': 'Котировка приложения',
  'Broker quote': 'Котировка брокера',
  'App quote source': 'Источник котировки приложения',
  'Broker quote source': 'Источник котировки брокера',
  'App observation': 'Наблюдение приложения',
  'Broker observation': 'Наблюдение брокера',
  'Received': 'Получено',
  'App received': 'Получено приложением',
  'Broker received': 'Получено брокером',
  'App currency': 'Валюта приложения',
  'Broker currency': 'Валюта брокера',
  'The app and broker quotes use different or unverified currencies. No conversion was attempted.': 'Котировки приложения и брокера указаны в разных или неподтверждённых валютах. Конвертация не выполнялась.',
  'The reported prices differ, but one or both source observations are incomplete, stale, delayed, or unverifiable.': 'Указанные цены различаются, но одно или оба исходных наблюдения неполные, устаревшие, задержанные или не подтверждены.',
  'The app and broker report different prices for the same currency-qualified instrument with fresh source observations.': 'Приложение и брокер сообщают разные цены для одного инструмента в одинаковой валюте с актуальными исходными наблюдениями.',
  'No matching ticker and currency pairs were available for price comparison.': 'Не найдено совпадающих пар тикера и валюты для сравнения цен.',
  'The broker quote snapshot is stale; it is not used as current price evidence.': 'Снимок котировок брокера устарел и не используется как актуальное подтверждение цены.',
  'The broker provider observation timestamp is unknown; price findings cannot be confirmed.': 'Время наблюдения провайдера брокера неизвестно; расхождения цен нельзя подтвердить.',
  'The broker position snapshot is incomplete; price findings are provisional.': 'Снимок позиций брокера неполный; расхождения цен считаются предварительными.',
  'One or more app quote observations are not verified as fresh, live, and complete.': 'Одна или несколько котировок приложения не подтверждены как актуальные, текущие и полные.'
};

export function translateBrokerReconciliationCopy(value: string, language = getAppLanguage()): string {
  return language === 'ru' ? RU_COPY[value] || value : value;
}

export function getBrokerReconciliationHeadline(
  status: 'matched' | 'differences' | 'partial' | 'unavailable',
  findingCount: number
): string {
  if (status === 'unavailable') return 'History unavailable';
  if (status === 'partial') return 'Provisional review';
  return findingCount > 0 ? 'Differences found' : 'Matched';
}

export function getBrokerReconciliationCountLabel(
  status: 'matched' | 'differences' | 'partial' | 'unavailable'
): string {
  return status === 'partial' || status === 'unavailable' ? 'provisional items' : 'findings';
}

export function getBrokerReconciliationEmptyMessage(
  status: 'matched' | 'differences' | 'partial' | 'unavailable'
): string {
  if (status === 'partial') return 'No confirmed differences were found in the available records; incomplete coverage prevents a full match confirmation.';
  if (status === 'unavailable') return 'Broker history is unavailable; no transaction-level comparison could be confirmed.';
  return 'No transaction-level differences were found in the available records.';
}



export function getBrokerQuoteReconciliationHeadline(status: BrokerQuoteReconciliationStatus): string {
  if (status === 'unavailable') return 'Broker quote data unavailable';
  if (status === 'stale') return 'Stale broker quote snapshot';
  if (status === 'partial') return 'Provisional price comparison';
  return status === 'differences' ? 'Price differences found' : 'Prices matched';
}

interface BrokerTransactionReconciliationProps {
  executions: readonly BrokerExecution[];
  cashflows: readonly BrokerCashflow[];
  appEvents: readonly PortfolioTransactionEvent[];
  executionStatus: ReconciliationFeedStatus;
  cashflowStatus: ReconciliationFeedStatus;
  appHistoryStatus?: ReconciliationFeedStatus;
  legacyClosedTrades?: readonly ClosedTrade[];
  /** Optional app-owned quotes and broker snapshot for read-only price comparison. */
  appQuotes?: readonly AppQuoteHolding[];
  /** Passing null explicitly renders an unavailable broker-price state. */
  brokerQuoteSnapshot?: BrokerQuoteSnapshot | null;
  /** Records an audit-only note; must not mutate financial data. */
  onRecordReview?: RecordBrokerReconciliationReview;
}

const FINDING_LABELS: Record<string, string> = {
  duplicate_broker_execution: 'Duplicate broker execution',
  execution_revision_conflict: 'Broker execution revision conflict',
  execution_match_ambiguous: 'Ambiguous broker order match',
  execution_unclassified: 'Unclassified broker execution',
  duplicate_broker_cashflow: 'Duplicate broker cashflow',
  cashflow_revision_conflict: 'Broker cashflow revision conflict',
  cashflow_unclassified: 'Unclassified broker cashflow',
  cashflow_direction_mismatch: 'Cashflow direction differs',
  execution_missing_in_app: 'Execution not found in app journal',
  execution_missing_in_broker: 'App trade not found in broker history',
  execution_quantity_mismatch: 'Execution quantity differs',
  execution_price_mismatch: 'Execution price differs',
  execution_fee_mismatch: 'Commission differs',
  execution_fee_currency_mismatch: 'Commission currency differs',
  execution_timing_difference: 'Execution timestamp differs',
  cashflow_missing_in_app: 'Cashflow not found in app journal',
  cashflow_missing_in_broker: 'App cashflow not found in broker history',
  cashflow_amount_mismatch: 'Cashflow amount differs',
  cashflow_currency_mismatch: 'Cashflow currency differs',
  cashflow_type_mismatch: 'Cashflow classification differs'
};

function formatValue(value: number | null, currency?: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
  return currency ? `${amount} ${currency}` : amount;
}
function formatTimestamp(value?: number): string {
  if (!Number.isFinite(value)) return '—';
  const date = new Date(value as number);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—';
}

export function BrokerTransactionReconciliation({
  executions, cashflows, appEvents, executionStatus, cashflowStatus,
  appHistoryStatus = 'partial', legacyClosedTrades = [],
  appQuotes = [], brokerQuoteSnapshot, onRecordReview
}: BrokerTransactionReconciliationProps) {
  const [reviewReasonByKey, setReviewReasonByKey] = useState<Record<string, string>>({});
  const [reviewOpenKey, setReviewOpenKey] = useState<string | null>(null);
  const [reviewErrorByKey, setReviewErrorByKey] = useState<Record<string, string>>({});
  const report = reconcileBrokerActivity({
    brokerExecutions: executions, brokerCashflows: cashflows, appEvents,
    executionStatus, cashflowStatus, appHistoryStatus, legacyClosedTrades
  });
  const label = getBrokerReconciliationHeadline(report.status, report.findings.length);
  const countLabel = getBrokerReconciliationCountLabel(report.status);
  const emptyMessage = getBrokerReconciliationEmptyMessage(report.status);
  const emptyMessageClass = report.status === 'matched' ? 'text-emerald-300' : 'text-slate-400';
  const labelClass = report.status === 'matched' ? 'text-emerald-300' :
    report.status === 'differences' ? 'text-amber-300' : 'text-slate-300';
  const quoteReport = brokerQuoteSnapshot === undefined ? null : reconcileBrokerQuotePrices({
    brokerSnapshot: brokerQuoteSnapshot,
    appQuotes
  });

  const renderReviewControl = (
    section: BrokerReconciliationReviewSection,
    findingId: string,
    findingType: string,
    subject: string
  ) => {
    const key = getBrokerReconciliationReviewIdempotencyKey(section, findingId);
    const previousReview = findBrokerReconciliationReview(appEvents, section, findingId);
    if (previousReview) {
      return (
        <div class="mt-2 rounded border border-slate-800 bg-slate-950/40 px-2.5 py-2" role="status">
          <strong class="text-emerald-300">{translateBrokerReconciliationCopy('Reviewed · not resolved')}</strong>
          <p class="mt-1 text-slate-500">{translateBrokerReconciliationCopy('This is an audit note only. It does not resolve the finding or change portfolio data.')}</p>
          <p class="mt-1 text-slate-400">{translateBrokerReconciliationCopy('Reviewed note')}: {previousReview.note}</p>
        </div>
      );
    }
    if (!onRecordReview || !key) return null;
    const reason = reviewReasonByKey[key] || '';
    const error = reviewErrorByKey[key] || '';
    const inputId = `reconciliation-review-reason-${section}-${findingId}`;
    const submit = () => {
      const cleanReason = reason.trim();
      if (!cleanReason) {
        setReviewErrorByKey((current) => ({ ...current, [key]: 'Enter a reason to record this review.' }));
        return;
      }
      const saved = onRecordReview(section, findingId, findingType, subject, cleanReason);
      if (saved) {
        setReviewOpenKey(null);
        setReviewReasonByKey((current) => ({ ...current, [key]: '' }));
        setReviewErrorByKey((current) => ({ ...current, [key]: '' }));
      } else {
        setReviewErrorByKey((current) => ({ ...current, [key]: 'Review could not be recorded. No financial data was changed.' }));
      }
    };
    return (
      <div class="mt-2 space-y-2">
        {reviewOpenKey === key ? (
          <div class="space-y-2 rounded border border-slate-800 bg-slate-950/40 p-2">
            <label class="block space-y-1 text-[10px] text-slate-400" for={inputId}>
              <span>{translateBrokerReconciliationCopy('Reason for review')}</span>
              <textarea
                id={inputId}
                rows={2}
                maxLength={240}
                value={reason}
                onInput={(event) => setReviewReasonByKey((current) => ({ ...current, [key]: event.currentTarget.value }))}
                class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </label>
            <p class="text-[10px] text-slate-500">{translateBrokerReconciliationCopy('This is an audit note only. It does not resolve the finding or change portfolio data.')}</p>
            {error && <p role="alert" class="text-[10px] text-amber-300">{translateBrokerReconciliationCopy(error)}</p>}
            <div class="flex flex-wrap gap-2">
              <button type="button" disabled={!reason.trim()} onClick={submit}
                class="rounded border border-cyan-700/70 px-2.5 py-1.5 text-[10px] font-bold text-cyan-200 hover:bg-cyan-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
                {translateBrokerReconciliationCopy('Record review')}
              </button>
              <button type="button" onClick={() => { setReviewOpenKey(null); setReviewErrorByKey((current) => ({ ...current, [key]: '' })); }}
                class="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-300">
                {translateBrokerReconciliationCopy('Cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setReviewOpenKey(key)}
            class="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 hover:border-cyan-700 hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
            {translateBrokerReconciliationCopy('Review item')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div class="space-y-3 text-xs">
      <p class="text-slate-400">{translateBrokerReconciliationCopy('Read-only comparison of broker executions and cashflows with app-authored journal events. No portfolio data is changed.')}</p>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <strong class={labelClass}>{translateBrokerReconciliationCopy(label)}</strong>
        <span class={report.status === 'partial' || report.status === 'unavailable' ? 'text-amber-300' : 'text-slate-500'}>{report.findings.length} {translateBrokerReconciliationCopy(countLabel)}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Broker executions')}</div><strong>{report.brokerExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('App journal executions')}</div><strong>{report.appExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Matched executions')}</div><strong>{report.matchedExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Legacy closed sales')}</div><strong>{report.legacyClosedSaleCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Matched legacy sales')}</div><strong>{report.matchedLegacyClosedSaleCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Matched legacy sell fills')}</div><strong>{report.matchedLegacyExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Broker cashflows')}</div><strong>{report.brokerCashflowCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('App journal cashflows')}</div><strong>{report.appCashflowCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Matched cashflows')}</div><strong>{report.matchedCashflowCount}</strong></div>
      </div>
      {report.legacyClosedSaleCount > 0 && (
        <p class="text-slate-500">
          {translateBrokerReconciliationCopy('Legacy closed sales are app summaries, not transaction-journal events.')} {translateBrokerReconciliationCopy('Legacy closed-sale summaries are matched only when the broker sell fills agree on ticker, date, total quantity and weighted price. They do not establish historical buy executions or cashflows.')}
        </p>
      )}
      {report.warnings.length > 0 && (
        <ul class="list-disc space-y-1 pl-4 text-amber-200">
          {report.warnings.map(warning => <li key={warning}>{translateBrokerReconciliationCopy(warning)}</li>)}
        </ul>
      )}
      {report.findings.length > 0 ? (
        <div class="space-y-2">
          {report.findings.slice(0, 30).map(finding => (
            <article key={finding.id} class="rounded border border-slate-800 px-2.5 py-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <strong>{translateBrokerReconciliationCopy(FINDING_LABELS[finding.type] || finding.type)} · {finding.subject}</strong>
                <span class={finding.confidence === 'confirmed' ? 'text-emerald-300' : 'text-amber-300'}>
                  {translateBrokerReconciliationCopy(finding.confidence === 'confirmed' ? 'Confirmed' : 'Provisional')}
                </span>
              </div>
              <p class="mt-1 text-slate-400">{translateBrokerReconciliationCopy(finding.explanation)}</p>
              <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-300">
                <span>{translateBrokerReconciliationCopy('Broker')}: {formatValue(finding.brokerValue, finding.currency)}</span>
                <span>{translateBrokerReconciliationCopy('App')}: {formatValue(finding.appValue, finding.currency)}</span>
                {finding.brokerReferences.length > 0 && <span>{translateBrokerReconciliationCopy('Broker ref')}: {finding.brokerReferences.join(', ')}</span>}
                {finding.appEventIds.length > 0 && <span>{translateBrokerReconciliationCopy('App event')}: {finding.appEventIds.join(', ')}</span>}
                {finding.brokerAt !== undefined && <span>{translateBrokerReconciliationCopy('Broker time')}: {formatTimestamp(finding.brokerAt)}</span>}
                {finding.appAt !== undefined && <span>{translateBrokerReconciliationCopy('App time')}: {formatTimestamp(finding.appAt)}</span>}
              </div>
              {renderReviewControl('activity', finding.id, finding.type, finding.subject)}
            </article>
          ))}
          {report.findings.length > 30 && <p class="text-slate-500">{translateBrokerReconciliationCopy('Showing first 30 findings')}.</p>}
        </div>
      ) : <p class={emptyMessageClass}>{translateBrokerReconciliationCopy(emptyMessage)}</p>}

      {quoteReport && (
        <section class="mt-4 space-y-3 border-t border-slate-800 pt-3" aria-label={translateBrokerReconciliationCopy('Broker market prices')}>
          <div class="space-y-1">
            <h3 class="font-semibold text-slate-200">{translateBrokerReconciliationCopy('Broker market prices')}</h3>
            <p class="text-slate-400">{translateBrokerReconciliationCopy('Read-only comparison of app quote observations with broker-reported position prices. No portfolio data is changed.')}</p>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <strong class={quoteReport.status === 'matched' ? 'text-emerald-300' : quoteReport.status === 'differences' ? 'text-amber-300' : 'text-slate-300'}>
              {translateBrokerReconciliationCopy(getBrokerQuoteReconciliationHeadline(quoteReport.status))}
            </strong>
            <span class="text-slate-500">
              {translateBrokerReconciliationCopy('Compared quote pairs')}: {quoteReport.matchedCount}
            </span>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-400">
            {quoteReport.provider && <span>{translateBrokerReconciliationCopy('Broker quote source')}: {quoteReport.provider}{quoteReport.source ? ' · ' + quoteReport.source : ''}</span>}
            {quoteReport.observedAt && <span>{translateBrokerReconciliationCopy('Broker observation')}: {formatTimestamp(quoteReport.observedAt)}</span>}
            {quoteReport.receivedAt && <span>{translateBrokerReconciliationCopy('Received')}: {formatTimestamp(quoteReport.receivedAt)}</span>}
          </div>
          {quoteReport.warnings.length > 0 && (
            <ul class="list-disc space-y-1 pl-4 text-amber-200">
              {quoteReport.warnings.map(warning => <li key={warning}>{translateBrokerReconciliationCopy(warning)}</li>)}
            </ul>
          )}
          {quoteReport.findings.length > 0 ? (
            <div class="space-y-2">
              {quoteReport.findings.map(finding => {
                const title = finding.type === 'price_mismatch' ? 'Price mismatch'
                  : finding.type === 'currency_mismatch' ? 'Quote currency mismatch'
                    : finding.type === 'ambiguous_app_quote' ? 'Conflicting app quotes'
                      : finding.type === 'ambiguous_broker_quote' ? 'Conflicting broker prices'
                        : 'Unclassified quote';
                return (
                  <article key={finding.id} class="rounded border border-slate-800 px-2.5 py-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <strong>{translateBrokerReconciliationCopy(title)} · {finding.ticker}</strong>
                      <span class={finding.confidence === 'confirmed' ? 'text-emerald-300' : 'text-amber-300'}>
                        {translateBrokerReconciliationCopy(finding.confidence === 'confirmed' ? 'Confirmed' : 'Provisional')}
                      </span>
                    </div>
                    <p class="mt-1 text-slate-400">{translateBrokerReconciliationCopy(finding.explanation)}</p>
                    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-300">
                      <span>{translateBrokerReconciliationCopy('App quote')}: {formatValue(finding.appValue, finding.appCurrency || finding.currency)}</span>
                      <span>{translateBrokerReconciliationCopy('Broker quote')}: {formatValue(finding.brokerValue, finding.brokerCurrency || finding.currency)}</span>
                      {finding.appCurrency && <span>{translateBrokerReconciliationCopy('App currency')}: {finding.appCurrency}</span>}
                      {finding.brokerCurrency && <span>{translateBrokerReconciliationCopy('Broker currency')}: {finding.brokerCurrency}</span>}
                      {finding.appProvider && <span>{translateBrokerReconciliationCopy('App quote source')}: {finding.appProvider}</span>}
                      {finding.brokerProvider && <span>{translateBrokerReconciliationCopy('Broker quote source')}: {finding.brokerProvider}</span>}
                      {finding.appObservedAt && <span>{translateBrokerReconciliationCopy('App observation')}: {formatTimestamp(finding.appObservedAt)}</span>}
                      {finding.appReceivedAt && <span>{translateBrokerReconciliationCopy('App received')}: {formatTimestamp(finding.appReceivedAt)}</span>}
                      {finding.brokerObservedAt && <span>{translateBrokerReconciliationCopy('Broker observation')}: {formatTimestamp(finding.brokerObservedAt)}</span>}
                      {finding.brokerReceivedAt && <span>{translateBrokerReconciliationCopy('Broker received')}: {formatTimestamp(finding.brokerReceivedAt)}</span>}
                    </div>
                    {renderReviewControl('quote', finding.id, finding.type, finding.ticker)}
                  </article>
                );
              })}
            </div>
          ) : quoteReport.status === 'matched' ? (
            <p class="text-emerald-300">{translateBrokerReconciliationCopy('Prices matched')}</p>
          ) : (
            <p class="text-slate-400">{translateBrokerReconciliationCopy(getBrokerQuoteReconciliationHeadline(quoteReport.status))}</p>
          )}
        </section>
      )}
      <p class="border-t border-slate-800 pt-2 text-slate-500">{translateBrokerReconciliationCopy('Unmatched records remain provisional until transaction journal coverage is complete. Resolution and writeback are not available in this read-only review.')}</p>
      {onRecordReview && <p class="text-slate-500">{translateBrokerReconciliationCopy('Record a review note only; corrections and writeback remain unavailable.')}</p>}
    </div>
  );
}
