import type { PortfolioTransactionEventType, CashflowCategory } from '../types/portfolioTransaction';

export interface CashflowClassificationInput {
  type?: unknown;
  description?: unknown;
  category?: unknown;
  raw?: Record<string, unknown> | Record<string, string>;
}

export interface CashflowClassification {
  category: CashflowCategory;
  eventType: PortfolioTransactionEventType | null;
  classified: boolean;
}

function sourceText(input: CashflowClassificationInput): string {
  return [input.type, input.description, input.category, ...Object.values(input.raw || {})]
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .join(' ').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Shared fail-closed classifier for broker import, reconciliation and reporting. */
export function classifyCashflow(input: CashflowClassificationInput): CashflowClassification {
  const value = sourceText(input);
  const has = (pattern: RegExp) => pattern.test(value);
  if (!value) return { category: 'unclassified', eventType: null, classified: false };

  if (has(/\b(dividend reinvestment|reinvested distribution|reinvestment of dividend)\b/))
    return { category: 'unclassified', eventType: null, classified: false };
  if (has(/\b(stock split|reverse split|merger|spin off|reorganization|reorganisation|corporate action|symbol change|cash in lieu)\b/))
    return { category: 'corporate_action', eventType: 'corporate-action', classified: true };
  if (has(/\b(withholding tax|tax withheld|tax|vat)\b/))
    return { category: 'tax', eventType: 'fee', classified: true };
  if (has(/\b(correction|corrected|reversal|reversed)\b/))
    return { category: 'correction', eventType: 'cash.adjustment', classified: true };
  if (has(/\b(adjustment|balance adjustment)\b/)) {
    if (has(/\bmargin\b/)) return { category: 'unclassified', eventType: null, classified: false };
    return { category: 'adjustment', eventType: 'cash.adjustment', classified: true };
  }
  if (has(/\b(deposit|funding|funded|credit to account)\b/))
    return { category: 'deposit', eventType: 'cash.deposit', classified: true };
  if (has(/\b(withdrawal|withdraw|debit from account)\b/))
    return { category: 'withdrawal', eventType: 'cash.withdrawal', classified: true };
  if (has(/\b(transfer|wire|internal transfer)\b/))
    return { category: 'transfer', eventType: 'cash.transfer', classified: true };
  if (has(/\b(interest income|interest received|interest credited|credited interest|credit interest|bank interest)\b/))
    return { category: 'interest_income', eventType: 'interest.income', classified: true };
  if (has(/\b(margin interest|margin fee|financing|borrow fee)\b/))
    return { category: 'margin_interest', eventType: 'margin.interest', classified: true };
  if (has(/\bmargin\b/))
    return { category: 'unclassified', eventType: null, classified: false };
  if (has(/\b(dividend|distribution|coupon)\b/))
    return { category: 'dividend', eventType: 'dividend', classified: true };
  if (has(/\bcommission\b/))
    return { category: 'commission', eventType: 'fee', classified: true };
  if (has(/\b(fee|charge|service cost)\b/))
    return { category: 'fee', eventType: 'fee', classified: true };
  return { category: 'unclassified', eventType: null, classified: false };
}

/** True only when the source category carries a safely interpretable account-cash direction. */
export function hasKnownCashflowDirection(category: CashflowCategory): boolean {
  return [
    'deposit', 'withdrawal', 'dividend', 'interest_income',
    'commission', 'fee', 'tax', 'margin_interest', 'transfer'
  ].includes(category);
}

/** Signed account movement; charge refunds reverse the normal outflow sign. */
export function normalizeClassifiedCashflowAmount(category: CashflowCategory, amount: number, description = ''): number {
  if (!Number.isFinite(amount)) return amount;
  if (category === 'deposit' || category === 'dividend' || category === 'interest_income') return Math.abs(amount);
  if (category === 'withdrawal') return -Math.abs(amount);
  if (category === 'fee' || category === 'commission' || category === 'tax' || category === 'margin_interest')
    return /\b(refund|rebate|reimbursement)\b/i.test(description) ? Math.abs(amount) : -Math.abs(amount);
  return amount;
}
