import yfinance as yf
import json
import pandas as pd

ticker = yf.Ticker("AFK.OL")
print(ticker.info)

data = {
    "info": ticker.info,
    "fast_info": {k: str(v) for k, v in vars(ticker.fast_info).items()} if hasattr(ticker, 'fast_info') else {},
    "income_statement": ticker.income_stmt.to_dict() if hasattr(ticker, 'income_stmt') and ticker.income_stmt is not None else {}
}

with open("yfinance_data_sample.json", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False, default=str)

print("Data saved to yfinance_data_sample.json")