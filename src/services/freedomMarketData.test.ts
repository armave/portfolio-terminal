import { describe, expect, it } from "vitest";
import { normalizeFreedomQuote } from "./freedomMarketData";

describe("normalizeFreedomQuote", () => {
  it("normalizes a quote payload with common Tradernet field names", () => {
    expect(normalizeFreedomQuote({
      quotes: [{ ticker: "AAPL.US", last: "210.5", prevClose: "205", change: "5.5", changePercent: "2.68", time: 1760000000 }]
    }, "AAPL")).toMatchObject({
      symbol: "AAPL",
      price: 210.5,
      previousClose: 205,
      change: 5.5,
      changePercent: 2.68,
      sourceTimestamp: 1760000000000
    });
  });

  it("normalizes the documented TradeNet stock-quote response fields", () => {
    expect(normalizeFreedomQuote({
      quotes: [{
        c: "GOOGL.US",
        ltp: "279.84",
        pp: "274.00",
        chg: "5.84",
        pcp: "2.1314",
        ltt: 1793450000
      }]
    }, "GOOGL")).toMatchObject({
      symbol: "GOOGL",
      price: 279.84,
      previousClose: 274,
      change: 5.84,
      changePercent: 2.1314,
      sourceTimestamp: 1793450000000
    });
  });

  it("normalizes the documented TradeNet q-array response envelope", () => {
    expect(normalizeFreedomQuote({
      q: [{
        c: "GOOGL.US",
        ltp: "279.84",
        pp: "274.00",
        chg: "5.84",
        pcp: "2.1314",
        ltt: "2026-10-31T16:54:00"
      }]
    }, "GOOGL")).toMatchObject({
      symbol: "GOOGL",
      price: 279.84,
      previousClose: 274,
      change: 5.84,
      changePercent: 2.1314
    });
  });

  it("normalizes a q-array nested inside the API response data envelope", () => {
    expect(normalizeFreedomQuote({
      data: {
        q: [{ c: "GOOGL.US", ltp: 279.84, pp: 274, chg: 5.84, pcp: 2.1314 }]
      }
    }, "GOOGL")).toMatchObject({
      price: 279.84,
      previousClose: 274,
      change: 5.84,
      changePercent: 2.1314
    });
  });

  it("derives change from previous close when the API omits it", () => {
    expect(normalizeFreedomQuote({ lastPrice: 110, previous_close: 100 }, "XYZ")).toMatchObject({
      price: 110,
      previousClose: 100,
      change: 10,
      changePercent: 10
    });
  });

  it("rejects empty, malformed, and non-positive prices", () => {
    expect(normalizeFreedomQuote(null, "AAPL")).toBeNull();
    expect(normalizeFreedomQuote({ last: "not-a-number" }, "AAPL")).toBeNull();
    expect(normalizeFreedomQuote({ last: 0 }, "AAPL")).toBeNull();
  });
});
