#!/usr/bin/env python3
"""
Explore available financial metrics in yfinance for Norwegian stocks
"""

import yfinance as yf
import pandas as pd

def explore_stock_metrics(ticker_symbol):
    """Explore available metrics for a given stock"""
    print(f"\n=== Exploring {ticker_symbol} ===")
    
    try:
        stock = yf.Ticker(ticker_symbol)
        info = stock.info
        
        # Target metrics we want
        target_metrics = {
            'totalRevenue': 'Total Revenue',
            'ebitda': 'EBITDA', 
            'netIncomeToCommon': 'Net Income',
            'trailingPE': 'P/E Ratio (Trailing)',
            'forwardPE': 'P/E Ratio (Forward)',
            'priceToSalesTrailing12Months': 'P/S Ratio',
            'enterpriseToEbitda': 'EV/EBITDA',
            'enterpriseValue': 'Enterprise Value',
            'marketCap': 'Market Cap'
        }
        
        print("TARGET METRICS:")
        for key, label in target_metrics.items():
            value = info.get(key, 'N/A')
            if value != 'N/A' and isinstance(value, (int, float)):
                if key in ['totalRevenue', 'ebitda', 'netIncomeToCommon', 'enterpriseValue', 'marketCap']:
                    value = f"{value:,.0f}"
                elif key in ['trailingPE', 'forwardPE', 'priceToSalesTrailing12Months', 'enterpriseToEbitda']:
                    value = f"{value:.2f}"
            print(f"  {label}: {value}")
        
        # Other potentially useful financial metrics
        other_metrics = {
            'totalCash': 'Total Cash',
            'totalDebt': 'Total Debt',
            'bookValue': 'Book Value',
            'priceToBook': 'P/B Ratio',
            'returnOnEquity': 'ROE',
            'returnOnAssets': 'ROA',
            'operatingMargins': 'Operating Margin',
            'profitMargins': 'Profit Margin',
            'grossMargins': 'Gross Margin',
            'revenueGrowth': 'Revenue Growth',
            'earningsGrowth': 'Earnings Growth',
            'currentRatio': 'Current Ratio',
            'quickRatio': 'Quick Ratio',
            'debtToEquity': 'Debt/Equity',
            'freeCashflow': 'Free Cash Flow',
            'operatingCashflow': 'Operating Cash Flow'
        }
        
        print("\nOTHER RELEVANT METRICS:")
        available_others = {}
        for key, label in other_metrics.items():
            value = info.get(key, None)
            if value is not None:
                available_others[key] = value
                if isinstance(value, (int, float)):
                    if key in ['totalCash', 'totalDebt', 'bookValue', 'freeCashflow', 'operatingCashflow']:
                        value = f"{value:,.0f}"
                    elif key in ['operatingMargins', 'profitMargins', 'grossMargins', 'revenueGrowth', 'earningsGrowth']:
                        value = f"{value:.1%}"
                    elif isinstance(value, float):
                        value = f"{value:.2f}"
                print(f"  {label}: {value}")
        
        # Check financials for annual data
        try:
            financials = stock.financials
            if not financials.empty and len(financials.columns) > 0:
                latest_year = financials.columns[0].year
                print(f"\nFINANCIALS DATA AVAILABLE (Latest: {latest_year}):")
                financial_items = ['Total Revenue', 'Net Income', 'EBITDA', 'Operating Income', 'Gross Profit']
                for item in financial_items:
                    if item in financials.index:
                        value = financials.loc[item, financials.columns[0]]
                        if pd.notna(value):
                            print(f"  {item}: {value:,.0f}")
        except:
            print("  Financials data not available")
            
        return len([v for v in target_metrics.keys() if info.get(v) is not None])
        
    except Exception as e:
        print(f"Error fetching data for {ticker_symbol}: {e}")
        return 0

def main():
    # Test with some Norwegian stocks
    test_tickers = [
        'EQNR.OL',  # Equinor
        'DNB.OL',   # DNB
        'TEL.OL',   # Telenor  
        'MOWI.OL',  # Mowi
        'NHY.OL'    # Norsk Hydro
    ]
    
    results = {}
    for ticker in test_tickers:
        available_count = explore_stock_metrics(ticker)
        results[ticker] = available_count
    
    print(f"\n=== SUMMARY ===")
    print("Target metrics availability by stock:")
    for ticker, count in results.items():
        print(f"  {ticker}: {count}/9 target metrics available")

if __name__ == "__main__":
    main()