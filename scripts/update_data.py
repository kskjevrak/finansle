"""
update_data.py — Robust daily generator for Finansle
Fixed version with proper timezone handling and error reporting
"""

import json
import logging
import random
import time
import requests
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import yfinance as yf
import pandas as pd

# ---------- logging ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s:%(name)s:%(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("update_data.log")
    ]
)
log = logging.getLogger("finansle.update_data")

# ---------- paths ----------
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DATA_DIR = REPO_ROOT / "data"
OBX_PATH = DATA_DIR / "obx.json"
DAILY_PATH = DATA_DIR / "daily.json"

def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log.info(f"Data directory ensured at: {DATA_DIR}")

def get_oslo_date() -> str:
    """Get current date in Oslo timezone (UTC+1/UTC+2)"""
    # Oslo is UTC+1 (CET) or UTC+2 (CEST) depending on DST
    # For simplicity, use UTC and adjust by 1 hour to ensure consistency
    utc_now = datetime.now(timezone.utc)
    oslo_offset = timedelta(hours=1)  # CET baseline
    oslo_time = utc_now + oslo_offset
    date_str = oslo_time.strftime("%Y-%m-%d")
    log.info(f"Oslo date calculated: {date_str} (UTC: {utc_now.strftime('%Y-%m-%d %H:%M:%S')})")
    return date_str

class CurrencyHandler:
    """Handle currency detection and conversion for Norwegian stocks"""
    
    def __init__(self):
        self.usd_nok_rate = None
        self.rate_timestamp = None
        self.cache_duration = timedelta(hours=1)
        
    def get_usd_nok_rate(self) -> float:
        """Get current USD/NOK exchange rate with caching"""
        now = datetime.now(timezone.utc)
        
        if (self.usd_nok_rate is not None and 
            self.rate_timestamp is not None and 
            now - self.rate_timestamp < self.cache_duration):
            return self.usd_nok_rate
        
        rate = self._fetch_exchange_rate()
        if rate:
            self.usd_nok_rate = rate
            self.rate_timestamp = now
            log.info(f"Updated USD/NOK rate: {rate:.4f}")
            return rate
        
        fallback_rate = 10.5
        log.warning(f"Using fallback USD/NOK rate: {fallback_rate}")
        return fallback_rate
    
    def _fetch_exchange_rate(self) -> Optional[float]:
        """Fetch USD/NOK rate from multiple sources"""
        
        # Method 1: yfinance
        try:
            usd_nok = yf.Ticker("USDNOK=X")
            info = usd_nok.info
            rate = info.get('regularMarketPrice') or info.get('ask') or info.get('bid')
            if rate and rate > 0:
                log.debug(f"Got USD/NOK rate from yfinance: {rate}")
                return float(rate)
        except Exception as e:
            log.debug(f"yfinance USD/NOK failed: {e}")
        
        # Method 2: Norges Bank API
        try:
            response = requests.get(
                "https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=json&lastNObservations=1",
                timeout=5
            )
            if response.status_code == 200:
                data = response.json()
                if 'observations' in data and len(data['observations']) > 0:
                    rate = float(data['observations'][0]['value'])
                    log.debug(f"Got USD/NOK rate from Norges Bank: {rate}")
                    return rate
        except Exception as e:
            log.debug(f"Norges Bank API failed: {e}")
        
        # Method 3: Free currency API
        try:
            response = requests.get(
                "https://api.exchangerate-api.com/v4/latest/USD",
                timeout=5
            )
            if response.status_code == 200:
                data = response.json()
                if 'rates' in data and 'NOK' in data['rates']:
                    rate = float(data['rates']['NOK'])
                    log.debug(f"Got USD/NOK rate from exchangerate-api: {rate}")
                    return rate
        except Exception as e:
            log.debug(f"exchangerate-api failed: {e}")
        
        return None
    
    def detect_financial_currency(self, ticker_symbol: str, info: Dict) -> str:
        """Detect the currency used in financial statements"""
        financial_currency = info.get('financialCurrency')
        if financial_currency:
            log.info(f"Financial currency from info: {financial_currency}")
            return financial_currency.upper()
        
        currency = info.get('currency')
        if currency and currency.upper() == 'USD':
            return 'USD'
        
        market_cap = info.get('marketCap', 0)
        employees = info.get('fullTimeEmployees', 0)
        sector = info.get('sector', '').lower()
        
        if market_cap > 50e9 or employees > 10000:
            log.info(f"Large company detected for {ticker_symbol}, likely USD financials")
            return 'USD'
        
        if 'energy' in sector or 'oil' in sector:
            log.info(f"Energy sector detected for {ticker_symbol}, likely USD financials")
            return 'USD'
        
        log.info(f"Assuming NOK financials for {ticker_symbol}")
        return 'NOK'
    
    def convert_to_nok(self, value: Optional[float], source_currency: str) -> Optional[float]:
        """Convert financial value to NOK if needed"""
        if value is None or value == 0:
            return value
        
        if source_currency.upper() == 'NOK':
            return value
        
        if source_currency.upper() == 'USD':
            rate = self.get_usd_nok_rate()
            converted = value * rate
            log.debug(f"Converted {value:,.0f} USD to {converted:,.0f} NOK (rate: {rate:.4f})")
            return converted
        
        log.warning(f"Unknown currency {source_currency}, returning original value")
        return value
    
    def normalize_financial_data(self, robust_data: Dict, ticker_symbol: str, info: Dict) -> Dict:
        """Normalize all financial data to NOK"""
        financial_currency = self.detect_financial_currency(ticker_symbol, info)
        normalized_data = robust_data.copy()
        
        financial_fields = [
            'ebitda_ttm', 'ebitda_latest', 
            'total_revenue_ttm', 'total_revenue_latest'
        ]
        
        for field in financial_fields:
            original_value = robust_data.get(field)
            if original_value is not None:
                normalized_value = self.convert_to_nok(original_value, financial_currency)
                normalized_data[field] = normalized_value
                
                if financial_currency != 'NOK':
                    if 'data_quality_issues' not in normalized_data:
                        normalized_data['data_quality_issues'] = []
                    normalized_data['data_quality_issues'].append(
                        f"Converted {field} from {financial_currency} to NOK"
                    )
        
        normalized_data['financial_currency_detected'] = financial_currency
        normalized_data['price_currency'] = 'NOK'
        normalized_data['currency_conversion_applied'] = financial_currency != 'NOK'
        
        return normalized_data

class ValuationExtractor:
    """Robust valuation metrics extractor with comprehensive error handling"""
    
    def __init__(self, ticker_symbol: str):
        self.ticker_symbol = ticker_symbol
        self.ticker = yf.Ticker(ticker_symbol)
        self.info = {}
        self.data_quality_issues = []
        self.currency_handler = CurrencyHandler()
        
    def get_comprehensive_metrics(self) -> Dict[str, Any]:
        """Extract all valuation metrics with validation and currency conversion"""
        try:
            self.info = self.ticker.info or {}
        except Exception as e:
            log.warning(f"Failed to get ticker info for {self.ticker_symbol}: {e}")
            self.info = {}
            
        if not self.info:
            log.error(f"No info data available for {self.ticker_symbol}")
            return self._get_fallback_metrics()
        
        robust_financial_data = self._get_robust_financial_metrics()
        normalized_financial_data = self.currency_handler.normalize_financial_data(
            robust_financial_data, self.ticker_symbol, self.info
        )
        
        # Hent kursmålsdata
        target_mean = self._safe_extract('targetMeanPrice')
        target_high = self._safe_extract('targetHighPrice')
        target_low = self._safe_extract('targetLowPrice')

        metrics = {
            'ticker': self.ticker_symbol,
            'market_cap': self._safe_extract('marketCap'),
            'market_cap_formatted': self._format_market_cap(self._safe_extract('marketCap')),
            'enterprise_value': self._calculate_enterprise_value(),
            'enterprise_value_formatted': self._format_market_cap(self._calculate_enterprise_value()),
            'trailing_pe': self._get_trailing_pe(),
            'forward_pe': self._safe_extract('forwardPE'),
            'peg_ratio': self._safe_extract('pegRatio'),
            'price_to_book': self._safe_extract('priceToBook'),
            'price_to_sales': self._get_price_to_sales_with_ttm(normalized_financial_data),
            'ev_revenue': self._safe_extract('enterpriseToRevenue'),
            'ev_ebitda': self._get_ev_ebitda_with_ttm(normalized_financial_data),
            'total_revenue': normalized_financial_data.get('total_revenue_ttm'),
            'revenue_formatted': self._format_revenue(normalized_financial_data.get('total_revenue_ttm')),
            'revenue_latest': normalized_financial_data.get('total_revenue_latest'),
            'ebitda': normalized_financial_data.get('ebitda_ttm'),
            'ebitda_formatted': self._format_revenue(normalized_financial_data.get('ebitda_ttm')),
            'ebitda_latest': normalized_financial_data.get('ebitda_latest'),
            'ebitda_source': normalized_financial_data.get('ebitda_source'),
            'ebitda_period': normalized_financial_data.get('ebitda_period'),
            'ebitda_timestamp': normalized_financial_data.get('data_timestamp'),
            'financial_currency_detected': normalized_financial_data.get('financial_currency_detected'),
            'currency_conversion_applied': normalized_financial_data.get('currency_conversion_applied'),
            'net_income': self._safe_extract('netIncomeToCommon'),
            'net_income_formatted': self._format_revenue(self._safe_extract('netIncomeToCommon')),
            'total_cash': self._safe_extract('totalCash'),
            'total_debt': self._safe_extract('totalDebt'),
            'ev_ebitda_formatted': self._format_ratio(self._get_ev_ebitda_with_ttm(normalized_financial_data)),
            'price_to_sales_formatted': self._format_ratio(self._get_price_to_sales_with_ttm(normalized_financial_data)),
            'trailing_pe_formatted': self._format_ratio(self._get_trailing_pe()),
            'forward_pe_formatted': self._format_ratio(self._safe_extract('forwardPE')),
            'peg_ratio_formatted': self._format_ratio(self._safe_extract('pegRatio')),
            'price_to_book_formatted': self._format_ratio(self._safe_extract('priceToBook')),
            'ev_revenue_formatted': self._format_ratio(self._safe_extract('enterpriseToRevenue')),
            'target_mean': target_mean,
            'target_high': target_high,
            'target_low': target_low,
            'target_mean_formatted': f"{target_mean:.0f} NOK" if target_mean else "Ikke tilgjengelig",
            'target_range_formatted': f"{target_low:.0f} - {target_high:.0f} NOK" if (target_low and target_high) else "Ikke tilgjengelig",
            'data_quality_score': 0,
            'data_quality_issues': self.data_quality_issues + normalized_financial_data.get('data_quality_issues', [])
        }
        
        key_metrics = ['market_cap', 'trailing_pe', 'price_to_book', 'price_to_sales', 'enterprise_value']
        available_count = sum(1 for key in key_metrics if metrics.get(key) is not None)
        metrics['data_quality_score'] = round(available_count / len(key_metrics), 2)
        
        self._validate_metrics(metrics)
        
        return metrics
    
    def _get_robust_financial_metrics(self) -> Dict[str, Any]:
        """Get financial metrics with proper TTM calculations"""
        result = {
            'ebitda_ttm': None,
            'ebitda_latest': None,
            'ebitda_source': None,
            'ebitda_period': None,
            'total_revenue_ttm': None,
            'total_revenue_latest': None,
            'revenue_source': None,
            'revenue_period': None,
            'data_timestamp': None,
            'data_quality_issues': []
        }
        
        # Try quarterly data first
        try:
            quarterly = self.ticker.quarterly_financials
            if not quarterly.empty and len(quarterly.columns) >= 4:
                log.info(f"Attempting TTM calculation from quarterly data for {self.ticker_symbol}")
                
                last_4_quarters = quarterly.iloc[:, :4]
                
                ebitda_keys = ['EBITDA', 'Normalized EBITDA']
                for key in ebitda_keys:
                    if key in quarterly.index:
                        ebitda_values = [quarterly.loc[key, col] for col in last_4_quarters.columns 
                                       if pd.notna(quarterly.loc[key, col])]
                        
                        if len(ebitda_values) >= 4:
                            ttm_ebitda = sum(ebitda_values)
                            result['ebitda_ttm'] = float(ttm_ebitda)
                            result['ebitda_latest'] = float(quarterly.loc[key, quarterly.columns[0]])
                            result['ebitda_source'] = f'quarterly_ttm.{key}'
                            result['ebitda_period'] = f'TTM_ending_{quarterly.columns[0].strftime("%Y-Q%q")}'
                            result['data_timestamp'] = quarterly.columns[0].strftime("%Y-%m-%d")
                            log.info(f"✅ Calculated TTM EBITDA for {self.ticker_symbol}: {ttm_ebitda:,.0f}")
                            break
                        elif len(ebitda_values) >= 2:
                            avg_quarterly = sum(ebitda_values) / len(ebitda_values)
                            estimated_ttm = avg_quarterly * 4
                            result['ebitda_ttm'] = float(estimated_ttm)
                            result['ebitda_latest'] = float(quarterly.loc[key, quarterly.columns[0]])
                            result['ebitda_source'] = f'quarterly_estimated.{key}'
                            result['ebitda_period'] = f'TTM_estimated_{len(ebitda_values)}Q'
                            result['data_quality_issues'].append(f"TTM EBITDA estimated from {len(ebitda_values)} quarters")
                            log.warning(f"⚠️ Estimated TTM EBITDA for {self.ticker_symbol}: {estimated_ttm:,.0f}")
                            break
                
                revenue_keys = ['Total Revenue', 'Revenue', 'Net Sales']
                for key in revenue_keys:
                    if key in quarterly.index and result.get('total_revenue_ttm') is None:
                        revenue_values = [quarterly.loc[key, col] for col in last_4_quarters.columns 
                                        if pd.notna(quarterly.loc[key, col])]
                        
                        if len(revenue_values) >= 4:
                            ttm_revenue = sum(revenue_values)
                            result['total_revenue_ttm'] = float(ttm_revenue)
                            result['total_revenue_latest'] = float(quarterly.loc[key, quarterly.columns[0]])
                            result['revenue_source'] = f'quarterly_ttm.{key}'
                            result['revenue_period'] = f'TTM_ending_{quarterly.columns[0].strftime("%Y-Q%q")}'
                            break
                            
        except Exception as e:
            result['data_quality_issues'].append(f"Quarterly TTM calculation failed: {e}")
            log.debug(f"Quarterly TTM calculation failed for {self.ticker_symbol}: {e}")
        
        # Fallback to annual financials
        if result['ebitda_ttm'] is None:
            try:
                annual = self.ticker.financials
                if not annual.empty and len(annual.columns) > 0:
                    latest_year = annual.columns[0]
                    
                    ebitda_keys = ['EBITDA', 'Normalized EBITDA', 'EBIT', 'Operating Income']
                    for key in ebitda_keys:
                        if key in annual.index:
                            ebitda_val = annual.loc[key, latest_year]
                            if pd.notna(ebitda_val) and ebitda_val != 0:
                                result['ebitda_ttm'] = float(ebitda_val)
                                result['ebitda_latest'] = float(ebitda_val)
                                result['ebitda_source'] = f'annual_financials.{key}'
                                result['ebitda_period'] = str(latest_year.year)
                                result['data_timestamp'] = latest_year.strftime("%Y-%m-%d")
                                log.info(f"Using annual EBITDA for {self.ticker_symbol}: {ebitda_val:,.0f}")
                                break
                    
                    if result['total_revenue_ttm'] is None:
                        revenue_keys = ['Total Revenue', 'Revenue', 'Net Sales']
                        for key in revenue_keys:
                            if key in annual.index:
                                revenue_val = annual.loc[key, latest_year]
                                if pd.notna(revenue_val) and revenue_val != 0:
                                    result['total_revenue_ttm'] = float(revenue_val)
                                    result['total_revenue_latest'] = float(revenue_val)
                                    result['revenue_source'] = f'annual_financials.{key}'
                                    result['revenue_period'] = str(latest_year.year)
                                    break
                                    
            except Exception as e:
                result['data_quality_issues'].append(f"Annual financials failed: {e}")
                log.debug(f"Annual financials failed for {self.ticker_symbol}: {e}")
        
        # Final fallback to info dict
        if result['ebitda_ttm'] is None:
            ebitda_info = self.info.get('ebitda')
            if ebitda_info and ebitda_info != 0:
                result['ebitda_ttm'] = float(ebitda_info)
                result['ebitda_latest'] = float(ebitda_info)
                result['ebitda_source'] = 'info_dict'
                result['ebitda_period'] = 'TTM_estimated'
                result['data_quality_issues'].append("Using info dict EBITDA (TTM status uncertain)")
                log.warning(f"[WARNING] Using info dict EBITDA for {self.ticker_symbol}: {ebitda_info:,.0f}")
        
        if result['total_revenue_ttm'] is None:
            revenue_info = self.info.get('totalRevenue')
            if revenue_info and revenue_info != 0:
                result['total_revenue_ttm'] = float(revenue_info)
                result['total_revenue_latest'] = float(revenue_info)
                result['revenue_source'] = 'info_dict'
                result['revenue_period'] = 'TTM_estimated'
        
        return result
    
    def _get_ev_ebitda_with_ttm(self, normalized_data: Dict) -> Optional[float]:
        """Calculate EV/EBITDA using proper TTM EBITDA"""
        enterprise_value = self._calculate_enterprise_value()
        ebitda_ttm = normalized_data.get('ebitda_ttm')
        
        if enterprise_value and ebitda_ttm and ebitda_ttm > 0:
            ev_ebitda = enterprise_value / ebitda_ttm
            
            ebitda_source = normalized_data.get('ebitda_source', 'unknown')
            financial_currency = normalized_data.get('financial_currency_detected', 'unknown')
            conversion_applied = normalized_data.get('currency_conversion_applied', False)
            
            log.info(f"EV/EBITDA for {self.ticker_symbol}: {ev_ebitda:.2f} "
                    f"(EV: {enterprise_value:,.0f} NOK, EBITDA TTM: {ebitda_ttm:,.0f} NOK "
                    f"from {ebitda_source}, original currency: {financial_currency}, "
                    f"conversion applied: {conversion_applied})")
            
            if ev_ebitda < 1 or ev_ebitda > 100:
                self.data_quality_issues.append(f"EV/EBITDA ratio seems unusual: {ev_ebitda:.2f}")
            
            return ev_ebitda
        
        yf_ev_ebitda = self._safe_extract('enterpriseToEbitda')
        if yf_ev_ebitda:
            self.data_quality_issues.append("Using yfinance EV/EBITDA (our calculation failed)")
        
        return yf_ev_ebitda

    def _get_price_to_sales_with_ttm(self, normalized_data: Dict) -> Optional[float]:
        """Calculate P/S using proper TTM revenue"""
        market_cap = self._safe_extract('marketCap')
        revenue_ttm = normalized_data.get('total_revenue_ttm')
        
        if market_cap and revenue_ttm and revenue_ttm > 0:
            ps_ratio = market_cap / revenue_ttm
            
            revenue_source = normalized_data.get('revenue_source', 'unknown')
            financial_currency = normalized_data.get('financial_currency_detected', 'unknown')
            conversion_applied = normalized_data.get('currency_conversion_applied', False)
            
            log.info(f"P/S for {self.ticker_symbol}: {ps_ratio:.2f} "
                    f"(Market Cap: {market_cap:,.0f} NOK, Revenue TTM: {revenue_ttm:,.0f} NOK "
                    f"from {revenue_source}, original currency: {financial_currency}, "
                    f"conversion applied: {conversion_applied})")
            
            if ps_ratio < 0.05 or ps_ratio > 50:
                self.data_quality_issues.append(f"P/S ratio seems unusual: {ps_ratio:.2f}")
            
            return ps_ratio
        
        return self._safe_extract('priceToSalesTrailing12Months')
    
    def _safe_extract(self, key: str) -> Optional[float]:
        """Safely extract numeric value with validation"""
        value = self.info.get(key)
        
        if value in [None, 'N/A', '', 'None', 'null', 0]:
            return None
            
        try:
            float_val = float(value)
            
            if float_val == float('inf') or float_val == float('-inf'):
                return None
                
            negative_invalid_keys = ['marketCap', 'enterpriseValue', 'totalRevenue', 'totalCash', 'totalDebt']
            if key in negative_invalid_keys and float_val < 0:
                self.data_quality_issues.append(f"Negative value for {key}: {float_val}")
                return None
                
            return float_val
            
        except (ValueError, TypeError) as e:
            self.data_quality_issues.append(f"Could not parse {key}: {value} ({e})")
            return None
    
    def _get_trailing_pe(self) -> Optional[float]:
        """Get trailing P/E with fallback calculation (allows negative for losses)"""
        pe = self._safe_extract('trailingPE')
        if pe is not None:
            return pe
        
        current_price = self._safe_extract('currentPrice') or self._safe_extract('regularMarketPrice')
        trailing_eps = self._safe_extract('trailingEps')
        
        # Allow negative EPS calculation (removed trailing_eps > 0 check)
        if current_price and trailing_eps and trailing_eps != 0:
            calculated_pe = current_price / trailing_eps
            log.info(f"Calculated trailing P/E for {self.ticker_symbol}: {calculated_pe:.2f}")
            return calculated_pe
            
        return None
    
    def _calculate_enterprise_value(self) -> Optional[float]:
        """Calculate Enterprise Value with validation"""
        ev = self._safe_extract('enterpriseValue')
        
        if ev is not None:
            market_cap = self._safe_extract('marketCap')
            if market_cap and ev > market_cap * 10:
                self.data_quality_issues.append(f"Enterprise Value seems too high: {ev:,.0f} vs Market Cap: {market_cap:,.0f}")
            elif market_cap and ev < market_cap * 0.5:
                self.data_quality_issues.append(f"Enterprise Value seems too low: {ev:,.0f} vs Market Cap: {market_cap:,.0f}")
            else:
                return ev
        
        market_cap = self._safe_extract('marketCap')
        total_debt = self._safe_extract('totalDebt') or 0
        total_cash = self._safe_extract('totalCash') or 0
        
        if market_cap and market_cap > 0:
            calculated_ev = market_cap + total_debt - total_cash
            if calculated_ev > 0:
                log.info(f"Calculated Enterprise Value for {self.ticker_symbol}: {calculated_ev:,.0f}")
                if ev is not None:
                    diff_pct = abs(calculated_ev - ev) / ev * 100
                    if diff_pct > 20:
                        self.data_quality_issues.append(f"EV calculation discrepancy: {diff_pct:.1f}% difference")
                return calculated_ev
        
        return ev
    
    def _validate_metrics(self, metrics: Dict[str, Any]) -> None:
        """Validate extracted metrics for reasonableness"""
        validation_rules = {
            'trailing_pe': (-1000, 1000),  # Allow negative P/E for companies with losses
            'forward_pe': (0, 1000),
            'peg_ratio': (0, 10),
            'price_to_book': (0, 100),
            'price_to_sales': (0, 200),
            'ev_revenue': (0, 500),
            'ev_ebitda': (-100, 1000)  # Allow negative EV/EBITDA
        }
        
        for metric, (min_val, max_val) in validation_rules.items():
            value = metrics.get(metric)
            if value is not None and (value < min_val or value > max_val):
                self.data_quality_issues.append(f"{metric} outside normal range: {value}")
    
    def _format_market_cap(self, value: Optional[float]) -> str:
        """Format market cap in NOK"""
        if value is None or value <= 0:
            return "Ikke tilgjengelig"
            
        if value >= 1e12:
            return f"{value/1e12:.1f} bill NOK"
        elif value >= 1e9:
            return f"{value/1e9:.1f} mrd NOK"
        else:
            return f"{value/1e6:.1f} mill NOK"
    
    def _format_revenue(self, value: Optional[float]) -> str:
        """Format revenue in NOK"""
        if value is None or value == 0:
            return "Ikke tilgjengelig"
        
        abs_val = abs(value)
        if abs_val >= 1e12:
            return f"{value/1e12:.1f} bill NOK"
        elif abs_val >= 1e9:
            return f"{value/1e9:.1f} mrd NOK"
        elif abs_val >= 1e6:
            return f"{value/1e6:.1f} mill NOK"
        else:
            return f"{value:,.0f} NOK"
    
    def _format_ratio(self, value: Optional[float]) -> str:
        """Format financial ratios (shows '-' for negative or missing data)"""
        if value is None or value <= 0:
            return "−"  # Dash for both negative earnings and no data
        return f"{value:.2f}"
    
    def _get_fallback_metrics(self) -> Dict[str, Any]:
        """Return minimal metrics when data extraction fails"""
        return {
            'ticker': self.ticker_symbol,
            'market_cap': None,
            'enterprise_value': None,
            'trailing_pe': None,
            'forward_pe': None,
            'data_quality_score': 0.0,
            'data_quality_issues': ['Failed to extract ticker info']
        }

def normalize_ticker(ticker: str) -> str:
    if not ticker:
        return ""
    t = ticker.strip().upper()
    return t if t.endswith(".OL") else f"{t}.OL"

def retry(func, attempts=3, delay=1.0, factor=1.5, what="operation"):
    """Retry function with exponential backoff"""
    last_exc = None
    for attempt in range(attempts):
        try:
            return func()
        except Exception as exc:
            last_exc = exc
            if attempt < attempts - 1:
                wait_time = delay * (factor ** attempt)
                log.warning(f"{what} failed (attempt {attempt + 1}/{attempts}): {exc}. Retrying in {wait_time:.1f}s...")
                time.sleep(wait_time)
            else:
                log.error(f"{what} failed after {attempts} attempts: {exc}")
    raise last_exc

def get_current_price(ticker_symbol: str) -> Optional[float]:
    """Get current stock price with multiple fallback methods"""
    stock = yf.Ticker(ticker_symbol)
    
    try:
        fast_info = getattr(stock, "fast_info", None)
        if fast_info and hasattr(fast_info, "last_price"):
            price = float(fast_info.last_price)
            if price > 0:
                return price
    except Exception as e:
        log.debug(f"fast_info failed for {ticker_symbol}: {e}")
    
    try:
        hist = stock.history(period="5d", interval="1d", auto_adjust=False)
        if not hist.empty and "Close" in hist.columns:
            price = float(hist["Close"].iloc[-1])
            if price > 0:
                return price
    except Exception as e:
        log.debug(f"recent history failed for {ticker_symbol}: {e}")
    
    try:
        info = stock.info or {}
        price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")
        if price and float(price) > 0:
            return float(price)
    except Exception as e:
        log.debug(f"info price failed for {ticker_symbol}: {e}")
    
    log.warning(f"Could not determine current price for {ticker_symbol}")
    return None

def get_historical_chart_data(ticker: str, period: str = "5y") -> List[Dict]:
    """Get historical price data with robust error handling"""
    ticker_norm = normalize_ticker(ticker)
    
    def _pull():
        return yf.Ticker(ticker_norm).history(period=period, interval="1d", auto_adjust=False)
    
    try:
        hist: pd.DataFrame = retry(_pull, attempts=3, delay=1.0, factor=1.5, what=f"history({ticker_norm})")
    except Exception as e:
        log.error(f"Failed to get historical data for {ticker_norm}: {e}")
        return []
    
    if hist is None or hist.empty:
        log.warning(f"No historical data for {ticker_norm}")
        return []
    
    hist = hist.dropna(subset=["Close"])
    if hist.empty:
        log.warning(f"No 'Close' data for {ticker_norm}")
        return []
    
    out: List[Dict] = []
    for date, row in hist.iterrows():
        try:
            out.append({
                "date": pd.Timestamp(date).strftime("%Y-%m-%d"),
                "price": round(float(row["Close"]), 2),
                "high": round(float(row.get("High", row["Close"])), 2),
                "low": round(float(row.get("Low", row["Close"])), 2),
                "volume": int(row.get("Volume", 0) or 0),
            })
        except Exception as e:
            log.debug(f"Error processing row for {date}: {e}")
            continue
    
    out.sort(key=lambda x: x["date"])
    
    if len(out) > 800:
        out = out[::2]
    
    out = smooth_price_anomalies(out)
    
    return out

def smooth_price_anomalies(chart_data: List[Dict], threshold_multiplier: float = 3.0) -> List[Dict]:
    """Detect and smooth price anomalies using rolling median"""
    if len(chart_data) < 10:
        return chart_data
    
    smoothed_data = [pt.copy() for pt in chart_data]
    window_size = min(10, len(chart_data) // 4)
    
    for i in range(len(smoothed_data)):
        start_idx = max(0, i - window_size // 2)
        end_idx = min(len(smoothed_data), i + window_size // 2 + 1)
        
        window_prices = [smoothed_data[j]["price"] for j in range(start_idx, end_idx)]
        window_prices.sort()
        
        n = len(window_prices)
        median = window_prices[n // 2] if n % 2 == 1 else (window_prices[n // 2 - 1] + window_prices[n // 2]) / 2
        
        current_price = smoothed_data[i]["price"]
        
        if current_price > median * threshold_multiplier or current_price < median / threshold_multiplier:
            log.warning(f"Detected price anomaly at {smoothed_data[i]['date']}: {current_price} NOK (median: {median:.2f} NOK)")
            
            if i == 0:
                smoothed_data[i]["price"] = round(median, 2)
            elif i == len(smoothed_data) - 1:
                smoothed_data[i]["price"] = round(median, 2)
            else:
                prev_price = smoothed_data[i-1]["price"]
                next_price = smoothed_data[i+1]["price"]
                interpolated = (prev_price + next_price) / 2
                smoothed_data[i]["price"] = round(interpolated, 2)
            
            new_price = smoothed_data[i]["price"]
            smoothed_data[i]["high"] = round(max(new_price * 1.02, smoothed_data[i].get("high", new_price)), 2)
            smoothed_data[i]["low"] = round(min(new_price * 0.98, smoothed_data[i].get("low", new_price)), 2)
            
            log.info(f"Smoothed anomaly: {current_price} → {new_price} NOK")
    
    return smoothed_data

def calculate_performance_metrics(chart: List[Dict]) -> Dict[str, float]:
    """Calculate performance metrics from chart data"""
    if len(chart) < 2:
        return {"performance_5y": 0.0, "performance_2y": 0.0, "performance_1y": 0.0, "volatility": 0.0}
    
    def pct_change(old_price, new_price):
        return 0.0 if old_price <= 0 else (new_price - old_price) / old_price * 100.0
    
    first_price = chart[0]["price"]
    last_price = chart[-1]["price"]
    
    end_date = datetime.strptime(chart[-1]["date"], "%Y-%m-%d")
    two_years_ago = end_date.replace(year=end_date.year - 2).strftime("%Y-%m-%d")
    one_year_ago = end_date.replace(year=end_date.year - 1).strftime("%Y-%m-%d")
    
    def find_price_on_or_after(target_date):
        for point in chart:
            if point["date"] >= target_date:
                return point["price"]
        return chart[0]["price"]
    
    price_2y_ago = find_price_on_or_after(two_years_ago)
    price_1y_ago = find_price_on_or_after(one_year_ago)
    
    sample = chart[-252:] if len(chart) >= 252 else chart
    returns = []
    for i in range(1, len(sample)):
        prev_price = sample[i-1]["price"]
        curr_price = sample[i]["price"]
        if prev_price > 0:
            returns.append((curr_price - prev_price) / prev_price)
    
    volatility = 0.0
    if returns:
        avg_return = sum(returns) / len(returns)
        variance = sum((r - avg_return) ** 2 for r in returns) / len(returns)
        volatility = (variance ** 0.5) * (252 ** 0.5) * 100.0
    
    return {
        "performance_5y": round(pct_change(first_price, last_price), 2),
        "performance_2y": round(pct_change(price_2y_ago, last_price), 2),
        "performance_1y": round(pct_change(price_1y_ago, last_price), 2),
        "volatility": round(volatility, 2),
    }

def fetch_enhanced_stock_data(ticker: str) -> Optional[Dict]:
    """Fetch comprehensive stock data with enhanced metrics"""
    ticker_norm = normalize_ticker(ticker)
    log.info(f"Fetching enhanced data for {ticker_norm}")
    
    extractor = ValuationExtractor(ticker_norm)
    valuation_metrics = extractor.get_comprehensive_metrics()
    
    current_price = get_current_price(ticker_norm)
    if current_price is None:
        log.error(f"Could not determine current price for {ticker_norm}")
        return None
    
    chart = get_historical_chart_data(ticker_norm, period="5y")
    if not chart:
        log.error(f"Could not get chart data for {ticker_norm}")
        return None
    
    performance = calculate_performance_metrics(chart)
    
    info = extractor.info
    week_52_high = info.get("fiftyTwoWeekHigh")
    week_52_low = info.get("fiftyTwoWeekLow")
    
    if (week_52_high is None or week_52_low is None) and chart:
        end_date = datetime.strptime(chart[-1]["date"], "%Y-%m-%d")
        one_year_ago = end_date.replace(year=end_date.year - 1).strftime("%Y-%m-%d")
        last_year_prices = [pt["price"] for pt in chart if pt["date"] >= one_year_ago]
        if last_year_prices:
            week_52_high = max(last_year_prices)
            week_52_low = min(last_year_prices)
    
    data = {
        "company_name": info.get("longName") or info.get("shortName") or ticker_norm,
        "ticker": ticker_norm,
        "current_price": round(current_price, 2),
        "sector": info.get("sector") or "Ukjent",
        "industry": info.get("industry") or "Ukjent",
        "employees": int(info.get("fullTimeEmployees") or 0),
        "headquarters": ", ".join(filter(None, [info.get("city"), info.get("country")])) or "Norge",
        "description": info.get("longBusinessSummary") or "Norsk børsnotert selskap",
        "price_52w_high": round(float(week_52_high or 0), 2),
        "price_52w_low": round(float(week_52_low or 0), 2),
        **performance,
        **valuation_metrics,
        "chart_data": chart,
        "last_updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    
    log.info(f"[SUCCESS] {data['company_name']}: price {data['current_price']} NOK, "
             f"quality score {data['data_quality_score']}, {len(chart)} chart points")
    
    if valuation_metrics['data_quality_issues']:
        log.warning(f"Data quality issues for {ticker_norm}: {valuation_metrics['data_quality_issues']}")
    
    return data

def load_obx_list() -> List[Dict]:
    """Load OBX stock list from data/obx.json"""
    ensure_data_dir()
    if not OBX_PATH.exists():
        raise FileNotFoundError(f"Missing {OBX_PATH}")
    
    with OBX_PATH.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict) and isinstance(raw.get("stocks"), list):
        items = raw["stocks"]
    else:
        raise ValueError(f"Unsupported schema in {OBX_PATH}")
    
    out: List[Dict] = []
    for item in items:
        name = item.get("name") or item.get("company_name") or item.get("symbol") or item.get("ticker")
        symbol = item.get("ticker") or item.get("symbol") or ""
        if symbol:
            out.append({"name": name, "ticker": symbol})
    
    if not out:
        raise ValueError(f"No usable entries in {OBX_PATH}")
    
    log.info(f"Loaded {len(out)} stocks from obx.json")
    return out

def select_daily_stock() -> Dict:
    """Select daily stock deterministically based on Oslo date"""
    stocks = load_obx_list()
    today = get_oslo_date()
    
    random.seed(today)
    selected = random.choice(stocks)
    
    log.info(f"[SELECTED] {today}: {selected['name']} ({selected['ticker']})")
    return selected

def calculate_difficulty_rating(data: Dict) -> str:
    """Calculate game difficulty based on various factors"""
    score = 0
    
    market_cap = data.get('market_cap', 0)
    if market_cap < 1e9:
        score += 3
    elif market_cap < 10e9:
        score += 2
    else:
        score += 1
    
    volatility = data.get('volatility', 0)
    if volatility > 50:
        score += 3
    elif volatility > 30:
        score += 2
    else:
        score += 1
    
    perf_1y = abs(data.get('performance_1y', 0))
    perf_5y = abs(data.get('performance_5y', 0))
    if perf_1y > 100 or perf_5y > 500:
        score += 2
    
    sector = data.get('sector', '').lower()
    if sector in ['technology', 'consumer', 'healthcare']:
        score += 0
    elif sector in ['utilities', 'real estate']:
        score += 1
    else:
        score += 2
    
    if score <= 4:
        return "Lett"
    elif score <= 7:
        return "Middels"
    else:
        return "Vanskelig"

def get_hint_categories(data: Dict) -> List[str]:
    """Generate hint categories based on available data"""
    categories = []
    
    if data.get('sector') and data['sector'] != 'Ukjent':
        categories.append("Sektor")
    
    if data.get('employees', 0) > 0:
        categories.append("Antall ansatte")
    
    if data.get('market_cap', 0) > 0:
        categories.append("Markedsverdi")
    
    if data.get('trailing_pe'):
        categories.append("P/E-tall")
    
    if data.get('headquarters') and data['headquarters'] != 'Norge':
        categories.append("Hovedkontor")
    
    performance_hints = ['performance_1y', 'performance_5y', 'volatility']
    if any(data.get(key, 0) != 0 for key in performance_hints):
        categories.append("Aksjeutvikling")
    
    if data.get('description') and len(data['description']) > 50:
        categories.append("Forretningsområde")
    
    return categories

def print_summary(data: Dict) -> None:
    """Print summary of the generated data"""
    print(f"\n[FINANSLE DATA SUMMARY]")
    print(f"========================")
    print(f"Company: {data['company_name']} ({data['ticker']})")
    print(f"Current Price: {data['current_price']} NOK")
    print(f"Market Cap: {data.get('market_cap_formatted', 'N/A')}")
    print(f"Sector: {data['sector']} | Industry: {data['industry']}")
    print(f"52W Range: {data['price_52w_low']}-{data['price_52w_high']} NOK")
    print(f"Performance: 1Y {data['performance_1y']}% | 5Y {data['performance_5y']}%")
    print(f"Volatility: {data['volatility']}%")
    print(f"P/E Ratio: {data.get('trailing_pe_formatted', 'N/A')}")
    print(f"P/S Ratio: {data.get('price_to_sales_formatted', 'N/A')}")
    print(f"EV/EBITDA: {data.get('ev_ebitda_formatted', 'N/A')}")
    print(f"Revenue: {data.get('revenue_formatted', 'N/A')}")
    print(f"Data Quality Score: {data.get('data_quality_score', 0)}/1.0")
    print(f"Difficulty: {data.get('difficulty_rating', 'N/A')}")
    print(f"Chart Points: {len(data.get('chart_data', []))}")
    
    issues = data.get('data_quality_issues', [])
    if issues:
        print(f"\n[DATA QUALITY ISSUES]")
        for issue in issues[:5]:
            print(f"  * {issue}")
        if len(issues) > 5:
            print(f"  ... and {len(issues) - 5} more issues")

def check_if_data_changed(data: Dict) -> bool:
    """Check if new data is different from existing daily.json"""
    if not DAILY_PATH.exists():
        log.info("No existing daily.json found")
        return True
    
    try:
        with DAILY_PATH.open("r", encoding="utf-8") as f:
            existing_data = json.load(f)
        
        existing_ticker = existing_data.get('ticker', '').upper()
        new_ticker = data.get('ticker', '').upper()
        
        if existing_ticker != new_ticker:
            log.info(f"Ticker changed: {existing_ticker} -> {new_ticker}")
            return True
        
        existing_date = existing_data.get('last_updated', '')
        today = get_oslo_date()
        
        if existing_date.startswith(today):
            log.info(f"Data already updated today ({today}) for {existing_ticker}")
            return False
        
        log.info(f"Data needs update (last: {existing_date[:10]}, today: {today})")
        return True
        
    except Exception as e:
        log.warning(f"Could not read existing daily.json: {e}")
        return True

def serialize_for_json(obj):
    """Custom JSON serializer for objects not serializable by default"""
    if isinstance(obj, pd.Timestamp):
        return obj.strftime("%Y-%m-%d")
    elif isinstance(obj, datetime):
        return obj.isoformat()
    elif pd.isna(obj):
        return None
    raise TypeError(f"Type {type(obj)} not serializable")

def generate_all_stocks_metrics():
    """Generate metrics for all stocks (called after daily stock selection)"""
    log.info(">> Starting bulk metrics generation for all stocks")
    
    oslo_companies_path = DATA_DIR / "oslo_companies_short_no.json"
    with open(oslo_companies_path, 'r', encoding='utf-8') as f:
        companies = json.load(f)
    
    all_data = {}
    total = len(companies)
    
    log.info(f"Processing {total} companies (est. {total * 1.5 / 60:.1f} minutes)...")
    
    for i, company in enumerate(companies, 1):
        ticker = company['ticker']
        base_ticker = ticker.replace('.OL', '')
        
        if i % 50 == 0:  # Progress update every 50 stocks
            log.info(f"Progress: {i}/{total} ({i/total*100:.1f}%)")
        
        try:
            extractor = ValuationExtractor(ticker)
            metrics = extractor.get_comprehensive_metrics()
            
            all_data[base_ticker] = {
                'sector': company.get('sector', '-'),
                'industry': company.get('industry', '-'),
                'revenue_2024_formatted': metrics.get('revenue_formatted', '-'),
                'target_mean_formatted': metrics.get('target_mean_formatted', 'Ikke tilgjengelig'),
                'target_range_formatted': metrics.get('target_range_formatted', 'Ikke tilgjengelig'),
                'market_cap': metrics.get('market_cap'),
                'market_cap_formatted': metrics.get('market_cap_formatted', '-'),
            }
            
            time.sleep(1.5)  # Rate limit protection
            
        except Exception as e:
            log.debug(f"Failed for {ticker}: {e}")
            all_data[base_ticker] = {
                'sector': company.get('sector', '-'),
                'industry': company.get('industry', '-'),
                'revenue_2024_formatted': '-',
                'target_mean_formatted': 'Ikke tilgjengelig',
                'target_range_formatted': 'Ikke tilgjengelig',
                'market_cap': None,
                'market_cap_formatted': '-',
            }
            time.sleep(1.5)
    
    # Save to file
    output_path = DATA_DIR / "all_stocks_metrics.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False)
    
    log.info(f"✅ Saved metrics for {len(all_data)} stocks to {output_path}")

def main():
    """Main function to generate daily stock data"""
    log.info(">> Starting Finansle stock data generation")
    log.info(f"Script running at: {datetime.now(timezone.utc).isoformat()}")
    
    try:
        ensure_data_dir()
        
        # Step 1: Generate daily stock
        selected_stock = select_daily_stock()
        base_ticker = selected_stock.get("ticker") or selected_stock.get("symbol") or ""
        if not base_ticker:
            log.error("Selected stock has no ticker/symbol field")
            sys.exit(1)
        
        data = fetch_enhanced_stock_data(base_ticker)
        if not data:
            log.error(f"Failed to fetch enhanced data for {base_ticker}")
            sys.exit(1)
        
        data["difficulty_rating"] = calculate_difficulty_rating(data)
        data["hint_categories"] = get_hint_categories(data)
        
        if not check_if_data_changed(data):
            log.info("Data unchanged, skipping write")
            print_summary(data)
        else:
            tmp_path = DAILY_PATH.with_suffix(".json.tmp")
            try:
                with tmp_path.open("w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2, default=serialize_for_json)
                tmp_path.replace(DAILY_PATH)
                log.info(f"[SUCCESS] Successfully saved {DAILY_PATH}")
            except Exception as e:
                log.error(f"Failed to write data file: {e}")
                if tmp_path.exists():
                    tmp_path.unlink()
                sys.exit(1)
            
            print_summary(data)
        
        # Step 2: Generate all stocks metrics (NEW!)
        log.info("\n" + "="*60)
        generate_all_stocks_metrics()
        
        log.info("[COMPLETE] Finansle data generation completed successfully!")
        
    except Exception as e:
        log.error(f"Fatal error in main: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()