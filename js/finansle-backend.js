// js/finansle-backend.js
class FinansleGame {
  constructor() {
    this.currentAttempt = 1;
    this.gameEnded = false;
    this.gameStats = this.loadStats();

    this.allStocks = [];
    this.dailyStock = null;
    this.clueTypes = [];

    this.guessedCompanies = new Set(); // Track guessed company names/tickers
    this.guessHistory = []; // NEW: Array to store full guess data
    
    this.shortDescriptions = null;
    this.allMetrics = {};

    this.init();
  }

  async init() {
    try {
      console.log("🚀 Initializing Finansle…");

      await this.loadDailyJson();
      await this.loadStocksList();
      await this.loadShortDescriptions();
      await this.loadSectorData();
      await this.loadAllStocksMetrics();

      this.setupEventListeners();

      this.showMainChart();
      this.positionCluesAboveSearch();
      this.generateClueCards();
      this.updateDayNumber();

      console.log("✅ Game initialized");

      this.updatePageTitle();
    } catch (err) {
      console.error("❌ init failed:", err);
      this.showError("Kunne ikke laste dagens data. Prøv å refresh siden.");
    }
  }

  // ------------------ Data ------------------
  async loadDailyJson() {
    const res = await fetch(`data/daily.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading daily.json`);
    const raw = await res.json();

    const { stock } = this.normalizeDailyJson(raw);
    if (stock.chart_data?.length > 1) this.applyDerivedMetrics(stock);

    this.dailyStock = stock;
    console.log(`📈 chart points: ${stock.chart_data?.length || 0}`);
  }

  async loadStocksList() {
  try {
    const res = await fetch(`data/oslo_companies_short_no.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading oslo_companies_short_no.json`);
    const raw = await res.json();

    // oslo_companies_short_no.json er alltid et array
    const list = Array.isArray(raw) ? raw : [];

    this.allStocks = list
      .map((x) => {
        const name = x.company_name || x.name || x.ticker || "";
        const ticker = (x.ticker || "").replace('.OL', '').toUpperCase();
        if (!name || !ticker) return null;
        return {
          name,
          ticker: ticker,
          tickerOL: `${ticker}.OL`,
          english_name: name,
          sector: x.sector || "-",
        };
      })
      .filter(Boolean);

    console.log(`📚 Loaded ${this.allStocks.length} stocks from oslo_companies_short_no.json`);
  } catch (e) {
    console.warn("⚠️ Could not load oslo_companies_short_no.json:", e);
    if (!Array.isArray(this.allStocks)) this.allStocks = [];
  }
}

  async loadAllStocksMetrics() {
  try {
    const res = await fetch(`data/all_stocks_metrics.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      console.warn("⚠️ Could not load all stocks metrics");
      this.allMetrics = {};
      return;
    }
    
    this.allMetrics = await res.json();
    console.log(`💰 Loaded metrics for ${Object.keys(this.allMetrics).length} stocks`);
  } catch (e) {
    console.warn("⚠️ Could not load all stocks metrics:", e);
    this.allMetrics = {};
  }
}

  async loadShortDescriptions() {
    try {
      const res = await fetch(`data/oslo_companies_short_no.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        console.warn("⚠️ Could not load short descriptions");
        this.shortDescriptions = {};
        return;
      }
      
      const data = await res.json();
      this.shortDescriptions = {};
      
      data.forEach(company => {
        if (company.ticker && company.original_description) {
          const baseTicker = company.ticker.replace('.OL', '');
          this.shortDescriptions[company.ticker] = company.original_description;
          this.shortDescriptions[baseTicker] = company.original_description;
        }
      });
      
      console.log(`📝 Loaded ${Object.keys(this.shortDescriptions).length / 2} short descriptions`);
    } catch (e) {
      console.warn("⚠️ Could not load short descriptions:", e);
      this.shortDescriptions = {};
    }
  }

  async loadSectorData() {
  try {
    const res = await fetch(`data/oslo_companies_short_no.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      console.warn("⚠️ Could not load sector data");
      this.sectorLookup = {};
      this.industryLookup = {}; // NY
      return;
    }
    
    const data = await res.json();
    this.sectorLookup = {};
    this.industryLookup = {}; // NY
    
    data.forEach(company => {
      if (company.ticker) {
        const baseTicker = company.ticker.replace('.OL', '');
        
        // Sektor
        if (company.sector) {
          this.sectorLookup[company.ticker] = company.sector;
          this.sectorLookup[baseTicker] = company.sector;
        }
        
        // NYTT: Industri
        if (company.industry) {
          this.industryLookup[company.ticker] = company.industry;
          this.industryLookup[baseTicker] = company.industry;
        }
      }
    });
    
    console.log(`🏢 Loaded ${Object.keys(this.sectorLookup).length / 2} sector mappings`);
    console.log(`🏭 Loaded ${Object.keys(this.industryLookup).length / 2} industry mappings`); // NY
  } catch (e) {
    console.warn("⚠️ Could not load sector data:", e);
    this.sectorLookup = {};
    this.industryLookup = {}; // NY
  }
}

  getShortDescription(ticker, fallbackDescription) {
    if (!this.shortDescriptions) return fallbackDescription || "Norsk børsnotert selskap";
    
    if (this.shortDescriptions[ticker]) {
      return this.shortDescriptions[ticker];
    }
    
    const baseTicker = ticker.replace('.OL', '');
    if (this.shortDescriptions[baseTicker]) {
      return this.shortDescriptions[baseTicker];
    }
    
    if (!ticker.includes('.OL') && this.shortDescriptions[ticker + '.OL']) {
      return this.shortDescriptions[ticker + '.OL'];
    }
    
    return fallbackDescription || "Norsk børsnotert selskap";
  }

  getSector(ticker) {
    if (!this.sectorLookup) return null;
    
    if (this.sectorLookup[ticker]) {
      return this.sectorLookup[ticker];
    }
    
    const baseTicker = ticker.replace('.OL', '');
    if (this.sectorLookup[baseTicker]) {
      return this.sectorLookup[baseTicker];
    }
    
    if (!ticker.includes('.OL') && this.sectorLookup[ticker + '.OL']) {
      return this.sectorLookup[ticker + '.OL'];
    }
    
    return null;
  }

  normalizeDailyJson(raw) {
    const isFlat = !!raw.chart_data || !!raw.company_name || !!raw.ticker;
    const stock = isFlat ? raw : (raw.stock || {});
    return { stock };
  }

  applyDerivedMetrics(stock) {
    const data = stock.chart_data;
    if (!data || data.length < 2) return;

    const first = data[0].price;
    const last = data[data.length - 1].price;
    const perf = ((last - first) / first) * 100;
    stock.performance_5y = perf;
  }

  // ------------------ Event Listeners ------------------
  setupEventListeners() {
    const input = document.getElementById("stock-search");
    const guessBtn = document.getElementById("guess-btn");
    const shareBtn = document.getElementById("share-btn");
    const overlay = document.getElementById("modal-overlay");
    const dropdown = document.getElementById("autocomplete-dropdown");

    if (input && guessBtn) {
      input.addEventListener("input", (e) => this.handleSearchInput(e));
      input.addEventListener("keydown", (e) => this.handleSearchKeydown(e));
      guessBtn.addEventListener("click", () => this.handleGuess());
    }

    this.setupAboutModal();

    shareBtn?.addEventListener("click", () => this.shareResults());
    overlay?.addEventListener("click", (e) => { 
      if (e.target === overlay) overlay.style.display = "none"; 
    });

    const modalClose = document.getElementById("modal-close");
    modalClose?.addEventListener("click", () => {
      if (overlay) overlay.style.display = "none";
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-container") && dropdown) {
        dropdown.style.display = "none";
      }
    });

    window.addEventListener("resize", () => this.redrawChart());
  }

  positionCluesAboveSearch() {
    const clues = document.getElementById("clues-section");
    const search = document.querySelector(".search-container");
    if (clues && search && clues.nextElementSibling !== search) {
      search.parentElement.insertBefore(clues, search);
    }
  }

  // ------------------ Search / Guess ------------------
  normalizeTicker(t) {
    return (t || "").toUpperCase().replace(/\.OL$/i, "");
  }

  handleSearchInput(e) {
    const q = e.target.value.toLowerCase().trim();
    const guessBtn = document.getElementById("guess-btn");
    const dropdown = document.getElementById("autocomplete-dropdown");

    if (q.length < 2) {
      dropdown && (dropdown.style.display = "none");
      if (guessBtn) guessBtn.disabled = true;
      return;
    }

    const matches = this.allStocks.filter(s => {
      const name = (s.name || "").toLowerCase();
      const ticker = (s.ticker || "").toLowerCase();
      return name.includes(q) || ticker.includes(q);
    }).slice(0, 8);

    if (matches.length === 0) {
      dropdown && (dropdown.style.display = "none");
      if (guessBtn) guessBtn.disabled = true;
      return;
    }

    const html = matches.map(s => {
      const companyIdentifier = s.name || s.ticker;
      const isGuessed = this.guessedCompanies.has(companyIdentifier.toLowerCase());
      const className = isGuessed ? "autocomplete-item guessed" : "autocomplete-item";
      const guessedLabel = isGuessed ? " (allerede gjettet)" : "";
      
      return `<div class="${className}" data-name="${s.name}" data-ticker="${s.ticker}">
        ${s.name} (${s.ticker}) [${s.sector}]${guessedLabel}
      </div>`;
    }).join("");

    if (dropdown) {
      dropdown.innerHTML = html;
      dropdown.style.display = "block";
      dropdown.querySelectorAll(".autocomplete-item").forEach(item => {
        item.addEventListener("click", () => {
          this.selectStock({ name: item.dataset.name, ticker: item.dataset.ticker });
        });
      });
    }

    if (guessBtn) guessBtn.disabled = false;
  }

  selectStock(stock) {
  const input = document.getElementById("stock-search");
  const dropdown = document.getElementById("autocomplete-dropdown");
  const guessBtn = document.getElementById("guess-btn");
  
  if (input) {
    input.value = stock.name;
    input.blur();  // Mist fokus
  }
  if (dropdown) dropdown.style.display = "none";
  if (guessBtn) guessBtn.disabled = false;
}

  handleSearchKeydown(e) {
    const guessBtn = document.getElementById("guess-btn");
    const dropdown = document.getElementById("autocomplete-dropdown");
    
    if (e.key === "Enter" && guessBtn && !guessBtn.disabled) {
      this.handleGuess();
      return;
    }
    
    if (!dropdown || dropdown.style.display === "none") return;
    
    const items = dropdown.querySelectorAll(".autocomplete-item");
    if (items.length === 0) return;
    
    let currentIndex = -1;
    items.forEach((item, index) => {
      if (item.classList.contains("highlighted")) {
        currentIndex = index;
      }
    });
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      this.highlightDropdownItem(items, nextIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      this.highlightDropdownItem(items, prevIndex);
    } else if (e.key === "Enter" && currentIndex >= 0) {
      e.preventDefault();
      items[currentIndex].click();
    } else if (e.key === "Escape") {
      dropdown.style.display = "none";
    }
  }

  highlightDropdownItem(items, index) {
    items.forEach(item => item.classList.remove("highlighted"));
    
    if (index >= 0 && index < items.length) {
      items[index].classList.add("highlighted");
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  handleGuess() {
    if (this.gameEnded) return;
    const input = document.getElementById("stock-search");
    if (!input) return;
    const guess = input.value.trim();
    if (!guess) return;

    this.setGuessButtonState(true);
    setTimeout(() => this.processGuess(guess), 200);
  }

  async processGuess(query) {
    try {
      this.setGuessButtonState(true);
      
      const input = document.getElementById("stock-search");
      if (!query) { 
        this.showError("Skriv inn et selskap å gjette på."); 
        return; 
      }

      const g = (this.allStocks || []).find(s =>
        s.name?.toLowerCase() === query.toLowerCase() ||
        s.ticker?.toLowerCase() === query.toLowerCase() ||
        s.tickerOL?.toLowerCase() === query.toLowerCase() ||
        s.english_name?.toLowerCase() === query.toLowerCase()
      );

      if (!g) { 
        this.showError("Ugyldig selskap. Velg fra listen."); 
        return; 
      }

      // CHECK FOR DUPLICATE GUESS
      const companyIdentifier = g.name || g.ticker;
      if (this.guessedCompanies.has(companyIdentifier.toLowerCase())) {
        this.showError("Du har allerede gjettet på dette selskapet. Prøv et annet.");
        return;
      }

      // Add to guessed companies set
      this.guessedCompanies.add(companyIdentifier.toLowerCase());

      const dailyNorm = this.normalizeTicker(this.dailyStock.ticker);
      const guessNorm = this.normalizeTicker(g.ticker);
      const isCorrect = guessNorm === dailyNorm || g.name === this.dailyStock.company_name;

      // NEW: Fetch full stock data for the guess
      const guessData = await this.fetchStockData(g.ticker);
      
      // NEW: Add to guess history
      this.addToGuessHistory(g, guessData, isCorrect);

      if (isCorrect) { 
        this.endGame(true, this.currentAttempt); 
        return; 
      }

      this.processWrongGuess(g);
    } catch (e) {
      console.error("❌ processGuess:", e);
      this.showError("En feil oppstod. Prøv igjen.");
    } finally {
      this.setGuessButtonState(false);
    }
  }

  async fetchStockData(ticker) {
  const baseTicker = ticker.replace('.OL', '');
  const metrics = this.allMetrics?.[baseTicker] || {};
  
  return {
    sector: metrics.sector || this.getSector(ticker) || "-",
    industry: metrics.industry || this.getIndustry(ticker) || "-",
    revenue_2024_formatted: metrics.revenue_2024_formatted || "-",
    ebitda_2024_formatted: metrics.ebitda_2024_formatted || "-",
    net_earnings_2024_formatted: metrics.net_earnings_2024_formatted || "-",
    market_cap: metrics.market_cap || null
  };
}

  // NEW: Add guess to history
  addToGuessHistory(stock, stockData, isCorrect) {
  const guess = {
    name: stock.name,
    ticker: stock.ticker,
    isCorrect: isCorrect,
    sector: stockData?.sector || "-",
    industry: stockData?.industry || "-",
    revenue: stockData?.revenue_2024_formatted || "-",
    ebitda: stockData?.ebitda_2024_formatted || "-",
    netEarnings: stockData?.net_earnings_2024_formatted || "-",
    description: this.getShortDescription(stock.ticker, stockData?.description),
    marketCap: stockData?.market_cap || null
  };

  this.guessHistory.unshift(guess);
  this.renderGuessHistory();
}

  // NEW: Render guess history
  renderGuessHistory() {
    const container = document.getElementById("guess-history");
    if (!container) return;

    if (this.guessHistory.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    
    const html = this.guessHistory.map((guess, index) => {
      const comparison = this.compareToDaily(guess);
      
      return `
        <div class="guess-row ${guess.isCorrect ? 'correct-guess' : ''}">
          <div class="guess-company">${guess.name}</div>
          <div class="guess-metric ${comparison.sector.className}">${comparison.sector.display}</div>
          <div class="guess-metric ${comparison.industry.className}">${comparison.industry.display}</div>
          <div class="guess-metric ${comparison.revenue.className}">${comparison.revenue.display}</div>
          <div class="guess-metric ${comparison.ebitda.className}">${comparison.ebitda.display}</div>
          <div class="guess-metric ${comparison.netEarnings.className}">${comparison.netEarnings.display}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="guess-history-header">
        <div class="header-cell">Selskap</div>
        <div class="header-cell">Sektor</div>
        <div class="header-cell">Bransje</div>
        <div class="header-cell">Omsetning</div>
        <div class="header-cell">EBITDA</div>
        <div class="header-cell">Resultat</div>
      </div>
      ${html}
    `;
  }

  // NEW: Compare guess to daily stock
  compareToDaily(guess) {
    const daily = this.dailyStock;
    
    const result = {
      sector: this.compareField(guess.sector, daily.sector),
      industry: this.compareField(guess.industry, daily.industry),
      revenue: this.compareField(guess.revenue, daily.revenue_2024_formatted),
      ebitda: this.compareField(guess.ebitda, daily.ebitda_2024_formatted),
      netEarnings: this.compareField(guess.netEarnings, daily.net_earnings_2024_formatted)
    };

    return result;
  }

  // NEW: Compare individual field
  compareField(guessValue, dailyValue) {
    // Handle "Ikke tilgjengelig" or null values
    if (!guessValue || guessValue === "-" || 
      !dailyValue || dailyValue === "-") {
    return {
      className: 'metric-unknown',
      display: guessValue || "-"
    };
  }

    // Exact match (for text fields like sector, industry)
    if (guessValue.toString().toLowerCase() === dailyValue.toString().toLowerCase()) {
      return {
        className: 'metric-match',
        display: guessValue
      };
    }

    // For numeric fields, we'd need to parse and compare
    // For now, just show the value in gray if not matching
    return {
      className: 'metric-different',
      display: guessValue
    };
  }

  processWrongGuess() {
    this.updateAttemptDots();
    this.currentAttempt++;
    this.unlockClues();

    const input = document.getElementById("stock-search");
    const guessBtn = document.getElementById("guess-btn");
    if (input) input.value = "";
    if (guessBtn) guessBtn.disabled = true;

    if (this.currentAttempt > 6) {
      this.endGame(false, 6);
      return;
    }

    const el = document.getElementById("current-attempt");
    if (el) el.textContent = this.currentAttempt;
  }

  updateAttemptDots() {
    const dots = document.querySelectorAll(".attempt-dot");
    if (dots[this.currentAttempt - 1]) {
      dots[this.currentAttempt - 1].className = "attempt-dot used";
    }
    if (dots[this.currentAttempt] && this.currentAttempt < 6) {
      dots[this.currentAttempt].className = "attempt-dot current";
    }
  }

  // ------------------ Chart ------------------
  showMainChart() {
  const wrap = document.querySelector(".chart-container");
  if (!wrap) return;

  const perf = this.dailyStock?.performance_5y ?? 0;
  const perfText = `${perf >= 0 ? "+" : ""}${perf.toFixed(1)}%`;

  const cssH = getComputedStyle(document.documentElement).getPropertyValue("--chart-height").trim();
  const chartHeight = parseInt(cssH, 10) || 380;

  wrap.innerHTML = `
    <div style="width:100%;">
        <div class="chart-stage">
            <svg id="main-stock-chart"
                 viewBox="0 0 860 280"
                 preserveAspectRatio="none"
                 style="display:block; width:100%; height:100%;">
                <defs>
                    <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#DDE6ED;stop-opacity:0.3"/>
                        <stop offset="100%" style="stop-color:#DDE6ED;stop-opacity:0.5"/>
                    </linearGradient>
                </defs>
            </svg>
        </div>

      <div class="chart-meta" style="display:flex; justify-content:center; flex-wrap:wrap; gap:32px; margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color);">
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">Siste</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${this.dailyStock.current_price} NOK</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">Siste 5 år</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${perfText}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">Markedsverdi</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${this.dailyStock.market_cap_formatted || this.dailyStock.market_cap}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">P/E</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${this.dailyStock.trailing_pe_formatted || "N/A"}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">EV/EBITDA</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${this.dailyStock.ev_ebitda_formatted || "N/A"}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">P/S</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${this.dailyStock.price_to_sales_formatted || "N/A"}</div>
        </div>
      </div>
    </div>
  `;

  requestAnimationFrame(() => this.drawChartLine());
}
  

  redrawChart() {
  const svg = document.getElementById("main-stock-chart");
  if (!svg) return;
  [...svg.querySelectorAll("polyline,polygon,circle")].forEach(n => n.remove());
  requestAnimationFrame(() => this.drawChartLine());
}

calculateOptimalYAxisTicks(maxPrice, targetTicks = 6) {
  const scores = [];
  const niceNumbers = [1, 2, 5, 10];
  
  for (const base of niceNumbers) {
    for (let power = -2; power <= 6; power++) {
      const interval = base * Math.pow(10, power);
      
      if (interval < 0.01 || interval > maxPrice * 2) continue;
      
      const yMax = Math.ceil(maxPrice / interval) * interval;
      const actualTicks = Math.round(yMax / interval) + 1;
      
      if (actualTicks > 15) continue;
      
      const simplicityScore = 1 - (niceNumbers.indexOf(base) / niceNumbers.length);
      const coverageScore = 1 - Math.abs(yMax - maxPrice) / Math.max(maxPrice, 1);
      const densityScore = 1 - Math.abs(actualTicks - targetTicks) / targetTicks;
      
      const overshootPenalty = Math.max(0, (yMax - maxPrice) / maxPrice - 0.2);
      
      const totalScore = simplicityScore * 0.25 + 
                        coverageScore * 0.25 + 
                        densityScore * 0.45 + 
                        (1 - overshootPenalty) * 0.05;
      
      scores.push({
        interval,
        yMax,
        actualTicks,
        score: totalScore,
        base,
        power
      });
    }
  }
  
  scores.sort((a, b) => b.score - a.score);
  
  if (scores.length === 0) {
    return {
      interval: Math.ceil(maxPrice / 5),
      yAxisMinFinal: 0,
      yAxisMaxFinal: Math.ceil(maxPrice / 5) * 5,
      numSteps: 5
    };
  }
  
  const best = scores[0];
  return {
    interval: best.interval,
    yAxisMinFinal: 0,
    yAxisMaxFinal: best.yMax,
    numSteps: best.actualTicks - 1
  };
}

drawChartLine() {
    const svg = document.getElementById("main-stock-chart");
    const data = this.dailyStock?.chart_data || [];
    if (!svg || data.length < 2) return;

    const rootStyles = getComputedStyle(document.documentElement);
    const cssWidth = rootStyles.getPropertyValue('--chart-width').trim();
    const cssHeight = rootStyles.getPropertyValue('--chart-height').trim();
    
    let width = parseInt(cssWidth) || 860;
    let height = parseInt(cssHeight) || 280;

    if (!width || !height) {
      const computedStyle = getComputedStyle(container);
      width = parseInt(computedStyle.width) || 300;
      height = parseInt(computedStyle.height) || 200;
    }

    if (!width || !height) {
      requestAnimationFrame(() => this.drawChartLine());
      return;
    }

    const isMobile = width < 640;
    const padX = isMobile ? Math.max(50, width * 0.08) : 70;
    const padY = 35;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    [...svg.querySelectorAll("polyline,polygon,circle,text,line")].forEach(n => n.remove());

    const prices = data.map(d => d.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    const padding = maxPrice * 0.05;
    const adjustedMaxPrice = maxPrice + padding;
    
    const availableHeight = height - (2 * padY);
    const idealTickSpacing = isMobile ? 25 : 30;
    const maxPossibleTicks = Math.floor(availableHeight / idealTickSpacing);
    const targetTicks = Math.min(maxPossibleTicks, isMobile ? 8 : 10);
    
    const tickConfig = this.calculateOptimalYAxisTicks(adjustedMaxPrice, targetTicks);
    const { interval, yAxisMinFinal, yAxisMaxFinal, numSteps } = tickConfig;
    
    console.log(`📊 Chart: ${width}x${height}, padX: ${padX}, Y-axis: 0 to ${yAxisMaxFinal} NOK`);

    const x = i => padX + (i / (data.length - 1)) * (width - 2 * padX);
    const y = p => height - padY - ((p - yAxisMinFinal) / (yAxisMaxFinal - yAxisMinFinal)) * (height - 2 * padY);

    const pts = data.map((p, i) => `${x(i)},${y(p.price)}`).join(" ");
    const areaPts = `${x(0)},${height - padY} ${pts} ${x(data.length - 1)},${height - padY}`;

    for (let i = 0; i <= numSteps; i++) {
      const priceLevel = yAxisMinFinal + (i * interval);
      const yPos = y(priceLevel);
      
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", padX - 8);
      label.setAttribute("y", yPos + 4);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("font-size", isMobile ? "10" : "11");
      label.setAttribute("fill", "#94a3b8");
      label.setAttribute("font-weight", "500");
      
      if (interval >= 1) {
        label.textContent = Math.round(priceLevel) + (isMobile ? "" : " NOK");
      } else {
        label.textContent = priceLevel.toFixed(2) + (isMobile ? "" : " NOK");
      }
      
      svg.appendChild(label);
      
      const gridLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      gridLine.setAttribute("x1", padX);
      gridLine.setAttribute("y1", yPos);
      gridLine.setAttribute("x2", width - padX);
      gridLine.setAttribute("y2", yPos);
      gridLine.setAttribute("stroke", "rgba(255,255,255,0.15)");
      gridLine.setAttribute("stroke-width", "0.5");
      
      svg.appendChild(gridLine);
    }

    // Draw X-axis labels (years) - POSITIONED AT ACTUAL JANUARY 1ST DATES
    const yearPositions = [];
    const firstDate = new Date(data[0].date);
    const lastDate = new Date(data[data.length - 1].date);
    const uniqueYears = [...new Set(data.map(d => new Date(d.date).getFullYear()))].sort();
    const currentYear = new Date().getFullYear();
    const dataSpanYears = currentYear - uniqueYears[0];
    const shouldShowIPO = dataSpanYears < 5;
    const totalDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    const chartWidth = width - 2 * padX;

    // Minimum pixel distance between labels to avoid overlap
    const minLabelDistance = isMobile ? 60 : 80;

    if (isMobile) {
      // Mobile: Show IPO/first year, one middle year, "I dag"
      if (uniqueYears.length >= 3) {
        const midYear = uniqueYears[Math.floor(uniqueYears.length / 2)];
        const midYearDate = new Date(midYear, 0, 1);
        const midPosition = (midYearDate - firstDate) / (1000 * 60 * 60 * 24) / totalDays;
        
        yearPositions.push(
          { label: shouldShowIPO ? "IPO" : uniqueYears[0].toString(), x: padX },
          { label: midYear.toString(), x: padX + midPosition * chartWidth },
          { label: "I dag", x: width - padX }
        );
      } else {
        yearPositions.push(
          { label: shouldShowIPO ? "IPO" : uniqueYears[0].toString(), x: padX },
          { label: "I dag", x: width - padX }
        );
      }
    } else {
      // Desktop: Build all potential year positions first
      const allYearPositions = [];
      
      // First position - always at padX
      const firstYear = shouldShowIPO ? "IPO" : uniqueYears[0].toString();
      allYearPositions.push({
        label: firstYear,
        actualYear: uniqueYears[0],
        x: padX
      });
      
      // Add all other years at their January 1st positions
      const yearsToShow = shouldShowIPO ? uniqueYears.slice(1) : uniqueYears.slice(1);
      
      yearsToShow.forEach(year => {
        const jan1 = new Date(year, 0, 1);
        
        if (jan1 >= firstDate && jan1 <= lastDate) {
          const daysDiff = (jan1 - firstDate) / (1000 * 60 * 60 * 24);
          const position = daysDiff / totalDays;
          const xPos = padX + position * chartWidth;
          
          allYearPositions.push({
            label: year.toString(),
            actualYear: year,
            x: xPos
          });
        }
      });
      
      // Now filter: if first and second are too close, skip first
      if (allYearPositions.length >= 2) {
        const distanceToSecond = Math.abs(allYearPositions[1].x - allYearPositions[0].x);
        if (distanceToSecond < minLabelDistance) {
          // Skip first year label, keep the rest
          yearPositions.push(...allYearPositions.slice(1));
        } else {
          // Keep all
          yearPositions.push(...allYearPositions);
        }
      } else {
        yearPositions.push(...allYearPositions);
      }
      
      // Always add "I dag" at the end
      yearPositions.push({
        label: "I dag",
        x: width - padX
      });
    }

    // Draw vertical grid line at chart start (always)
    const startLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    startLine.setAttribute("x1", padX);
    startLine.setAttribute("y1", padY);
    startLine.setAttribute("x2", padX);
    startLine.setAttribute("y2", height - padY);
    startLine.setAttribute("stroke", "rgba(255,255,255,0.08)");
    startLine.setAttribute("stroke-width", "1");
    svg.appendChild(startLine);

    // Draw vertical grid lines and labels for year positions
    yearPositions.forEach(pos => {
      // Vertical line (skip first one since we drew it above)
      if (pos.x !== padX) {
        const vertLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        vertLine.setAttribute("x1", pos.x);
        vertLine.setAttribute("y1", padY);
        vertLine.setAttribute("x2", pos.x);
        vertLine.setAttribute("y2", height - padY);
        vertLine.setAttribute("stroke", "rgba(255,255,255,0.08)");
        vertLine.setAttribute("stroke-width", "1");
        svg.appendChild(vertLine);
      }
      
      // Year label
      const yearLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
      yearLabel.setAttribute("x", pos.x);
      yearLabel.setAttribute("y", height - 8);
      yearLabel.setAttribute("text-anchor", "middle");
      yearLabel.setAttribute("font-size", isMobile ? "10" : "11");
      yearLabel.setAttribute("fill", "#94a3b8");
      yearLabel.setAttribute("font-weight", "500");
      yearLabel.textContent = pos.label;
      
      svg.appendChild(yearLabel);
    });

    const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    area.setAttribute("fill", "url(#chartGradient)");
    area.setAttribute("points", areaPts);
    svg.appendChild(area);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#33b400ff");
    line.setAttribute("stroke-width", isMobile ? "2.2" : "2.6");
    line.setAttribute("points", pts);
    line.style.filter = "drop-shadow(0 0 2px rgba(34,197,94,0.28))";
    svg.appendChild(line);

    const last = data[data.length - 1];
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", x(data.length - 1));
    dot.setAttribute("cy", y(last.price));
    dot.setAttribute("r", isMobile ? "3.5" : "4.2");
    dot.setAttribute("fill", "#33b400ff");
    svg.appendChild(dot);
}

  // ------------------ Clues ------------------
  generateClueCards() {
  const s = this.dailyStock;
  const ticker = s?.ticker;
  const baseTicker = ticker?.replace('.OL', '');
  const metrics = this.allMetrics?.[baseTicker] || {};
  
  this.clueTypes = [
    {
      id: "sector",
      title: "Sektor",
      unlock: 1,
      getValue: () => this.getSector(ticker) || s?.sector || "Ikke tilgjengelig"
    },
    {
      id: "target-mean",
      title: "Kursmål (snitt)",
      unlock: 2,
      getValue: () => metrics.target_mean_formatted || s?.target_mean_formatted || "Ikke tilgjengelig"
    },
    {
      id: "industry",
      title: "Bransje",
      unlock: 3,
      getValue: () => this.getIndustry(ticker) || s?.industry || "Ikke tilgjengelig"
    },
    {
      id: "revenue",
      title: "FY24 Omsetning",
      unlock: 4,
      getValue: () => metrics.revenue_2024_formatted || s?.revenue_2024_formatted || "Ikke tilgjengelig"
    },
    {
      id: "target-range",
      title: "Kursmål (spread)",
      unlock: 5,
      getValue: () => metrics.target_range_formatted || s?.target_range_formatted || "Ikke tilgjengelig"
    },
    {
      id: "description",
      title: "Hovedvirksomhet",
      unlock: 6,
      getValue: () => this.getShortDescription(s?.ticker, s?.description)
    }
  ];

    const host = document.getElementById("clues-section");
    if (!host) return;
    host.innerHTML = "";

    this.clueTypes.forEach(c => {
      const card = document.createElement("div");
      card.className = `clue-card ${c.unlock > 1 ? "locked" : "revealed"}`;
      card.id = `clue-${c.id}`;
      card.innerHTML = `
        <div class="clue-header">
          <div class="clue-title">${c.title}</div>
        </div>
        <div class="clue-content">
          <div class="clue-value" id="clue-${c.id}-value">
            ${c.unlock === 1 ? c.getValue() : `🔒 Lås opp etter ${c.unlock - 1} feil gjetning${c.unlock > 2 ? 'er' : ''}`}
          </div>
        </div>
      `;
      host.appendChild(card);
    });

    this.updateHintBar();
  }

  updateHintBar() {
    const hintBar = document.getElementById("hint-bar");
    if (!hintBar || !this.clueTypes) return;

    hintBar.innerHTML = '';

    const hintItems = [];
    this.clueTypes.forEach(clue => {
      const shouldUnlock = this.gameEnded || clue.unlock <= this.currentAttempt;
      
      if (shouldUnlock) {
        const value = clue.getValue();
        hintItems.push(`
          <div class="hint-item">
            <span class="hint-label">${clue.title}:</span>
            <span class="hint-value revealed">${value}</span>
          </div>
        `);
      } else {
        hintItems.push(`
          <div class="hint-item">
            <span class="hint-label">${clue.title}:</span>
            <span class="hint-value locked">Låst</span>
          </div>
        `);
      }
    });

    hintBar.innerHTML = hintItems.join('');
  }

  unlockClues() {
    this.clueTypes.forEach(c => {
      if (c.unlock <= this.currentAttempt) {
        const card = document.getElementById(`clue-${c.id}`);
        const val = document.getElementById(`clue-${c.id}-value`);
        if (card && val) {
          card.classList.remove("locked");
          card.classList.add("revealed");
          val.textContent = c.getValue();
        }
      }
    });
    
    this.updateHintBar();
  }

  unlockAllClues() {
    this.clueTypes.forEach(c => {
      const card = document.getElementById(`clue-${c.id}`);
      const val = document.getElementById(`clue-${c.id}-value`);
      if (card && val) {
        card.classList.remove("locked");
        card.classList.add("revealed");
        val.textContent = c.getValue();
      }
    });
    
    this.updateHintBar();
  }

  // ------------------ End game & Stats ------------------
  endGame(won, attempts) {
    this.gameEnded = true;
    this.updateStats(won, attempts);
    this.revealCompanyName();
    this.showEndGameModal(won, attempts);
    this.unlockAllClues();
  }

  revealCompanyName() {
    const subtitle = document.getElementById("main-subtitle");
    if (subtitle && this.dailyStock) {
      subtitle.textContent = this.dailyStock.company_name;
      subtitle.classList.add("revealed");
    }
  }

  showEndGameModal(won, attempts) {
    const title = document.getElementById("modal-title");
    const content = document.getElementById("modal-content");
    const name = document.getElementById("company-name");
    const overlay = document.getElementById("modal-overlay");

    if (title) title.textContent = won ? "Gratulerer!" : "Bra forsøk!";
    if (content) content.textContent = won 
      ? `Du gjettet riktig på forsøk ${attempts}!` 
      : `Dagens selskap var:`;
    if (name) name.textContent = this.dailyStock?.company_name || "";
    if (overlay) overlay.style.display = "flex";

    this.renderStatsModal();
  }

  renderStatsModal() {
    const winPct = this.gameStats.played > 0 
      ? Math.round((this.gameStats.won / this.gameStats.played) * 100) 
      : 0;
    const nodes = {
      played: document.querySelector(".stats-grid .stat-item:nth-child(1) .stat-value"),
      winPercent: document.querySelector(".stats-grid .stat-item:nth-child(2) .stat-value"),
      streak: document.querySelector(".stats-grid .stat-item:nth-child(3) .stat-value"),
      avgGuesses: document.querySelector(".stats-grid .stat-item:nth-child(4) .stat-value"),
    };
    if (nodes.played) nodes.played.textContent = this.gameStats.played;
    if (nodes.winPercent) nodes.winPercent.textContent = `${winPct}%`;
    if (nodes.streak) nodes.streak.textContent = this.gameStats.streak;
    if (nodes.avgGuesses) nodes.avgGuesses.textContent = this.gameStats.avgAttempts || "0";
  }

  setupAboutModal() {
    const aboutBtn = document.getElementById('about-btn');
    const aboutModal = document.getElementById('about-modal-overlay');
    const aboutCloseBtn = document.getElementById('about-modal-close');

    if (aboutBtn && aboutModal) {
      aboutBtn.addEventListener('click', function() {
        aboutModal.classList.add('show');
      });
    }

    if (aboutCloseBtn && aboutModal) {
      aboutCloseBtn.addEventListener('click', function() {
        aboutModal.classList.remove('show');
      });
    }

    if (aboutModal) {
      aboutModal.addEventListener('click', function(e) {
        if (e.target === aboutModal) {
          aboutModal.classList.remove('show');
        }
      });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && aboutModal && aboutModal.classList.contains('show')) {
        aboutModal.classList.remove('show');
      }
    });
  }

  updatePageTitle() {
    const dayNumber = Math.floor((new Date() - new Date("2025-09-23T00:00:00")) / 86400000) + 1;
    document.title = `Finansle #${dayNumber}`;
  }

  // ------------------ Utils ------------------
  updateDayNumber() {
    const el = document.getElementById("daily-number");
    if (el) el.textContent = this.getDayNumber();
  }

  getDayNumber() {
    const today = new Date();
    const start = new Date("2025-09-23T00:00:00");
    start.setHours(0, 0, 0, 0);
    return Math.floor((today - start) / 86400000) + 1;
  }

  getIndustry(ticker) {
    if (!this.industryLookup) return null;
    
    if (this.industryLookup[ticker]) {
      return this.industryLookup[ticker];
    }
    
    const baseTicker = ticker.replace('.OL', '');
    if (this.industryLookup[baseTicker]) {
      return this.industryLookup[baseTicker];
    }
    
    if (!ticker.includes('.OL') && this.industryLookup[ticker + '.OL']) {
      return this.industryLookup[ticker + '.OL'];
    }
    
    return null;
  }

  setGuessButtonState(loading) {
    const btn = document.getElementById("guess-btn");
    const text = document.getElementById("guess-btn-text");
    const spin = document.getElementById("guess-loading");
    if (loading) {
      if (text) text.textContent = "Gjetter…";
      if (spin) spin.style.display = "inline-block";
      if (btn) btn.disabled = true;
    } else {
      if (text) text.textContent = "Gjett";
      if (spin) spin.style.display = "none";
      if (btn) btn.disabled = false;
    }
  }

  showError(message) {
    try {
      const toast = document.createElement("div");
      toast.className = "toast-error";
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.classList.add("show");
        setTimeout(() => {
          toast.classList.remove("show");
          setTimeout(() => document.body.removeChild(toast), 200);
        }, 2200);
      }, 10);
    } catch { 
      alert(message); 
    }
  }

  shareResults() {
    const won = this.gameEnded && !!document.getElementById("modal-overlay")?.style?.display;
    const attempts = this.currentAttempt - (won ? 1 : 0);
    let squares = "";
    for (let i = 1; i <= 6; i++) {
      squares += (won && i === attempts) ? "🟢" : (i < this.currentAttempt ? "🟡" : "⬛");
    }
    const text = `Finansle ${this.getDayNumber()}\n${won ? `${attempts}/6` : "X/6"}\n\n${squares}\n\nSpill på: ${window.location.href}`;
    
    if (navigator.share) {
      navigator.share({ title: "Finansle", text }).catch(() => navigator.clipboard?.writeText(text));
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => this.showError("Resultat kopiert til utklippstavlen!"));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      this.showError("Resultat kopiert!");
    }
  }

  loadStats() {
    const def = { played: 0, won: 0, streak: 0, maxStreak: 0, avgAttempts: 0 };
    try {
      const saved = localStorage.getItem("finansle-stats");
      return saved ? { ...def, ...JSON.parse(saved) } : def;
    } catch {
      return def;
    }
  }

  saveStats() {
    try {
      localStorage.setItem("finansle-stats", JSON.stringify(this.gameStats));
    } catch {}
  }

  updateStats(won, attempts) {
    this.gameStats.played++;
    if (won) {
      this.gameStats.won++;
      this.gameStats.streak++;
      this.gameStats.maxStreak = Math.max(this.gameStats.maxStreak, this.gameStats.streak);
      const total = this.gameStats.avgAttempts * (this.gameStats.won - 1) + attempts;
      this.gameStats.avgAttempts = +(total / this.gameStats.won).toFixed(1);
    } else {
      this.gameStats.streak = 0;
    }
    this.saveStats();
  }
}

// Global feedback function
function openFeedback() {
  const modal = document.getElementById('feedback-modal');
  const getDayNumber = () => {
    const today = new Date();
    const start = new Date("2025-09-23T00:00:00");
    start.setHours(0, 0, 0, 0);
    return Math.floor((today - start) / 86400000) + 1;
  };

  document.getElementById('feedback-day').value = getDayNumber();
  document.getElementById('feedback-url').value = window.location.href;
  
  modal.style.display = 'flex';
}

function closeFeedbackModal() {
  document.getElementById('feedback-modal').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('feedback-form');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Sender...';
      submitBtn.disabled = true;
      
      try {
        const formData = new FormData(form);
        const response = await fetch(form.action, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (response.ok) {
          closeFeedbackModal();
          form.reset();
        } else {
          throw new Error('Network response was not ok');
        }
      } catch (error) {
        console.error('Error:', error);
        submitBtn.textContent = 'Kunne ikke sende. Prøv igjen.';
      } finally {
        setTimeout(() => {
          submitBtn.textContent = originalText;
          submitBtn.disabled = false;
        }, 3000);
      }
    });
  }
});

// Initialize game when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.game = new FinansleGame();
  });
} else {
  window.game = new FinansleGame();
}
