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
