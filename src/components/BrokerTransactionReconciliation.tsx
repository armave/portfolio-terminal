import type { BrokerCashflow, BrokerExecution } from '../types/broker';
import type { ClosedTrade } from '../types/portfolio';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';
import { reconcileBrokerActivity, type ReconciliationFeedStatus } from '../domain/brokerTransactionReconciliation';
import { getAppLanguage } from '../services/i18n';

const RU_COPY: Record<string, string> = {
  'Reconcile broker activity': 'Сверить активность брокера',
  'Matched': 'Совпадает',
  'Differences found': 'Обнаружены расхождения',
  'History unavailable': 'История недоступна',
  'Provisional review': 'Предварительная проверка',
  'findings': 'расхождений',
  'Read-only comparison of broker executions and cashflows with app-authored journal events. No portfolio data is changed.': 'Сверка исполнений и денежных потоков брокера с журналом операций приложения. Данные портфеля не изменяются.',
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
  'Duplicate broker execution': 'Дублирующееся исполнение брокера',
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
  'App time': 'Время приложения'
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


interface BrokerTransactionReconciliationProps {
  executions: readonly BrokerExecution[];
  cashflows: readonly BrokerCashflow[];
  appEvents: readonly PortfolioTransactionEvent[];
  executionStatus: ReconciliationFeedStatus;
  cashflowStatus: ReconciliationFeedStatus;
  appHistoryStatus?: ReconciliationFeedStatus;
  legacyClosedTrades?: readonly ClosedTrade[];
}

const FINDING_LABELS: Record<string, string> = {
  duplicate_broker_execution: 'Duplicate broker execution',
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
  appHistoryStatus = 'partial', legacyClosedTrades = []
}: BrokerTransactionReconciliationProps) {
  const report = reconcileBrokerActivity({
    brokerExecutions: executions, brokerCashflows: cashflows, appEvents,
    executionStatus, cashflowStatus, appHistoryStatus, legacyClosedTrades
  });
  const label = getBrokerReconciliationHeadline(report.status, report.findings.length);
  const countLabel = getBrokerReconciliationCountLabel(report.status);
  const labelClass = report.status === 'matched' ? 'text-emerald-300' :
    report.status === 'differences' ? 'text-amber-300' : 'text-slate-300';

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
        <p class="text-slate-500">{translateBrokerReconciliationCopy('Legacy closed-sale summaries are matched only when the broker sell fills agree on ticker, date, total quantity and weighted price. They do not establish historical buy executions or cashflows.')}</p>
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
            </article>
          ))}
          {report.findings.length > 30 && <p class="text-slate-500">{translateBrokerReconciliationCopy('Showing first 30 findings')}.</p>}
        </div>
      ) : <p class="text-emerald-300">{translateBrokerReconciliationCopy('No transaction-level differences were found in the available records.')}</p>}
      <p class="border-t border-slate-800 pt-2 text-slate-500">{translateBrokerReconciliationCopy('Unmatched records remain provisional until transaction journal coverage is complete. Resolution and writeback are not available in this read-only review.')}</p>
    </div>
  );
}
