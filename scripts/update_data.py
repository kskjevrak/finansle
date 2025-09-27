#!/usr/bin/env python3
"""
update_data.py — Robust daily generator for Finansle
- Enhanced yfinance data extraction with comprehensive error handling
- Improved valuation multiples calculation with fallbacks
- Data quality validation and cross-verification
- Better handling of Norwegian stocks and international data
"""

import json
import logging
import random
import time
import requests
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

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

class CurrencyHandler:
    """Handle currency detection and conversion for Norwegian stocks"""
    
    def __init__(self):
        self.usd_nok_rate = None
        self.rate_timestamp = None
        self.cache_duration = timedelta(hours=1)  # Cache exchange rate for 1 hour
        
    def get_usd_nok_rate(self) -> float:
        """Get current USD/NOK exchange rate with caching"""
        now = datetime.now()
        
        # Use cached rate if still valid
        if (self.usd_nok_rate is not None and 
            self.rate_timestamp is not None and 
            now - self.rate_timestamp < self.cache_duration):
            return self.usd_nok_rate
        
        # Try multiple sources for exchange rate
        rate = self._fetch_exchange_rate()
        if rate:
            self.usd_nok_rate = rate
            self.rate_timestamp = now
            log.info(f"Updated USD/NOK rate: {rate:.4f}")
            return rate
        
        # Fallback to approximate rate if API fails
        fallback_rate = 10.5  # Approximate USD/NOK rate
        log.warning(f"Using fallback USD/NOK rate: {fallback_rate}")
        return fallback_rate
    
    def _fetch_exchange_rate(self) -> Optional[float]:
        """Fetch USD/NOK rate from multiple sources"""
        
        # Method 1: Use yfinance for USDNOK=X
        try:
            import yfinance as yf
            usd_nok = yf.Ticker("USDNOK=X")
            info = usd_nok.info
            rate = info.get('regularMarketPrice') or info.get('ask') or info.get('bid')
            if rate and rate > 0:
                log.debug(f"Got USD/NOK rate from yfinance: {rate}")
                return float(rate)
        except Exception as e:
            log.debug(f"yfinance USD/NOK failed: {e}")
        
        # Method 2: Use Norges Bank API (official Norwegian central bank)
        try:
            # Norges Bank API for USD exchange rate
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
        
        # Check info dict for currency indicators
        financial_currency = info.get('financialCurrency')
        if financial_currency:
            log.info(f"Financial currency from info: {financial_currency}")
            return financial_currency.upper()
        
        # Check currency field
        currency = info.get('currency')
        if currency:
            log.info(f"Currency from info: {currency}")
            # If stock trades in NOK but currency field says USD, likely financials are in USD
            if currency.upper() == 'USD':
                return 'USD'
        
        # Heuristic: Check if company is multinational/large
        market_cap = info.get('marketCap', 0)
        employees = info.get('fullTimeEmployees', 0)
        sector = info.get('sector', '').lower()
        
        # Large companies often report in USD
        if market_cap > 50e9 or employees > 10000:  # >50B NOK or >10k employees
            log.info(f"Large company detected for {ticker_symbol}, likely USD financials")
            return 'USD'
        
        # Energy/Oil companies often report in USD
        if 'energy' in sector or 'oil' in sector:
            log.info(f"Energy sector detected for {ticker_symbol}, likely USD financials")
            return 'USD'
        
        # Default assumption for Norwegian stocks
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
        
        # Add other currencies if needed
        log.warning(f"Unknown currency {source_currency}, returning original value")
        return value
    
    def normalize_financial_data(self, robust_data: Dict, ticker_symbol: str, info: Dict) -> Dict:
        """Normalize all financial data to NOK"""
        
        # Detect the currency of financial statements
        financial_currency = self.detect_financial_currency(ticker_symbol, info)
        
        # Create normalized copy
        normalized_data = robust_data.copy()
        
        # Convert financial values to NOK
        financial_fields = [
            'ebitda_ttm', 'ebitda_latest', 
            'total_revenue_ttm', 'total_revenue_latest'
        ]
        
        for field in financial_fields:
            original_value = robust_data.get(field)
            if original_value is not None:
                normalized_value = self.convert_to_nok(original_value, financial_currency)
                normalized_data[field] = normalized_value
                
                # Add currency info to data quality tracking
                if financial_currency != 'NOK':
                    if 'data_quality_issues' not in normalized_data:
                        normalized_data['data_quality_issues'] = []
                    normalized_data['data_quality_issues'].append(
                        f"Converted {field} from {financial_currency} to NOK"
                    )
        
        # Add currency metadata
        normalized_data['financial_currency_detected'] = financial_currency
        normalized_data['price_currency'] = 'NOK'  # Always NOK for .OL stocks
        normalized_data['currency_conversion_applied'] = financial_currency != 'NOK'
        
        return normalized_data

# ---------- Enhanced Data Extraction Classes ----------
class ValuationExtractor:
    """Robust valuation metrics extractor with comprehensive error handling and currency conversion"""
    
    def __init__(self, ticker_symbol: str):
        self.ticker_symbol = ticker_symbol
        self.ticker = yf.Ticker(ticker_symbol)
        self.info = {}
        self.data_quality_issues = []
        self.currency_handler = CurrencyHandler()  # Add currency handler
        
    def get_comprehensive_metrics(self) -> Dict[str, Any]:
        """Extract all valuation metrics with validation, fallbacks, and currency conversion"""
        try:
            self.info = self.ticker.info or {}
        except Exception as e:
            log.warning(f"Failed to get ticker info for {self.ticker_symbol}: {e}")
            self.info = {}
            
        if not self.info:
            log.error(f"No info data available for {self.ticker_symbol}")
            return self._get_fallback_metrics()
        
        # Get robust financial metrics with TTM calculations
        robust_financial_data = self._get_robust_financial_metrics()
        
        # NORMALIZE CURRENCIES - Convert everything to NOK
        normalized_financial_data = self.currency_handler.normalize_financial_data(
            robust_financial_data, self.ticker_symbol, self.info
        )
        
        metrics = {
            'ticker': self.ticker_symbol,
            
            # Core valuation metrics (market cap and EV should already be in NOK)
            'market_cap': self._safe_extract('marketCap'),
            'market_cap_formatted': self._format_market_cap(self._safe_extract('marketCap')),
            'enterprise_value': self._calculate_enterprise_value(),
            'enterprise_value_formatted': self._format_market_cap(self._calculate_enterprise_value()),
            
            # Price ratios with TTM calculations (now currency-normalized)
            'trailing_pe': self._get_trailing_pe(),
            'forward_pe': self._safe_extract('forwardPE'),
            'peg_ratio': self._safe_extract('pegRatio'),
            'price_to_book': self._safe_extract('priceToBook'),
            'price_to_sales': self._get_price_to_sales_with_ttm(normalized_financial_data),
            
            # Enterprise value ratios with TTM EBITDA (now currency-normalized)
            'ev_revenue': self._safe_extract('enterpriseToRevenue'),
            'ev_ebitda': self._get_ev_ebitda_with_ttm(normalized_financial_data),
            
            # Financial fundamentals (now in NOK)
            'total_revenue': normalized_financial_data.get('total_revenue_ttm'),
            'revenue_formatted': self._format_revenue(normalized_financial_data.get('total_revenue_ttm')),
            'revenue_latest': normalized_financial_data.get('total_revenue_latest'),
            'ebitda': normalized_financial_data.get('ebitda_ttm'),
            'ebitda_formatted': self._format_revenue(normalized_financial_data.get('ebitda_ttm')),
            'ebitda_latest': normalized_financial_data.get('ebitda_latest'),
            'ebitda_source': normalized_financial_data.get('ebitda_source'),
            'ebitda_period': normalized_financial_data.get('ebitda_period'),
            'ebitda_timestamp': normalized_financial_data.get('data_timestamp'),
            
            # Currency metadata
            'financial_currency_detected': normalized_financial_data.get('financial_currency_detected'),
            'currency_conversion_applied': normalized_financial_data.get('currency_conversion_applied'),
            
            # Keep other metrics as before...
            'net_income': self._safe_extract('netIncomeToCommon'),
            'net_income_formatted': self._format_revenue(self._safe_extract('netIncomeToCommon')),
            'total_cash': self._safe_extract('totalCash'),
            'total_debt': self._safe_extract('totalDebt'),
            
            # Formatted versions (now using currency-normalized data)
            'ev_ebitda_formatted': self._format_ratio(self._get_ev_ebitda_with_ttm(normalized_financial_data)),
            'price_to_sales_formatted': self._format_ratio(self._get_price_to_sales_with_ttm(normalized_financial_data)),
            'trailing_pe_formatted': self._format_ratio(self._get_trailing_pe()),
            'forward_pe_formatted': self._format_ratio(self._safe_extract('forwardPE')),
            'peg_ratio_formatted': self._format_ratio(self._safe_extract('pegRatio')),
            'price_to_book_formatted': self._format_ratio(self._safe_extract('priceToBook')),
            'ev_revenue_formatted': self._format_ratio(self._safe_extract('enterpriseToRevenue')),
            
            # Data quality
            'data_quality_score': 0,
            'data_quality_issues': self.data_quality_issues + normalized_financial_data.get('data_quality_issues', [])
        }
        
        # Calculate data completeness score
        key_metrics = ['market_cap', 'trailing_pe', 'price_to_book', 'price_to_sales', 'enterprise_value']
        available_count = sum(1 for key in key_metrics if metrics.get(key) is not None)
        metrics['data_quality_score'] = round(available_count / len(key_metrics), 2)
        
        # Validate metrics for reasonableness
        self._validate_metrics(metrics)
        
        return metrics

    # ADD currency conversion validation to your existing methods:
    
    def _get_ev_ebitda_with_ttm(self, normalized_data: Dict) -> Optional[float]:
        """Calculate EV/EBITDA using proper TTM EBITDA (both in NOK)"""
        enterprise_value = self._calculate_enterprise_value()  # Should be in NOK
        ebitda_ttm = normalized_data.get('ebitda_ttm')  # Now in NOK
        
        if enterprise_value and ebitda_ttm and ebitda_ttm > 0:
            ev_ebitda = enterprise_value / ebitda_ttm
            
            # Log the calculation with currency info
            ebitda_source = normalized_data.get('ebitda_source', 'unknown')
            financial_currency = normalized_data.get('financial_currency_detected', 'unknown')
            conversion_applied = normalized_data.get('currency_conversion_applied', False)
            
            log.info(f"EV/EBITDA for {self.ticker_symbol}: {ev_ebitda:.2f} "
                    f"(EV: {enterprise_value:,.0f} NOK, EBITDA TTM: {ebitda_ttm:,.0f} NOK "
                    f"from {ebitda_source}, original currency: {financial_currency}, "
                    f"conversion applied: {conversion_applied})")
            
            # Sanity check: EV/EBITDA should typically be 3-50
            if ev_ebitda < 1 or ev_ebitda > 100:
                self.data_quality_issues.append(f"EV/EBITDA ratio seems unusual: {ev_ebitda:.2f}")
            
            return ev_ebitda
        
        # Fallback to yfinance's calculation if ours fails
        yf_ev_ebitda = self._safe_extract('enterpriseToEbitda')
        if yf_ev_ebitda:
            self.data_quality_issues.append("Using yfinance EV/EBITDA (our currency-normalized calculation failed)")
        
        return yf_ev_ebitda

    def _get_price_to_sales_with_ttm(self, normalized_data: Dict) -> Optional[float]:
        """Calculate P/S using proper TTM revenue (both in NOK)"""
        market_cap = self._safe_extract('marketCap')  # Should be in NOK
        revenue_ttm = normalized_data.get('total_revenue_ttm')  # Now in NOK
        
        if market_cap and revenue_ttm and revenue_ttm > 0:
            ps_ratio = market_cap / revenue_ttm
            
            # Log the calculation with currency info
            revenue_source = normalized_data.get('revenue_source', 'unknown')
            financial_currency = normalized_data.get('financial_currency_detected', 'unknown')
            conversion_applied = normalized_data.get('currency_conversion_applied', False)
            
            log.info(f"P/S for {self.ticker_symbol}: {ps_ratio:.2f} "
                    f"(Market Cap: {market_cap:,.0f} NOK, Revenue TTM: {revenue_ttm:,.0f} NOK "
                    f"from {revenue_source}, original currency: {financial_currency}, "
                    f"conversion applied: {conversion_applied})")
            
            # Sanity check: P/S should typically be 0.1-20
            if ps_ratio < 0.05 or ps_ratio > 50:
                self.data_quality_issues.append(f"P/S ratio seems unusual: {ps_ratio:.2f}")
            
            return ps_ratio
        
        # Fallback to yfinance's calculation
        return self._safe_extract('priceToSalesTrailing12Months')
    
    def _get_robust_financial_metrics(self) -> Dict[str, Any]:
        """
        Get financial metrics with proper TTM calculations for ratios
        """
        result = {
            'ebitda_ttm': None,           # For EV/EBITDA calculation
            'ebitda_latest': None,        # Most recent period (quarterly or annual)
            'ebitda_source': None,
            'ebitda_period': None,
            'total_revenue_ttm': None,    # For P/S calculation
            'total_revenue_latest': None, # Most recent period
            'revenue_source': None,
            'revenue_period': None,
            'data_timestamp': None,
            'data_quality_issues': []
        }
        
        # Method 1: Calculate TTM from quarterly data (most accurate)
        try:
            quarterly = self.ticker.quarterly_financials
            if not quarterly.empty and len(quarterly.columns) >= 4:  # Need at least 4 quarters
                log.info(f"Attempting TTM calculation from quarterly data for {self.ticker_symbol}")
                
                # Get last 4 quarters for TTM calculation
                last_4_quarters = quarterly.iloc[:, :4]  # Most recent 4 quarters
                
                # Calculate TTM EBITDA
                ebitda_keys = ['EBITDA', 'Normalized EBITDA']
                for key in ebitda_keys:
                    if key in quarterly.index:
                        ebitda_values = [quarterly.loc[key, col] for col in last_4_quarters.columns 
                                       if pd.notna(quarterly.loc[key, col])]
                        
                        if len(ebitda_values) >= 4:  # Have all 4 quarters
                            ttm_ebitda = sum(ebitda_values)
                            result['ebitda_ttm'] = float(ttm_ebitda)
                            result['ebitda_latest'] = float(quarterly.loc[key, quarterly.columns[0]])
                            result['ebitda_source'] = f'quarterly_ttm.{key}'
                            result['ebitda_period'] = f'TTM_ending_{quarterly.columns[0].strftime("%Y-Q%q")}'
                            result['data_timestamp'] = quarterly.columns[0]
                            log.info(f"✅ Calculated TTM EBITDA for {self.ticker_symbol}: {ttm_ebitda:,.0f}")
                            break
                        elif len(ebitda_values) >= 2:  # Partial quarters available
                            # Estimate TTM by annualizing available quarters
                            avg_quarterly = sum(ebitda_values) / len(ebitda_values)
                            estimated_ttm = avg_quarterly * 4
                            result['ebitda_ttm'] = float(estimated_ttm)
                            result['ebitda_latest'] = float(quarterly.loc[key, quarterly.columns[0]])
                            result['ebitda_source'] = f'quarterly_estimated.{key}'
                            result['ebitda_period'] = f'TTM_estimated_{len(ebitda_values)}Q'
                            result['data_quality_issues'].append(f"TTM EBITDA estimated from {len(ebitda_values)} quarters")
                            log.warning(f"⚠️ Estimated TTM EBITDA for {self.ticker_symbol}: {estimated_ttm:,.0f} (from {len(ebitda_values)} quarters)")
                            break
                
                # Calculate TTM Revenue similarly
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
        
        # Method 2: Use annual financials as backup (already TTM-like)
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
                                result['data_timestamp'] = latest_year
                                log.info(f"Using annual EBITDA for {self.ticker_symbol}: {ebitda_val:,.0f}")
                                break
                    
                    # Get annual revenue
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
        
        # Method 3: Fallback to info dict with warning
        if result['ebitda_ttm'] is None:
            ebitda_info = self.info.get('ebitda')
            if ebitda_info and ebitda_info != 0:
                result['ebitda_ttm'] = float(ebitda_info)
                result['ebitda_latest'] = float(ebitda_info)
                result['ebitda_source'] = 'info_dict'
                result['ebitda_period'] = 'TTM_estimated'
                result['data_quality_issues'].append("Using info dict EBITDA (TTM status uncertain)")
                log.warning(f"⚠️ Using info dict EBITDA for {self.ticker_symbol}: {ebitda_info:,.0f} (TTM status uncertain)")
        
        if result['total_revenue_ttm'] is None:
            revenue_info = self.info.get('totalRevenue')
            if revenue_info and revenue_info != 0:
                result['total_revenue_ttm'] = float(revenue_info)
                result['total_revenue_latest'] = float(revenue_info)
                result['revenue_source'] = 'info_dict'
                result['revenue_period'] = 'TTM_estimated'
        
        return result
    
    def _get_ev_ebitda_with_ttm(self, robust_data: Dict) -> Optional[float]:
        """Calculate EV/EBITDA using proper TTM EBITDA"""
        enterprise_value = self._calculate_enterprise_value()
        ebitda_ttm = robust_data.get('ebitda_ttm')
        
        if enterprise_value and ebitda_ttm and ebitda_ttm > 0:
            ev_ebitda = enterprise_value / ebitda_ttm
            
            # Log the calculation for transparency
            ebitda_source = robust_data.get('ebitda_source', 'unknown')
            ebitda_period = robust_data.get('ebitda_period', 'unknown')
            log.info(f"EV/EBITDA for {self.ticker_symbol}: {ev_ebitda:.2f} "
                    f"(EV: {enterprise_value:,.0f}, EBITDA TTM: {ebitda_ttm:,.0f} from {ebitda_source})")
            
            return ev_ebitda
        
        # Fallback to yfinance's calculation if ours fails
        yf_ev_ebitda = self._safe_extract('enterpriseToEbitda')
        if yf_ev_ebitda:
            self.data_quality_issues.append("Using yfinance EV/EBITDA (our TTM calculation failed)")
        
        return yf_ev_ebitda

    def _get_price_to_sales_with_ttm(self, robust_data: Dict) -> Optional[float]:
        """Calculate P/S using proper TTM revenue"""
        market_cap = self._safe_extract('marketCap')
        revenue_ttm = robust_data.get('total_revenue_ttm')
        
        if market_cap and revenue_ttm and revenue_ttm > 0:
            ps_ratio = market_cap / revenue_ttm
            
            # Log the calculation
            revenue_source = robust_data.get('revenue_source', 'unknown')
            log.info(f"P/S for {self.ticker_symbol}: {ps_ratio:.2f} "
                    f"(Market Cap: {market_cap:,.0f}, Revenue TTM: {revenue_ttm:,.0f} from {revenue_source})")
            
            return ps_ratio
        
        # Fallback to yfinance's calculation
        return self._safe_extract('priceToSalesTrailing12Months')
    
    def _safe_extract(self, key: str) -> Optional[float]:
        """Safely extract numeric value with comprehensive validation"""
        value = self.info.get(key)
        
        # Handle various representations of missing/invalid data
        if value in [None, 'N/A', '', 'None', 'null', 0]:
            return None
            
        try:
            float_val = float(value)
            
            # Check for obviously invalid values
            if float_val == float('inf') or float_val == float('-inf'):
                return None
                
            # Flag negative values for metrics that shouldn't be negative
            negative_invalid_keys = ['marketCap', 'enterpriseValue', 'totalRevenue', 'totalCash', 'totalDebt']
            if key in negative_invalid_keys and float_val < 0:
                self.data_quality_issues.append(f"Negative value for {key}: {float_val}")
                return None
                
            return float_val
            
        except (ValueError, TypeError) as e:
            self.data_quality_issues.append(f"Could not parse {key}: {value} ({e})")
            return None
    
    def _get_trailing_pe(self) -> Optional[float]:
        """Get trailing P/E with multiple fallback methods"""
        # Try direct extraction
        pe = self._safe_extract('trailingPE')
        if pe is not None:
            return pe
        
        # Fallback: manual calculation
        current_price = self._safe_extract('currentPrice') or self._safe_extract('regularMarketPrice')
        trailing_eps = self._safe_extract('trailingEps')
        
        if current_price and trailing_eps and trailing_eps > 0:
            calculated_pe = current_price / trailing_eps
            log.info(f"Calculated trailing P/E for {self.ticker_symbol}: {calculated_pe:.2f}")
            return calculated_pe
            
        return None
    
    def _get_price_to_sales(self) -> Optional[float]:
        """Get P/S ratio with fallback calculation and validation"""
        # Try direct extraction
        ps_direct = self._safe_extract('priceToSalesTrailing12Months')
        
        # Always calculate manual P/S for validation
        market_cap = self._safe_extract('marketCap')
        total_revenue = self._safe_extract('totalRevenue')
        
        if market_cap and total_revenue and total_revenue > 0:
            ps_manual = market_cap / total_revenue
            
            # If we have both values, compare them
            if ps_direct is not None:
                ratio_diff = abs(ps_direct - ps_manual) / ps_manual if ps_manual > 0 else float('inf')
                
                # If difference is >50%, use manual calculation
                if ratio_diff > 0.5:
                    self.data_quality_issues.append(f"P/S ratio validation failed: yfinance={ps_direct:.2f}, manual={ps_manual:.2f}")
                    log.warning(f"P/S discrepancy detected for {self.ticker_symbol}: yfinance={ps_direct:.2f}, manual={ps_manual:.2f}. Using manual.")
                    return ps_manual
                else:
                    return ps_direct
            else:
                # No direct value, use manual
                log.info(f"Calculated P/S ratio for {self.ticker_symbol}: {ps_manual:.2f}")
                return ps_manual
        
        # Fallback to direct value if manual calculation fails
        return ps_direct
    
    def _get_ev_ebitda(self) -> Optional[float]:
        """Get EV/EBITDA ratio with fallback calculation and validation"""
        # Try direct extraction
        ev_ebitda_direct = self._safe_extract('enterpriseToEbitda')
        
        # Always calculate manual EV/EBITDA for validation
        enterprise_value = self._calculate_enterprise_value()
        ebitda = self._safe_extract('ebitda')
        
        if enterprise_value and ebitda and ebitda > 0:
            ev_ebitda_manual = enterprise_value / ebitda
            
            # If we have both values, compare them
            if ev_ebitda_direct is not None:
                ratio_diff = abs(ev_ebitda_direct - ev_ebitda_manual) / ev_ebitda_manual if ev_ebitda_manual > 0 else float('inf')
                
                # If difference is >50%, use manual calculation
                if ratio_diff > 0.5:
                    self.data_quality_issues.append(f"EV/EBITDA ratio validation failed: yfinance={ev_ebitda_direct:.2f}, manual={ev_ebitda_manual:.2f}")
                    log.warning(f"EV/EBITDA discrepancy detected for {self.ticker_symbol}: yfinance={ev_ebitda_direct:.2f}, manual={ev_ebitda_manual:.2f}. Using manual.")
                    return ev_ebitda_manual
                else:
                    return ev_ebitda_direct
            else:
                # No direct value, use manual
                log.info(f"Calculated EV/EBITDA ratio for {self.ticker_symbol}: {ev_ebitda_manual:.2f}")
                return ev_ebitda_manual
        
        # Fallback to direct value if manual calculation fails
        return ev_ebitda_direct
    
    def _calculate_enterprise_value(self) -> Optional[float]:
        """Calculate Enterprise Value with fallback to manual calculation"""
        # Try direct extraction first
        ev = self._safe_extract('enterpriseValue')
        
        # Validate direct EV against reasonable bounds
        if ev is not None:
            market_cap = self._safe_extract('marketCap')
            if market_cap and ev > market_cap * 10:  # Flag if EV is >10x market cap
                self.data_quality_issues.append(f"Enterprise Value seems too high: {ev:,.0f} vs Market Cap: {market_cap:,.0f}")
            elif market_cap and ev < market_cap * 0.5:  # Flag if EV is <50% of market cap
                self.data_quality_issues.append(f"Enterprise Value seems too low: {ev:,.0f} vs Market Cap: {market_cap:,.0f}")
            else:
                return ev
        
        # Manual calculation as fallback
        market_cap = self._safe_extract('marketCap')
        total_debt = self._safe_extract('totalDebt') or 0
        total_cash = self._safe_extract('totalCash') or 0
        
        if market_cap and market_cap > 0:
            calculated_ev = market_cap + total_debt - total_cash
            if calculated_ev > 0:
                log.info(f"Calculated Enterprise Value for {self.ticker_symbol}: {calculated_ev:,.0f}")
                if ev is not None:
                    diff_pct = abs(calculated_ev - ev) / ev * 100
                    if diff_pct > 20:  # Flag significant discrepancies
                        self.data_quality_issues.append(f"EV calculation discrepancy: {diff_pct:.1f}% difference")
                return calculated_ev
        
        return ev  # Return original value if manual calculation fails
    
    def _validate_metrics(self, metrics: Dict[str, Any]) -> None:
        """Validate extracted metrics for reasonableness"""
        validation_rules = {
            'trailing_pe': (0, 1000),
            'forward_pe': (0, 1000),
            'peg_ratio': (0, 10),
            'price_to_book': (0, 100),
            'price_to_sales': (0, 200),
            'ev_revenue': (0, 500),
            'ev_ebitda': (0, 1000)
        }
        
        for metric, (min_val, max_val) in validation_rules.items():
            value = metrics.get(metric)
            if value is not None and (value < min_val or value > max_val):
                self.data_quality_issues.append(f"{metric} outside normal range: {value}")
    
    def _format_market_cap(self, value: Optional[float]) -> str:
        """Format market cap in NOK with appropriate units"""
        if value is None or value <= 0:
            return "Ikke tilgjengelig"
            
        if value >= 1e12:
            return f"{value/1e12:.1f} bill NOK"
        elif value >= 1e9:
            return f"{value/1e9:.1f} mrd NOK"
        else:
            return f"{value/1e6:.0f} mill NOK"
    
    def _format_revenue(self, value: Optional[float]) -> str:
        """Format revenue in NOK with appropriate units"""
        if value is None:
            return "Ikke tilgjengelig"
        if value == 0:
            return "Ikke tilgjengelig"
        
        abs_val = abs(value)
        if abs_val >= 1e12:
            return f"{value/1e12:.1f} bill NOK"
        elif abs_val >= 1e9:
            return f"{value/1e9:.0f} mrd NOK"
        elif abs_val >= 1e6:
            return f"{value/1e6:.0f} mill NOK"
        else:
            return f"{value:,.0f} NOK"
    
    def _format_ratio(self, value: Optional[float]) -> str:
        """Format financial ratios with appropriate decimal places"""
        if value is None:
            return "Ikke tilgjengelig"
        if value <= 0:
            return "Ikke tilgjengelig"
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

# ---------- helpers ----------
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
    
    # Method 1: fast_info (most current)
    try:
        fast_info = getattr(stock, "fast_info", None)
        if fast_info and hasattr(fast_info, "last_price"):
            price = float(fast_info.last_price)
            if price > 0:
                return price
    except Exception as e:
        log.debug(f"fast_info failed for {ticker_symbol}: {e}")
    
    # Method 2: recent history
    try:
        hist = stock.history(period="5d", interval="1d", auto_adjust=False)
        if not hist.empty and "Close" in hist.columns:
            price = float(hist["Close"].iloc[-1])
            if price > 0:
                return price
    except Exception as e:
        log.debug(f"recent history failed for {ticker_symbol}: {e}")
    
    # Method 3: info dict
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
    
    # Light downsampling for very large datasets
    if len(out) > 800:
        out = out[::2]
    
    # Apply anomaly detection and smoothing
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
    
    # Calculate annualized volatility from daily returns
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
    
    # Initialize data extractor
    extractor = ValuationExtractor(ticker_norm)
    
    # Get valuation metrics
    valuation_metrics = extractor.get_comprehensive_metrics()
    
    # Get current price with fallbacks
    current_price = get_current_price(ticker_norm)
    if current_price is None:
        log.error(f"Could not determine current price for {ticker_norm}")
        return None
    
    # Get historical chart data
    chart = get_historical_chart_data(ticker_norm, period="5y")
    if not chart:
        log.error(f"Could not get chart data for {ticker_norm}")
        return None
    
    # Calculate performance metrics
    performance = calculate_performance_metrics(chart)
    
    # Get 52-week high/low
    info = extractor.info
    week_52_high = info.get("fiftyTwoWeekHigh")
    week_52_low = info.get("fiftyTwoWeekLow")
    
    # Fallback: derive from chart data if not available
    if (week_52_high is None or week_52_low is None) and chart:
        end_date = datetime.strptime(chart[-1]["date"], "%Y-%m-%d")
        one_year_ago = end_date.replace(year=end_date.year - 1).strftime("%Y-%m-%d")
        last_year_prices = [pt["price"] for pt in chart if pt["date"] >= one_year_ago]
        if last_year_prices:
            week_52_high = max(last_year_prices)
            week_52_low = min(last_year_prices)
    
    # Compile comprehensive data
    data = {
        # Basic company info
        "company_name": info.get("longName") or info.get("shortName") or ticker_norm,
        "ticker": ticker_norm,
        "current_price": round(current_price, 2),
        "sector": info.get("sector") or "Ukjent",
        "industry": info.get("industry") or "Ukjent",
        "employees": int(info.get("fullTimeEmployees") or 0),
        "headquarters": ", ".join(filter(None, [info.get("city"), info.get("country")])) or "Norge",
        "description": info.get("longBusinessSummary") or "Norsk børsnotert selskap",
        
        # Price ranges
        "price_52w_high": round(float(week_52_high or 0), 2),
        "price_52w_low": round(float(week_52_low or 0), 2),
        
        # Performance metrics
        **performance,
        
        # Valuation metrics (both raw and formatted)
        **valuation_metrics,
        
        # Chart data and metadata
        "chart_data": chart,
        "last_updated": datetime.now().isoformat(timespec="seconds"),
    }
    
    log.info(f"✅ {data['company_name']}: price {data['current_price']} NOK, "
             f"quality score {data['data_quality_score']}, {len(chart)} chart points")
    
    if valuation_metrics['data_quality_issues']:
        log.warning(f"Data quality issues for {ticker_norm}: {valuation_metrics['data_quality_issues']}")
    
    return data

# ---------- Selection and hints ----------
def load_obx_list() -> List[Dict]:
    """Load OBX stock list from data/obx.json"""
    ensure_data_dir()
    if not OBX_PATH.exists():
        raise FileNotFoundError(f"Missing {OBX_PATH}")
    
    with OBX_PATH.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    
    # Handle different JSON structures
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict) and isinstance(raw.get("stocks"), list):
        items = raw["stocks"]
    else:
        raise ValueError(f"Unsupported schema in {OBX_PATH}; expected list or object with 'stocks' array")
    
    out: List[Dict] = []
    for item in items:
        name = item.get("name") or item.get("company_name") or item.get("symbol") or item.get("ticker")
        symbol = item.get("ticker") or item.get("symbol") or ""
        if symbol:
            out.append({"name": name, "ticker": symbol})
    
    if not out:
        raise ValueError(f"No usable entries in {OBX_PATH}")
    return out

def select_daily_stock() -> Dict:
    """Select daily stock deterministically based on date"""
    stocks = load_obx_list()
    today = datetime.now().strftime("%Y-%m-%d")
    
    # Use date as seed for reproducible "random" selection
    random.seed(today)
    selected = random.choice(stocks)
    
    log.info(f"📅 Selected for {today}: {selected['name']} ({selected['ticker']})")
    return selected

def calculate_difficulty_rating(data: Dict) -> str:
    """Calculate game difficulty based on various factors"""
    # Factors that make a stock harder to guess
    score = 0
    
    # Market cap - smaller companies are harder
    market_cap_raw = data.get('market_cap_raw', 0)
    if market_cap_raw < 1e9:  # < 1B NOK
        score += 3
    elif market_cap_raw < 10e9:  # < 10B NOK
        score += 2
    else:
        score += 1
    
    # Volatility - more volatile is harder
    volatility = data.get('volatility', 0)
    if volatility > 50:
        score += 3
    elif volatility > 30:
        score += 2
    else:
        score += 1
    
    # Performance consistency
    perf_1y = abs(data.get('performance_1y', 0))
    perf_5y = abs(data.get('performance_5y', 0))
    if perf_1y > 100 or perf_5y > 500:  # Very high performance swings
        score += 2
    
    # Sector familiarity (some sectors are more well-known)
    sector = data.get('sector', '').lower()
    if sector in ['technology', 'consumer', 'healthcare']:
        score += 0  # Easy sectors
    elif sector in ['utilities', 'real estate']:
        score += 1  # Medium sectors
    else:
        score += 2  # Hard/unknown sectors
    
    # Convert score to rating
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
    
    if data.get('market_cap_raw', 0) > 0:
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
    print(f"\n📊 FINANSLE DATA SUMMARY")
    print(f"════════════════════════")
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
    
    # Show data quality issues if any
    issues = data.get('data_quality_issues', [])
    if issues:
        print(f"\n⚠️  Data Quality Issues:")
        for issue in issues[:5]:  # Show max 5 issues
            print(f"  • {issue}")
        if len(issues) > 5:
            print(f"  ... and {len(issues) - 5} more issues")

# ---------- main ----------
def main():
    """Main function to generate daily stock data for finansle"""
    log.info("🚀 Starting enhanced finansle stock data generation…")
    ensure_data_dir()
    
    # Select daily stock
    try:
        selected_stock = select_daily_stock()
    except Exception as e:
        log.error(f"Failed to select daily stock: {e}")
        log.error("Check data/obx.json format and content")
        return
    
    base_ticker = selected_stock.get("ticker") or selected_stock.get("symbol") or ""
    if not base_ticker:
        log.error("Selected stock has no ticker/symbol field")
        return
    
    # Fetch comprehensive stock data
    data = fetch_enhanced_stock_data(base_ticker)
    if not data:
        log.error(f"Failed to fetch enhanced data for {base_ticker}")
        return
    
    # Add game-specific metadata
    data["difficulty_rating"] = calculate_difficulty_rating(data)
    data["hint_categories"] = get_hint_categories(data)
    
    # Write data atomically
    tmp_path = DAILY_PATH.with_suffix(".json.tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp_path.replace(DAILY_PATH)
        log.info(f"✅ Successfully saved {DAILY_PATH}")
    except Exception as e:
        log.error(f"Failed to write data file: {e}")
        if tmp_path.exists():
            tmp_path.unlink()
        return
    
    # Print summary
    print_summary(data)
    
    # Final validation
    chart_points = len(data.get('chart_data', []))
    quality_score = data.get('data_quality_score', 0)
    
    if chart_points < 100:
        log.warning(f"Low chart data points: {chart_points}")
    if quality_score < 0.5:
        log.warning(f"Low data quality score: {quality_score}")
    
    log.info("🎯 Finansle data generation completed successfully!")

if __name__ == "__main__":
    main()