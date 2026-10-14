import { Holding, BrokerAssumptions } from '../types/portfolio';
import { calculateCommission, calculateMarginInterest } from './portfolio';

export interface CombinedMetrics {
  invested: number;
  marketVal: number;
  commBuy: number;
  commSell: number;
  totalComms: number;
  grossTarget: number;
  netTarget: number;
  netPct: number;
  unrealized: number;
  unrealizedPct: number;
  marginCharged: number;
}

export const selectCombinedMetrics = (
  holdings: Holding[],
  totalAccountDebt: number,
  dailyRate: number,
  rules: BrokerAssumptions,
  realizedMarginCharged = 0
): CombinedMetrics => {
  let invested = 0;
  let marketVal = 0;
  let commBuy = 0;
  let commSell = 0;
  let grossTarget = 0;

  const allTranches: Array<{ qty: number; price: number; date?: string }> = [];

  holdings.forEach((h) => {
    const cost = h.tranches.reduce((sum, t) => sum + t.shares * t.entryPrice, 0);
    const totalShares = h.tranches.reduce((sum, t) => sum + t.shares, 0);

    invested += cost;
    marketVal += totalShares * (h.currentPrice || (totalShares > 0 ? cost / totalShares : 0));

    // Sum buy commissions per individual tranche to respect minimum order fees
    const holdingCommBuy = h.tranches.reduce(
      (sum, t) => sum + calculateCommission(t.shares, t.shares * t.entryPrice, rules as any),
      0
    );
    commBuy += holdingCommBuy;

    h.tranches.forEach((t) => {
      allTranches.push({
        qty: t.shares,
        price: t.entryPrice,
        date: t.purchaseDate
      });
    });

    const pt = h.analystTarget || (totalShares > 0 ? cost / totalShares : 0);
    const valSell = totalShares * pt;

    commSell += calculateCommission(totalShares, valSell, rules as any);
    grossTarget += valSell - cost;
  });

  const openMarginCharged =
    allTranches.length > 0
      ? calculateMarginInterest(allTranches as any, {
        dailyRate,
        marginDebt: totalAccountDebt,
        totalDebt: totalAccountDebt
      } as any)
      : 0;

  const marginCharged = realizedMarginCharged + openMarginCharged;
  const totalComms = commBuy + commSell;
  const netTarget = grossTarget - totalComms - marginCharged;
  const netPct = invested > 0 ? (netTarget / invested) * 100 : 0;
  const unrealized = marketVal - invested;
  const unrealizedPct = invested > 0 ? (unrealized / invested) * 100 : 0;

  return {
    invested,
    marketVal,
    commBuy,
    commSell,
    totalComms,
    grossTarget,
    netTarget,
    netPct,
    unrealized,
    unrealizedPct,
    marginCharged
  };
};

export const selectSingleMetrics = (
  pos: Holding | undefined,
  portfolioInvested: number,
  totalAccountDebt: number,
  totalCushion: number,
  dailyRate: number,
  rules: BrokerAssumptions
) => {
  if (!pos) return null;

  const totalShares = pos.tranches.reduce((sum, t) => sum + t.shares, 0);
  const invested = pos.tranches.reduce((sum, t) => sum + t.shares * t.entryPrice, 0);
  const avgPrice = totalShares > 0 ? invested / totalShares : 0;
  const currentPrice = pos.currentPrice || avgPrice;
  const marketVal = totalShares * currentPrice;
  const unrealized = marketVal - invested;
  const unrealizedPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

  const pt = pos.analystTarget || avgPrice;
  const valSell = totalShares * pt;

  const commBuy = pos.tranches.reduce(
    (sum, t) => sum + calculateCommission(t.shares, t.shares * t.entryPrice, rules as any),
    0
  );
  const commSell = calculateCommission(totalShares, valSell, rules as any);
  const totalComms = commBuy + commSell;
  const gross = valSell - invested;

  const weight = portfolioInvested > 0 ? invested / portfolioInvested : 1;
  const allocatedDebt = totalAccountDebt * weight;
  const allocatedCushion = totalCushion * weight;

  const mappedTranches = pos.tranches.map((t) => ({
    qty: t.shares,
    price: t.entryPrice,
    date: t.purchaseDate
  }));

  const allocatedMarginCharged =
    mappedTranches.length > 0
      ? calculateMarginInterest(mappedTranches as any, {
        dailyRate,
        marginDebt: allocatedDebt,
        totalDebt: totalAccountDebt
      } as any)
      : 0;

  const netTarget = gross - totalComms - allocatedMarginCharged;
  const netPct = invested > 0 ? (netTarget / invested) * 100 : 0;

  return {
    totalShares,
    invested,
    avgPrice,
    currentPrice,
    marketVal,
    unrealized,
    unrealizedPct,
    pt,
    gross,
    totalComms,
    commBuy,
    commSell,
    allocatedDebt,
    allocatedCushion,
    allocatedMarginCharged,
    netTarget,
    netPct
  };
};