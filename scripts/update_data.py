#!/usr/bin/env python3
"""
update_data.py — Robust daily generator for Finansle
- Resolves paths relative to repo
- Handles obx.json as list OR {"metadata":..., "stocks":[...]}
- Fetches 5y daily history and writes chart_data into data/daily.json
"""

import json
import logging
import random
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import yfinance as yf
import pandas as pd

# ---------- logging ----------
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
log = logging.getLogger("finansle.update_data")

# ---------- paths ----------
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DATA_DIR = REPO_ROOT / "data"
OBX_PATH = DATA_DIR / "obx.json"
DAILY_PATH = DATA_DIR / "daily.json"

def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

# ---------- helpers ----------
def normalize_ticker(ticker: str) -> str:
    if not ticker:
        return ""
    t = ticker.strip().upper()
    return t if t.endswith(".OL") else f"{t}.OL"

def format_market_cap_nok(val) -> str:
    try:
        n = float(val or 0)
    except Exception:
        return "Ikke tilgjengelig"
    if n <= 0:
        return "Ikke tilgjengelig"
    if n >= 1e12:
        return f"{n/1e12:.1f} bill NOK"
    if n >= 1e9:
        return f"{n/1e9:.1f} mrd NOK"
    return f"{n/1e6:.0f} mill NOK"

def format_revenue_nok(val) -> str:
    """Format revenue in NOK with appropriate units"""
    try:
        n = float(val or 0)
    except Exception:
        return "Ikke tilgjengelig"
    if n == 0:  # Only filter out zero, not negative
        return "Ikke tilgjengelig"
    
    abs_n = abs(n)  # Use absolute value for formatting
    if abs_n >= 1e12:
        formatted = f"{n/1e12:.1f} bill NOK"
    elif abs_n >= 1e9:
        formatted = f"{n/1e9:.0f} mrd NOK" 
    elif abs_n >= 1e6:
        formatted = f"{n/1e6:.0f} mill NOK"
    else:
        formatted = f"{n:,.0f} NOK"
    
    return formatted

def format_financial_ratio(val, decimals=2, allow_negative=False) -> str:
    """Format financial ratios with proper decimal places"""
    try:
        n = float(val or 0)
        if n == 0:
            return "Ikke tilgjengelig"
        # For P/E ratios, show negative values; for others, don't
        if n < 0 and not allow_negative:
            return "Ikke tilgjengelig"
        return f"{n:.{decimals}f}"
    except Exception:
        return "Ikke tilgjengelig"

def retry(fn, attempts=3, delay=1.0, factor=1.6, what="operation"):
    d = delay
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            if i == attempts - 1:
                log.error(f"{what} failed after {attempts} attempts: {e}")
                raise
            log.warning(f"{what} failed (try {i+1}/{attempts}): {e}; retrying…")
            time.sleep(d)
            d *= factor

# ---------- pulls ----------
def get_historical_chart_data(ticker: str, period="5y") -> List[Dict]:
    """Return list of {date, price, high, low, volume} for 5y daily, with anomaly smoothing."""
    t = normalize_ticker(ticker)

    def _pull():
        return yf.Ticker(t).history(period=period, interval="1d", auto_adjust=False)

    try:
        hist: pd.DataFrame = retry(_pull, attempts=3, delay=1.0, factor=1.5, what=f"history({t})")
    except Exception:
        return []

    if hist is None or hist.empty:
        log.warning(f"No historical data for {t}")
        return []

    hist = hist.dropna(subset=["Close"])
    if hist.empty:
        log.warning(f"No 'Close' data for {t}")
        return []

    out: List[Dict] = []
    for date, row in hist.iterrows():
        try:
            out.append({
                "date": pd.Timestamp(date).strftime("%Y-%m-%d"),
                "price": round(float(row["Close"]), 2),
                "high": round(float(row.get("High", row["Close"])), 2),
                "low":  round(float(row.get("Low",  row["Close"])), 2),
                "volume": int(row.get("Volume", 0) or 0),
            })
        except Exception:
            continue

    out.sort(key=lambda x: x["date"])
    
    if len(out) > 800:  # light downsample
        out = out[::2]
    return out

def calculate_performance_metrics(chart: List[Dict]) -> Dict[str, float]:
    if len(chart) < 2:
        return {"performance_5y": 0.0, "performance_2y": 0.0, "performance_1y": 0.0, "volatility": 0.0}

    def pct(a, b): return 0.0 if a <= 0 else (b - a) / a * 100.0

    first = chart[0]["price"]
    last  = chart[-1]["price"]

    end_dt = datetime.strptime(chart[-1]["date"], "%Y-%m-%d")
    two_y  = end_dt.replace(year=end_dt.year - 2).strftime("%Y-%m-%d")
    one_y  = end_dt.replace(year=end_dt.year - 1).strftime("%Y-%m-%d")

    def price_on_or_after(iso):
        for pt in chart:
            if pt["date"] >= iso:
                return pt["price"]
        return chart[0]["price"]

    p2y = price_on_or_after(two_y)
    p1y = price_on_or_after(one_y)

    # annualized vol from last ~252 sessions
    sample = chart[-252:] if len(chart) >= 252 else chart
    rets = []
    for i in range(1, len(sample)):
        prev = sample[i-1]["price"]
        curr = sample[i]["price"]
        if prev > 0:
            rets.append((curr - prev) / prev)
    if rets:
        avg = sum(rets) / len(rets)
        var = sum((r - avg) ** 2 for r in rets) / len(rets)
        vol = (var ** 0.5) * (252 ** 0.5) * 100.0
    else:
        vol = 0.0

    return {
        "performance_5y": round(pct(first, last), 2),
        "performance_2y": round(pct(p2y, last), 2),
        "performance_1y": round(pct(p1y, last), 2),
        "volatility": round(vol, 2),
    }

def fetch_enhanced_stock_data(ticker: str) -> Optional[Dict]:
    """Fetch profile + 5y chart, derive metrics from chart."""
    ticker_norm = normalize_ticker(ticker)
    log.info(f"Fetching data for {ticker_norm}")

    def _info():
        st = yf.Ticker(ticker_norm)
        return st, st.info

    try:
        stock, info = retry(_info, attempts=3, delay=1.0, factor=1.5, what=f"info({ticker_norm})")
    except Exception:
        return None

    # price
    price = None
    try:
        fi = getattr(stock, "fast_info", None)
        if fi and getattr(fi, "last_price", None):
            price = float(fi.last_price)
    except Exception:
        pass

    if price is None:
        def _last5d():
            return stock.history(period="5d", interval="1d", auto_adjust=False)
        try:
            h: pd.DataFrame = retry(_last5d, attempts=3, delay=1.0, factor=1.5, what=f"current history({ticker_norm})")
            if h is not None and not h.empty:
                price = float(h["Close"].iloc[-1])
        except Exception:
            price = None
    if price is None:
        price = float(info.get("currentPrice") or info.get("regularMarketPrice") or 0.0)
    current_price = price

    chart = get_historical_chart_data(ticker_norm, period="5y")
    perf = calculate_performance_metrics(chart) if chart else {
        "performance_5y": 0.0, "performance_2y": 0.0, "performance_1y": 0.0, "volatility": 0.0
    }

    # Extract new financial metrics
    revenue_2024 = info.get("totalRevenue", 0)
    ebitda_2024 = info.get("ebitda", 0)
    net_earnings_2024 = info.get("netIncomeToCommon", 0)
    pe_ratio = info.get("trailingPE", 0)
    ps_ratio = info.get("priceToSalesTrailing12Months", 0)
    ev_ebitda = info.get("enterpriseToEbitda", 0)
    
    log.info(f"Financial metrics - Revenue: {format_revenue_nok(revenue_2024)}, "
             f"PE: {format_financial_ratio(pe_ratio)}, PS: {format_financial_ratio(ps_ratio)}")

    # 52w range: prefer info; else derive from last year of chart
    hi = info.get("fiftyTwoWeekHigh")
    lo = info.get("fiftyTwoWeekLow")
    if (hi is None or lo is None) and chart:
        end_dt = datetime.strptime(chart[-1]["date"], "%Y-%m-%d")
        one_y  = end_dt.replace(year=end_dt.year - 1).strftime("%Y-%m-%d")
        last_y = [pt["price"] for pt in chart if pt["date"] >= one_y]
        if last_y:
            hi = max(last_y)
            lo = min(last_y)

    mcap_raw = float(info.get("marketCap") or 0)
    data = {
        "company_name": info.get("longName") or info.get("shortName") or ticker_norm,
        "ticker": ticker_norm,
        "current_price": round(float(current_price or 0), 2),
        "market_cap": format_market_cap_nok(info.get("marketCap")),
        "market_cap_raw": int(info.get("marketCap") or 0),
        "sector": info.get("sector") or "Ukjent",
        "industry": info.get("industry") or "Ukjent",
        "employees": int(info.get("fullTimeEmployees") or 0),
        "headquarters": ", ".join([x for x in [info.get("city"), info.get("country")] if x]) or "Norge",
        "description": info.get("longBusinessSummary") or "Norsk børsnotert selskap",
        "price_52w_high": round(float(hi or 0), 2),
        "price_52w_low": round(float(lo or 0), 2),
        "performance_5y": perf["performance_5y"],
        "performance_2y": perf["performance_2y"],
        "performance_1y": perf["performance_1y"],
        "volatility": perf["volatility"],
        # NEW FINANCIAL METRICS
        "revenue_2024": int(revenue_2024) if revenue_2024 else 0,
        "revenue_2024_formatted": format_revenue_nok(revenue_2024),
        "ebitda_2024": int(ebitda_2024) if ebitda_2024 else 0,
        "ebitda_2024_formatted": format_revenue_nok(ebitda_2024),
        "net_earnings_2024": int(net_earnings_2024) if net_earnings_2024 else 0,
        "net_earnings_2024_formatted": format_revenue_nok(net_earnings_2024),
        "pe_ratio": float(pe_ratio) if pe_ratio else 0,
        "pe_ratio_formatted": format_financial_ratio(pe_ratio),
        "ps_ratio": float(ps_ratio) if ps_ratio else 0,
        "ps_ratio_formatted": format_financial_ratio(ps_ratio),
        "ev_ebitda": float(ev_ebitda) if ev_ebitda else 0,
        "ev_ebitda_formatted": format_financial_ratio(ev_ebitda),
        "chart_data": chart,
        "last_updated": datetime.now().isoformat(timespec="seconds"),
    }
    log.info(f"✅ {data['company_name']}: price {data['current_price']} NOK, 5Y {data['performance_5y']}%, points {len(chart)}")
    return data

# ---------- selection / hints ----------
def load_obx_list() -> List[Dict]:
    """Return a list of {name, ticker} from data/obx.json in either supported shape."""
    ensure_data_dir()
    if not OBX_PATH.exists():
        raise FileNotFoundError(f"Missing {OBX_PATH}")

    with OBX_PATH.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    # Case 1: already a list
    if isinstance(raw, list):
        items = raw
    # Case 2: object with "stocks" array (your file)
    elif isinstance(raw, dict) and isinstance(raw.get("stocks"), list):
        items = raw["stocks"]
    else:
        raise ValueError(f"Unsupported schema in {OBX_PATH}; expected list or object with 'stocks' array")

    out: List[Dict] = []
    for it in items:
        name = it.get("name") or it.get("company_name") or it.get("symbol") or it.get("ticker")
        sym  = it.get("ticker") or it.get("symbol") or ""
        if not sym:
            continue
        out.append({"name": name, "ticker": sym})
    if not out:
        raise ValueError(f"No usable entries in {OBX_PATH}")
    return out

def select_daily_stock() -> Dict:
    """Deterministic but random pick from obx list using date seed."""
    stocks = load_obx_list()
    today = datetime.now()
    
    # Use date as seed for deterministic randomness
    random.seed(int(today.strftime("%Y%m%d")))
    
    # Shuffle the entire list deterministically, then pick first one
    shuffled_stocks = stocks.copy()
    random.shuffle(shuffled_stocks)
    choice = shuffled_stocks[0]
    
    log.info(f"📅 Selected {choice['name']} ({choice['ticker']}) for {today.strftime('%Y-%m-%d')} from {OBX_PATH} (n={len(stocks)})")
    return choice

def calculate_difficulty_rating(stock: Dict) -> int:
    try:
        diff = 3
        mcap = float(stock.get("market_cap_raw") or 0)
        if mcap > 100e9: diff -= 1
        elif mcap < 10e9: diff += 1

        sector = (stock.get("sector") or "").lower()
        if any(x in sector for x in ("energy", "financial", "telecommunication", "communication", "telecom")):
            diff -= 1

        employees = int(stock.get("employees") or 0)
        if employees > 20000: diff -= 1
        elif employees < 1000: diff += 1

        return max(1, min(5, diff))
    except Exception:
        return 3

def get_hint_categories(stock: Dict) -> List[str]:
    cats = ["market_cap", "sector", "employees", "price_range", "location"]
    if len(stock.get("description", "")) > 50:
        cats.append("description")
    if abs(float(stock.get("performance_2y") or 0)) > 10:
        cats.append("performance")
    return cats

def print_summary(stock: Dict):
    print("\n" + "=" * 60)
    print("📈 TODAY'S FINANSLE STOCK")
    print("=" * 60)
    print(f"Company:     {stock['company_name']}")
    print(f"Ticker:      {stock['ticker']}")
    print(f"Price:       {stock['current_price']} NOK")
    print(f"Market Cap:  {stock['market_cap']}")
    print(f"Sector:      {stock['sector']}")
    print(f"2Y Perf:     {stock['performance_2y']:+.1f}%")
    print(f"Chart Pts:   {len(stock['chart_data'])}")
    print(f"Difficulty:  {stock['difficulty_rating']}/5 ⭐")
    print("=" * 60)

def smooth_price_anomalies(chart_data: List[Dict], threshold_multiplier: float = 20.0) -> List[Dict]:
    """
    Detect and smooth out obvious price anomalies/spikes in chart data.
    """
    if len(chart_data) < 10:
        return chart_data
    
    # Create a working copy
    smoothed_data = [pt.copy() for pt in chart_data]
    
    # Calculate rolling median with window size of 10 days
    window_size = min(10, len(chart_data) // 4)
    
    for i in range(len(smoothed_data)):
        # Get window around current point
        start_idx = max(0, i - window_size // 2)
        end_idx = min(len(smoothed_data), i + window_size // 2 + 1)
        
        window_prices = [smoothed_data[j]["price"] for j in range(start_idx, end_idx)]
        window_prices.sort()
        
        # Calculate median
        n = len(window_prices)
        median = window_prices[n // 2] if n % 2 == 1 else (window_prices[n // 2 - 1] + window_prices[n // 2]) / 2
        
        current_price = smoothed_data[i]["price"]
        
        # If current price is more than threshold_multiplier times the median, it's likely an anomaly
        if current_price > median * threshold_multiplier or current_price < median / threshold_multiplier:
            log.warning(f"Detected price anomaly at {smoothed_data[i]['date']}: {current_price} NOK (median: {median:.2f} NOK)")
            
            # Replace with interpolated value
            if i == 0:
                # First point - use median of next few points
                smoothed_data[i]["price"] = round(median, 2)
            elif i == len(smoothed_data) - 1:
                # Last point - use median of previous few points
                smoothed_data[i]["price"] = round(median, 2)
            else:
                # Middle point - interpolate between previous and next valid points
                prev_price = smoothed_data[i-1]["price"]
                next_price = smoothed_data[i+1]["price"]
                interpolated = (prev_price + next_price) / 2
                smoothed_data[i]["price"] = round(interpolated, 2)
            
            # Also adjust high and low to be consistent
            new_price = smoothed_data[i]["price"]
            smoothed_data[i]["high"] = round(max(new_price * 1.02, smoothed_data[i].get("high", new_price)), 2)
            smoothed_data[i]["low"] = round(min(new_price * 0.98, smoothed_data[i].get("low", new_price)), 2)
            
            log.info(f"Smoothed anomaly: {current_price} → {new_price} NOK")
    
    return smoothed_data

# ---------- main ----------
def main():
    log.info("🚀 Starting enhanced stock data generation…")
    ensure_data_dir()

    try:
        picked = select_daily_stock()
    except Exception as e:
        log.error(str(e))
        log.error("Failed to select daily stock (check data/obx.json).")
        return

    base_ticker = picked.get("ticker") or picked.get("symbol") or ""
    if not base_ticker:
        log.error("Selected stock has no ticker/symbol field.")
        return

    data = fetch_enhanced_stock_data(base_ticker)
    if not data:
        log.error(f"Failed to fetch enhanced data for {base_ticker}")
        return

    data["difficulty_rating"] = calculate_difficulty_rating(data)
    data["hint_categories"] = get_hint_categories(data)

    # Write atomically
    tmp = DAILY_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(DAILY_PATH)

    log.info(f"✅ Saved {DAILY_PATH} ({len(data['chart_data'])} chart points)")
    print_summary(data)

if __name__ == "__main__":
    main()
