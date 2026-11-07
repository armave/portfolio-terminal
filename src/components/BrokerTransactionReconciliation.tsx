import type { BrokerCashflow, BrokerExecution } from '../types/broker';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';
import { reconcileBrokerActivity, type ReconciliationFeedStatus } from '../domain/brokerTransactionReconciliation';
import { translateText } from '../services/i18n';

interface BrokerTransactionReconciliationProps {
  executions: readonly BrokerExecution[];
  cashflows: readonly BrokerCashflow[];
  appEvents: readonly PortfolioTransactionEvent[];
  executionStatus: ReconciliationFeedStatus;
  cashflowStatus: ReconciliationFeedStatus;
  appHistoryStatus?: ReconciliationFeedStatus;
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
  appHistoryStatus = 'partial'
}: BrokerTransactionReconciliationProps) {
  const report = reconcileBrokerActivity({
    brokerExecutions: executions, brokerCashflows: cashflows, appEvents,
    executionStatus, cashflowStatus, appHistoryStatus
  });
  const label = report.findings.length ? 'Differences found' :
    report.status === 'matched' ? 'Matched' :
      report.status === 'unavailable' ? 'History unavailable' : 'Provisional review';
  const labelClass = report.findings.length ? 'text-amber-300' :
    report.status === 'matched' ? 'text-emerald-300' : 'text-slate-300';

  return (
    <div class="space-y-3 text-xs">
      <p class="text-slate-400">{translateText('Read-only comparison of broker executions and cashflows with app-authored journal events. No portfolio data is changed.')}</p>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <strong class={labelClass}>{translateText(label)}</strong>
        <span class="text-slate-500">{report.findings.length} {translateText('findings')}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><div class="text-slate-500">{translateText('Broker executions')}</div><strong>{report.brokerExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateText('Matched executions')}</div><strong>{report.matchedExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateText('Broker cashflows')}</div><strong>{report.brokerCashflowCount}</strong></div>
        <div><div class="text-slate-500">{translateText('Matched cashflows')}</div><strong>{report.matchedCashflowCount}</strong></div>
      </div>
      {report.warnings.length > 0 && (
        <ul class="list-disc space-y-1 pl-4 text-amber-200">
          {report.warnings.map(warning => <li key={warning}>{translateText(warning)}</li>)}
        </ul>
      )}
      {report.findings.length > 0 ? (
        <div class="space-y-2">
          {report.findings.slice(0, 30).map(finding => (
            <article key={finding.id} class="rounded border border-slate-800 px-2.5 py-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <strong>{translateText(FINDING_LABELS[finding.type] || finding.type)} · {finding.subject}</strong>
                <span class={finding.confidence === 'confirmed' ? 'text-emerald-300' : 'text-amber-300'}>
                  {translateText(finding.confidence === 'confirmed' ? 'Confirmed' : 'Provisional')}
                </span>
              </div>
              <p class="mt-1 text-slate-400">{translateText(finding.explanation)}</p>
              <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-300">
                <span>{translateText('Broker')}: {formatValue(finding.brokerValue, finding.currency)}</span>
                <span>{translateText('App')}: {formatValue(finding.appValue, finding.currency)}</span>
                {finding.brokerReferences.length > 0 && <span>{translateText('Broker ref')}: {finding.brokerReferences.join(', ')}</span>}
                {finding.appEventIds.length > 0 && <span>{translateText('App event')}: {finding.appEventIds.join(', ')}</span>}
                {finding.brokerAt !== undefined && <span>{translateText('Broker time')}: {formatTimestamp(finding.brokerAt)}</span>}
                {finding.appAt !== undefined && <span>{translateText('App time')}: {formatTimestamp(finding.appAt)}</span>}
              </div>
            </article>
          ))}
          {report.findings.length > 30 && <p class="text-slate-500">{translateText('Showing first 30 findings')}.</p>}
        </div>
      ) : <p class="text-emerald-300">{translateText('No transaction-level differences were found in the available records.')}</p>}
      <p class="border-t border-slate-800 pt-2 text-slate-500">{translateText('Unmatched records remain provisional until transaction journal coverage is complete. Resolution and writeback are not available in this read-only review.')}</p>
    </div>
  );
}
