// Technical indicators computed on Binance klines (public, keyless). Closed candles only.

export function sma(closes, period) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += closes[j];
    return s / period;
  });
}

export function ema(closes, period) {
  const k = 2 / (period + 1);
  const out = [closes[0]];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] * k + out[i - 1] * (1 - k));
  return out;
}

export function rsi(closes, period = 14) {
  const out = [null];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0), loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      out.push(i === period ? 100 - 100 / (1 + avgGain / (avgLoss || 1e-12)) : null);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-12)));
    }
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const sig = ema(line, signalPeriod);
  return { line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
}

export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  return closes.map((c, i) => {
    if (i < period - 1) return null;
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) { const d = closes[j] - mid[i]; s += d * d; }
    const sd = Math.sqrt(s / period);
    const upper = mid[i] + mult * sd, lower = mid[i] - mult * sd;
    return { mid: mid[i], upper, lower, pos: upper === lower ? 0.5 : (c - lower) / (upper - lower) };
  });
}

export function stochastic(candles, period = 14) {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hh = Math.max(hh, candles[j].high); ll = Math.min(ll, candles[j].low); }
    return hh === ll ? 50 : ((c.close - ll) / (hh - ll)) * 100;
  });
}

export function atr(candles, period = 14) {
  const tr = candles.map((c, i) => i === 0 ? c.high - c.low
    : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
  const out = [null];
  let a = 0;
  for (let i = 1; i < candles.length; i++) {
    if (i <= period) { a += tr[i] / period; out.push(i === period ? a : null); }
    else { a = (a * (period - 1) + tr[i]) / period; out.push(a); }
  }
  return out;
}

export function atrPct(candles, period = 14) {
  return atr(candles, period).map((v, i) => (v == null ? null : (v / candles[i].close) * 100));
}

export function volumeRatio(candles, baseline = 20) {
  const v = candles.map((x) => x.volume);
  const base = sma(v, baseline);
  return v.map((x, i) => (base[i] == null || base[i] === 0 ? null : x / base[i]));
}

export function roc(series, period = 10) {
  return series.map((x, i) => (i < period || series[i - period] === 0 ? null : ((x - series[i - period]) / series[i - period]) * 100));
}

// max/min of the PREVIOUS period bars (excludes current) — for breakout conditions
export function rollingHigh(series, period) {
  return series.map((_, i) => {
    if (i < period) return null;
    let m = -Infinity;
    for (let j = i - period; j < i; j++) m = Math.max(m, series[j]);
    return m;
  });
}

export function rollingLow(series, period) {
  return series.map((_, i) => {
    if (i < period) return null;
    let m = Infinity;
    for (let j = i - period; j < i; j++) m = Math.min(m, series[j]);
    return m;
  });
}
