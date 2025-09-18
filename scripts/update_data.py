import yfinance as yf
import json
import os
from datetime import datetime
import hashlib
from dotenv import load_dotenv

load_dotenv()

def get_stock_data(symbol):
    """Get comprehensive stock data from yfinance"""
    try:
        # Create ticker object with .OL suffix for Oslo Børs
        ticker = yf.Ticker(f'{symbol}.OL')
        
        # Get stock info (includes company profile, financials, etc.)
        info = ticker.info
        
        # Get recent quote data
        hist = ticker.history(period="5d")
        current_price = hist['Close'][-1] if not hist.empty else None
        
        # Get additional data
        try:
            financials = ticker.financials
            balance_sheet = ticker.balance_sheet
        except:
            financials = None
            balance_sheet = None
        
        return {
            'info': info,
            'current_price': current_price,
            'history': hist.tail(1).to_dict('records')[0] if not hist.empty else None,
            'financials': financials.to_dict() if financials is not None else None,
            'balance_sheet': balance_sheet.to_dict() if balance_sheet is not None else None
        }
    except Exception as e:
        print(f"Error fetching data for {symbol}: {e}")
        return None

def format_large_number(num):
    """Format large numbers in readable format"""
    if num is None or num == 0:
        return "N/A"
    
    if num >= 1_000_000_000_000:  # Trillions
        return f"{num / 1_000_000_000_000:.1f}T NOK"
    elif num >= 1_000_000_000:  # Billions
        return f"{num / 1_000_000_000:.1f}B NOK"
    elif num >= 1_000_000:  # Millions
        return f"{num / 1_000_000:.0f}M NOK"
    else:
        return f"{num:,.0f} NOK"

def safe_get(data, key, default="N/A"):
    """Safely get value from dictionary with fallback"""
    if data is None:
        return default
    return data.get(key, default)

def generate_clues(stock_data, symbol, name):
    """Generate progressive clues like Financhle"""
    info = stock_data.get('info', {})
    current_price = stock_data.get('current_price')
    
    clues = []
    
    # Clue 1: Market Cap (most basic financial metric)
    market_cap = safe_get(info, 'marketCap')
    if market_cap != "N/A" and market_cap:
        clues.append(f"Market Cap: {format_large_number(market_cap)}")
    else:
        clues.append(f"Market Cap: Not available")
    
    # Clue 2: Sector/Industry
    sector = safe_get(info, 'sector')
    industry = safe_get(info, 'industry')
    if sector != "N/A":
        clues.append(f"Sector: {sector}")
    elif industry != "N/A":
        clues.append(f"Industry: {industry}")
    else:
        clues.append(f"Sector: Information not available")
    
    # Clue 3: Employee Count
    employees = safe_get(info, 'fullTimeEmployees')
    if employees != "N/A" and employees:
        if employees >= 10000:
            clues.append(f"Employees: {employees//1000}K+")
        elif employees >= 1000:
            clues.append(f"Employees: ~{employees//100 * 100:,}")
        else:
            clues.append(f"Employees: ~{employees:,}")
    else:
        clues.append(f"Employees: Information not available")
    
    # Clue 4: Current Stock Price
    if current_price:
        clues.append(f"Current Price: {current_price:.2f} NOK")
    else:
        clues.append(f"Current Price: Not available")
    
    # Clue 5: Additional Company Info
    country = safe_get(info, 'country', 'Norway')
    city = safe_get(info, 'city')
    if city != "N/A":
        clues.append(f"Headquarters: {city}, {country}")
    else:
        clues.append(f"Country: {country}")
    
    # Clue 6: Company Name (final reveal)
    clues.append(f"Company: {name}")
    
    # Add business summary if available (bonus clue)
    summary = safe_get(info, 'longBusinessSummary')
    if summary != "N/A" and len(summary) > 50:
        # Truncate to first sentence or 150 chars
        short_summary = summary.split('.')[0][:150] + "..."
        clues.append(f"Business: {short_summary}")
    
    return clues

def select_daily_stock(stocks):
    """Select today's stock deterministically"""
    today = datetime.now().strftime('%Y-%m-%d')
    hash_object = hashlib.md5(today.encode())
    hash_int = int(hash_object.hexdigest(), 16)
    stock_index = hash_int % len(stocks)
    return stocks[stock_index]

def test_single_stock(symbol):
    """Test function to check data for a single stock"""
    print(f"Testing {symbol}...")
    data = get_stock_data(symbol)
    if data and data['info']:
        print(f"✅ Success! Got data for {symbol}")
        print(f"Market Cap: {safe_get(data['info'], 'marketCap')}")
        print(f"Sector: {safe_get(data['info'], 'sector')}")
        print(f"Employees: {safe_get(data['info'], 'fullTimeEmployees')}")
        print(f"Current Price: {data.get('current_price')}")
        print(f"Country: {safe_get(data['info'], 'country')}")
        return True
    else:
        print(f"❌ Failed to get data for {symbol}")
        return False

def main():
    # Load OBX stocks
    with open('obx.json', 'r', encoding='utf-8') as f:
        obx_data = json.load(f)
    
    stocks = obx_data['stocks']
    print(f"Processing {len(stocks)} OBX stocks...")
    
    # Test with some major Norwegian stocks first
    print("Testing major Norwegian stocks:")
    test_stocks = ['EQNR', 'DNB', 'TEL', 'MOWI', 'YAR']  # Equinor, DNB, Telenor, Mowi, Yara
    
    working_stocks = []
    for symbol in test_stocks:
        if test_single_stock(symbol):
            working_stocks.append(symbol)
        print("-" * 40)
    
    print(f"\n{len(working_stocks)} out of {len(test_stocks)} test stocks working")
    
    if not working_stocks:
        print("❌ No stocks working! Check internet connection or yfinance installation")
        return
    
    # Select today's stock (try to pick from working ones if possible)
    daily_stock = select_daily_stock(stocks)
    print(f"\nToday's selected stock: {daily_stock['name']} ({daily_stock['symbol']})")
    
    # Get detailed data for today's stock
    stock_data = get_stock_data(daily_stock['symbol'])
    
    if stock_data and stock_data['info']:
        # Generate clues
        clues = generate_clues(stock_data, daily_stock['symbol'], daily_stock['name'])
        
        # Prepare daily data
        daily_data = {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'stock': {
                'symbol': daily_stock['symbol'],
                'name': daily_stock['name'],
                'clues': clues,
                'info': stock_data['info'],
                'current_price': float(stock_data['current_price']) if stock_data['current_price'] else None
            },
            'all_stocks': [{'name': s['name'], 'symbol': s['symbol']} for s in stocks]
        }
        
        # Save to data directory
        os.makedirs('data', exist_ok=True)
        with open('data/daily.json', 'w', encoding='utf-8') as f:
            json.dump(daily_data, f, ensure_ascii=False, indent=2, default=str)
        
        print(f"✅ Daily data saved for {daily_stock['name']}")
        print(f"Generated {len(clues)} clues:")
        for i, clue in enumerate(clues, 1):
            print(f"  {i}. {clue}")
        
    else:
        print(f"❌ Failed to get data for {daily_stock['name']}")
        print("Trying with a known working stock instead...")
        
        # Fallback to a working stock
        if working_stocks:
            fallback_symbol = working_stocks[0]
            fallback_stock = next(s for s in stocks if s['symbol'] == fallback_symbol)
            print(f"Using fallback: {fallback_stock['name']} ({fallback_symbol})")
            
            stock_data = get_stock_data(fallback_symbol)
            if stock_data:
                clues = generate_clues(stock_data, fallback_symbol, fallback_stock['name'])
                
                daily_data = {
                    'date': datetime.now().strftime('%Y-%m-%d'),
                    'stock': {
                        'symbol': fallback_stock['symbol'],
                        'name': fallback_stock['name'],
                        'clues': clues,
                        'info': stock_data['info'],
                        'current_price': float(stock_data['current_price']) if stock_data['current_price'] else None
                    },
                    'all_stocks': [{'name': s['name'], 'symbol': s['symbol']} for s in stocks]
                }
                
                os.makedirs('data', exist_ok=True)
                with open('data/daily.json', 'w', encoding='utf-8') as f:
                    json.dump(daily_data, f, ensure_ascii=False, indent=2, default=str)
                
                print(f"✅ Fallback data saved for {fallback_stock['name']}")

if __name__ == "__main__":
    main()