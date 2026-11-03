import { describe, expect, it, vi } from "vitest";
import { fetchFreedomTradeNetQuoteStreamOnce, proxyFetch } from "./api";
import { fetchFreedomQuote, fetchFreedomQuoteWebSocket, normalizeFreedomQuote } from "./freedomMarketData";

vi.mock("./api", () => ({
  proxyFetch: vi.fn(),
  fetchFreedomTradeNetQuoteStreamOnce: vi.fn()
}));

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

  it("bypasses the closed-session cache for a forced Freedom quote", async () => {
    vi.mocked(proxyFetch).mockResolvedValue({
      data: { q: [{ c: "AAPL.US", ltp: 215, pp: 200, chg: 15, pcp: 7.5 }] }
    });

    await expect(fetchFreedomQuote("AAPL", true)).resolves.toMatchObject({ price: 215 });
    expect(proxyFetch).toHaveBeenCalledWith(
      "freedom-quote",
      { symbol: "AAPL.US" },
      { cache: "no-store" }
    );
  });


  it("uses the authenticated q WebSocket payload for the requested ticker", async () => {
    vi.mocked(fetchFreedomTradeNetQuoteStreamOnce).mockResolvedValue({
      ok: true,
      source: "authenticated_websocket",
      symbol: "AAPL.US",
      data: { q: [{ c: "AAPL.US", ltp: 215, pp: 200, chg: 15, pcp: 7.5, bbp: 214.9, bap: 215.1, vol: 1234, ltt: "2026-11-03T15:30:00", UTCOffset: -300, acc_srv_tm: "2026-11-03 15:30:01.000" }] }
    });

    await expect(fetchFreedomQuoteWebSocket("AAPL")).resolves.toMatchObject({
      symbol: "AAPL",
      price: 215,
      previousClose: 200,
      change: 15,
      changePercent: 7.5,
      bid: 214.9,
      ask: 215.1,
      volume: 1234,
      lastTradeTime: "2026-11-03T15:30:00",
      utcOffset: -300,
      serverTime: "2026-11-03 15:30:01.000"
    });
    expect(fetchFreedomTradeNetQuoteStreamOnce).toHaveBeenCalledWith(
      "AAPL.US",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("rejects unconfirmed, mismatched, and invalid WebSocket quote payloads", async () => {
    vi.mocked(fetchFreedomTradeNetQuoteStreamOnce).mockResolvedValueOnce({
      ok: false, error: "TradeNet quote event was not confirmed."
    });
    await expect(fetchFreedomQuoteWebSocket("AAPL")).rejects.toThrow("TradeNet quote event was not confirmed.");

    vi.mocked(fetchFreedomTradeNetQuoteStreamOnce).mockResolvedValueOnce({
      ok: true, source: "authenticated_websocket", symbol: "AAPL.US",
      data: { q: [{ c: "MSFT.US", ltp: 215 }] }
    });
    await expect(fetchFreedomQuoteWebSocket("AAPL")).rejects.toThrow("different ticker");

    vi.mocked(fetchFreedomTradeNetQuoteStreamOnce).mockResolvedValueOnce({
      ok: true, source: "authenticated_websocket", symbol: "AAPL.US",
      data: { q: [{ c: "AAPL.US", ltp: 0 }] }
    });
    await expect(fetchFreedomQuoteWebSocket("AAPL")).rejects.toThrow("unsupported quote payload");
  });

  it("normalizes a close market state without guessing a source timestamp from ISO local time", () => {
    const quote = normalizeFreedomQuote({
      q: [{
        c: "GOOGL.US", ltp: 280.55, pp: 279.84, chg: 0.72, pcp: 0.26,
        ltt: "2026-11-02T19:19:38", UTCOffset: -300,
        marketStatus: "CLOSE", acc_srv_tm: "2026-11-03 10:30:50.880"
      }]
    }, "GOOGL");

    expect(quote).toMatchObject({
      price: 280.55,
      marketState: "CLOSED",
      sourceTimestamp: null,
      lastTradeTime: "2026-11-02T19:19:38",
      utcOffset: -300,
      serverTime: "2026-11-03 10:30:50.880"
    });
  });

  it("rejects empty, malformed, and non-positive prices", () => {
    expect(normalizeFreedomQuote(null, "AAPL")).toBeNull();
    expect(normalizeFreedomQuote({ last: "not-a-number" }, "AAPL")).toBeNull();
    expect(normalizeFreedomQuote({ last: 0 }, "AAPL")).toBeNull();
  });
});
