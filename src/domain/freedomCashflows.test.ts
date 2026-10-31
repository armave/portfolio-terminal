import { describe, expect, it } from "vitest";
import {
  mergeFreedomCashflowRows,
  normalizeFreedomCashflowRows,
  type NormalizedFreedomCashflow
} from "./freedomCashflows";

describe("Freedom cashflow normalization", () => {
  it("normalizes nested broker envelopes and common operation aliases", () => {
    const rows = normalizeFreedomCashflowRows({
      ok: true,
      provider: "Freedom TradeNet",
      data: {
        result: {
          cash_flows: [{
            operation_id: 4812,
            operation_date: "2026-10-30T10:20:00Z",
            operation_type: "Margin Fee",
            amount: "-12,45",
            curr: "USD",
            comment: "Negative cash balance fee"
          }]
        }
      }
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "freedom-4812",
      date: "2026-10-30T10:20:00Z",
      type: "Margin Fee",
      amount: -12.45,
      currency: "USD",
      description: "Negative cash balance fee"
    });
    expect(rows[0].raw.operation_id).toBe("4812");
  });

  it("accepts a confirmed empty cashflow collection", () => {
    expect(normalizeFreedomCashflowRows({ data: { cashflows: [] } })).toEqual([]);
  });

  it("fails closed for unknown envelopes or rows missing usable dates and amounts", () => {
    expect(() => normalizeFreedomCashflowRows({ data: { account: [] } }))
      .toThrow(/unrecognized cashflow response/i);
    expect(() => normalizeFreedomCashflowRows({
      cashflows: [{ id: 1, date: "not-a-date", description: "fee" }]
    })).toThrow(/without usable dates and amounts/i);
  });

  it("derives signed amounts from separate debit and credit fields", () => {
    const rows = normalizeFreedomCashflowRows({
      rows: [
        { id: "debit-1", date: "2026-10-28", debit: "7.50", currency: "USD" },
        { id: "credit-1", date: "2026-10-29", credit: "125.00", currency: "USD" }
      ]
    });

    expect(rows.map(row => row.amount)).toEqual([-7.5, 125]);
  });
});

describe("Freedom cashflow incremental merge", () => {
  it("preserves saved history and updates broker rows by operation ID only", () => {
    const olderSaved: NormalizedFreedomCashflow = {
      id: "cashflow-legacy", date: "2026-09-01", type: "Margin Fee", amount: -4.25,
      currency: "USD", description: "Previously saved fee", raw: { legacy_note: "preserved" }
    };
    const existingBrokerRow: NormalizedFreedomCashflow = {
      id: "freedom-100", date: "2026-10-01", type: "Margin Fee", amount: -5,
      currency: "USD", description: "Daily margin fee", raw: { operation_id: "100" }
    };
    const updatedBrokerRow: NormalizedFreedomCashflow = {
      id: "freedom-100", date: "2026-10-01T00:00:00Z", type: "Margin Fee", amount: -5,
      currency: "USD", description: "Updated broker description", raw: { operation_id: "100" }
    };
    const distinctBrokerOperation: NormalizedFreedomCashflow = {
      id: "freedom-102", date: "2026-10-01T00:00:00Z", type: "Margin Fee", amount: -5,
      currency: "USD", description: "Daily margin fee", raw: { operation_id: "102" }
    };
    const newerBrokerOperation: NormalizedFreedomCashflow = {
      id: "freedom-101", date: "2026-10-31", type: "Margin Fee", amount: -1.25,
      currency: "USD", description: "Daily margin fee", raw: { operation_id: "101" }
    };

    const merged = mergeFreedomCashflowRows(
      [olderSaved, existingBrokerRow],
      [updatedBrokerRow, distinctBrokerOperation, newerBrokerOperation]
    );

    expect(merged).toHaveLength(4);
    expect(merged[0]).toEqual(olderSaved);
    expect(merged[1]).toMatchObject({ id: "freedom-100", description: "Updated broker description" });
    expect(merged[2]).toMatchObject({ id: "freedom-102", amount: -5 });
    expect(merged[3]).toMatchObject({ id: "freedom-101", amount: -1.25 });
  });

  it("keeps prior cashflows when the broker returns an empty recent page", () => {
    const existing: NormalizedFreedomCashflow[] = [{
      id: "freedom-older", date: "2025-01-01", type: "Margin Fee", amount: -2,
      currency: "USD", description: "Daily margin fee", raw: {}
    }];

    expect(mergeFreedomCashflowRows(existing, [])).toEqual(existing);
  });
});
