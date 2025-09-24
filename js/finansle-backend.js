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
    
    this.shortDescriptions = null; // Add this line

    this.init();
  }

  async init() {
    try {
      console.log("🚀 Initializing Finansle…");

      await this.loadDailyJson();
      await this.loadStocksList();
      await this.loadShortDescriptions();  

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
      const res = await fetch(`data/obx.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} loading obx.json`);
      const raw = await res.json();

      // Handle shapes:
      // 1) { stocks: [...] }  ← your file
      // 2) [ ... ]
      // 3) { TICKER: {...}, ... }
      let list = [];
      if (Array.isArray(raw)) {
        list = raw;
      } else if (raw && Array.isArray(raw.stocks)) {
        list = raw.stocks;
      } else if (raw && typeof raw === "object") {
        list = Object.values(raw);
      }

      // Map to { name, ticker, english_name }.
      // Add .OL suffix so yfinance-style tickers will match.
      this.allStocks = list
        .map((x) => {
          const name = x.name || x.company_name || x.ticker || x.symbol || "";
          const base = (x.symbol || x.ticker || "").toUpperCase();
          if (!name || !base) return null;
          return {
            name,
            ticker: base,           // e.g. EQNR
            tickerOL: `${base}.OL`, // e.g. EQNR.OL
            english_name: name,
          };
        })
        .filter(Boolean);

      console.log(`📚 Loaded ${this.allStocks.length} stocks from obx.json`);
    } catch (e) {
      console.warn("⚠️ Could not load obx.json:", e);
      if (!Array.isArray(this.allStocks)) this.allStocks = [];
    }
  }

  updateHintBar() {
  const hintBar = document.getElementById("hint-bar");
  if (!hintBar || !this.clueTypes) return;

  // Clear existing hints
  hintBar.innerHTML = '';

  // Build hint items for unlocked clues
  const hintItems = [];
  this.clueTypes.forEach(clue => {
    // Check if game ended (won or lost) OR if clue should be unlocked based on attempts
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

  // Close modal when clicking outside
  if (aboutModal) {
    aboutModal.addEventListener('click', function(e) {
      if (e.target === aboutModal) {
        aboutModal.classList.remove('show');
      }
    });
  }

  // Close modal on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && aboutModal && aboutModal.classList.contains('show')) {
      aboutModal.classList.remove('show');
    }
  });
}

updatePageTitle() {
  const dayNumber = Math.floor((new Date() - new Date("2025-09-23T00:00:00")) / 86400000) + 1;
  document.title = `Finansle #${dayNumber} - Daglig Norsk Aksje Gjettelekspill | Oslo Børs Quiz`;
}

  normalizeDailyJson(raw) {
    const isFlat = !!raw.chart_data || !!raw.company_name || !!raw.ticker;

    if (isFlat) {
      const s = {
        company_name: raw.company_name,
        ticker: (raw.ticker || "").toUpperCase(), // may include .OL
        current_price: Number(raw.current_price ?? 0),
        market_cap: raw.market_cap || this.formatMarketCap(raw.market_cap_raw),
        sector: raw.sector || "Ukjent",
        industry: raw.industry || "Ukjent",
        employees: Number(raw.employees || 0),
        headquarters: raw.headquarters || "Norge",
        description: raw.description || "Norsk børsnotert selskap",
        price_52w_high: Number(raw.price_52w_high ?? 0),
        price_52w_low: Number(raw.price_52w_low ?? 0),
        performance_5y: Number(raw.performance_5y ?? 0),
        performance_2y: Number(raw.performance_2y ?? 0),
        performance_1y: Number(raw.performance_1y ?? 0),
        chart_data: raw.chart_data || [],
      };
      return { stock: s };
    }

    // Nested shape fallback
    const info = raw.stock?.info || {};
    const s = {
      company_name: info.longName || raw.stock?.name || info.symbol || "",
      ticker: (info.symbol || raw.stock?.symbol || "").toUpperCase(),
      current_price: Number(raw.stock?.current_price ?? info.currentPrice ?? info.regularMarketPrice ?? 0),
      market_cap: this.formatMarketCap(info.marketCap),
      sector: info.sector || "Ukjent",
      industry: info.industry || "Ukjent",
      employees: Number(info.fullTimeEmployees || 0),
      headquarters: [info.city, info.country].filter(Boolean).join(", ") || "Norge",
      description: info.longBusinessSummary || "Norsk børsnotert selskap",
      price_52w_high: Number(info.fiftyTwoWeekHigh ?? 0),
      price_52w_low: Number(info.fiftyTwoWeekLow ?? 0),
      performance_5y: 0,
      performance_2y: 0,
      performance_1y: 0,
      chart_data: raw.stock?.chart_data || raw.chart_data || [],
    };
    return { stock: s };
  }

  formatMarketCap(n) {
    const v = Number(n || 0);
    if (!v || !isFinite(v)) return "Ikke tilgjengelig";
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)} bill NOK`;
    if (v >= 1e9)  return `${Math.round(v / 1e9)} mrd NOK`;
    return `${Math.round(v / 1e6)} mill NOK`;
  }

  applyDerivedMetrics(s) {
    const data = s.chart_data;
    const first = data[0].price;
    const last  = data[data.length - 1].price;
    const pct = (a, b) => (a > 0 ? ((b - a) / a) * 100 : 0);

    s.performance_5y = +pct(first, last).toFixed(2);

    const byYearsBack = (k) => {
      const d = new Date(data[data.length - 1].date);
      d.setFullYear(d.getFullYear() - k);
      for (let i = 0; i < data.length; i++) {
        if (new Date(data[i].date) >= d) return data[i].price;
      }
      return data[0].price;
    };
    const p2 = byYearsBack(2);
    const p1 = byYearsBack(1);
    s.performance_2y = +pct(p2, last).toFixed(2);
    s.performance_1y = +pct(p1, last).toFixed(2);

    const oneYearAgo = new Date(data[data.length - 1].date);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const lastYear = data.filter((pt) => new Date(pt.date) >= oneYearAgo).map((pt) => pt.price);
    if (lastYear.length) {
      s.price_52w_high = +Math.max(...lastYear).toFixed(2);
      s.price_52w_low  = +Math.min(...lastYear).toFixed(2);
    }
    s.current_price = +last.toFixed(2);
  }

  // ------------------ UI wiring ------------------
  setupEventListeners() {
    const input     = document.getElementById("stock-search");
    const dropdown  = document.getElementById("autocomplete-dropdown");
    const guessBtn  = document.getElementById("guess-btn");
    const shareBtn  = document.getElementById("share-btn");
    const overlay   = document.getElementById("modal-overlay");

    if (input && guessBtn) {
      input.addEventListener("input",  (e) => this.handleSearchInput(e));
      input.addEventListener("keydown",(e) => this.handleSearchKeydown(e));
      guessBtn.addEventListener("click", () => this.handleGuess());
    }

    this.setupAboutModal();

    shareBtn?.addEventListener("click", () => this.shareResults());
    overlay?.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });

    // Add close button event listener
    const modalClose = document.getElementById("modal-close");
    modalClose?.addEventListener("click", () => {
      if (overlay) overlay.style.display = "none";
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-container") && dropdown) dropdown.style.display = "none";
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

    const matches = (this.allStocks || []).filter(
      s => s.name?.toLowerCase().includes(q) ||
           s.ticker?.toLowerCase().includes(q) ||
           s.english_name?.toLowerCase().includes(q)
    );

    this.showAutocompleteOptions(matches.slice(0, 8));

    const exact = matches.find(s =>
      s.name?.toLowerCase() === q ||
      s.ticker?.toLowerCase() === q ||
      s.tickerOL?.toLowerCase() === q ||
      s.english_name?.toLowerCase() === q
    );
    if (guessBtn) guessBtn.disabled = !exact;
  }

  showAutocompleteOptions(options) {
  const dropdown = document.getElementById("autocomplete-dropdown");
  if (!dropdown) return;
  if (!options.length) { dropdown.style.display = "none"; return; }

  dropdown.innerHTML = "";
  options.forEach((s, index) => {
    const item = document.createElement("div");
    item.className = "autocomplete-item";
    const label = `${s.name} (${s.ticker})`;
    item.textContent = label;
    item.addEventListener("click", () => this.selectStock(s));
    
    // Add mouse hover support
    item.addEventListener("mouseenter", () => {
      this.highlightDropdownItem(dropdown.querySelectorAll(".autocomplete-item"), index);
    });
    
    dropdown.appendChild(item);
  });
  dropdown.style.display = "block";
}

  selectStock(stock) {
    const input = document.getElementById("stock-search");
    const dropdown = document.getElementById("autocomplete-dropdown");
    const guessBtn = document.getElementById("guess-btn");
    if (input) input.value = stock.name;
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
  
  // Handle arrow key navigation
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
  // Remove existing highlights
  items.forEach(item => item.classList.remove("highlighted"));
  
  // Add highlight to selected item
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

  async processGuess() {
  try {
    this.setGuessButtonState(true);
    
    const input = document.getElementById("stock-search");
    const query = input?.value?.trim();
    if (!query) { this.showError("Skriv inn et selskap å gjette på."); return; }

    const g = (this.allStocks || []).find(s =>
      s.name?.toLowerCase() === query.toLowerCase() ||
      s.ticker?.toLowerCase() === query.toLowerCase() ||
      s.tickerOL?.toLowerCase() === query.toLowerCase() ||
      s.english_name?.toLowerCase() === query.toLowerCase()
    );

    if (!g) { this.showError("Ugyldig selskap. Velg fra listen."); return; }

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

    if (isCorrect) { this.endGame(true, this.currentAttempt); return; }

    this.processWrongGuess(g);
  } catch (e) {
    console.error("❌ processGuess:", e);
    this.showError("En feil oppstod. Prøv igjen.");
  } finally {
    this.setGuessButtonState(false);
  }
}

  processWrongGuess() {
  this.updateAttemptDots();
  this.currentAttempt++;
  this.unlockClues();

  const input = document.getElementById("stock-search");
  const guessBtn = document.getElementById("guess-btn");
  if (input) input.value = "";
  if (guessBtn) guessBtn.disabled = true;

  // Check for game end BEFORE updating the display
  if (this.currentAttempt > 6) {
    this.endGame(false, 6);
    return; // Don't update display if game has ended
  }

  // Only update display if game continues
  const el = document.getElementById("current-attempt");
  if (el) el.textContent = this.currentAttempt;
}

  updateAttemptDots() {
    const dots = document.querySelectorAll(".attempt-dot");
    if (dots[this.currentAttempt - 1]) dots[this.currentAttempt - 1].className = "attempt-dot used";
    if (dots[this.currentAttempt] && this.currentAttempt < 6) dots[this.currentAttempt].className = "attempt-dot current";
  }

  // ------------------ Chart ------------------
showMainChart() {
  const wrap = document.querySelector(".chart-container");
  if (!wrap) return;

  const perf = this.dailyStock?.performance_5y ?? 0;
  const perfText = `${perf >= 0 ? "+" : ""}${perf}%`;

  const cssH = getComputedStyle(document.documentElement).getPropertyValue("--chart-height").trim();
  const chartHeight = parseInt(cssH, 10) || 380;

  wrap.innerHTML = `
    <div style="width:100%;">
      <div style="text-align:center; margin-bottom:10px;">
        <div style="color:var(--primary-green); font-weight:600; font-size:1.05rem;">
          ${perfText} <em style="color:var(--text-gray); font-weight:normal;">Siste 5 år</em>
        </div>
      </div>

      <div class="chart-stage" style="height:${chartHeight}px; position:relative; border-radius:12px; overflow:hidden; width:100%;">
        <svg id="main-stock-chart"
             viewBox="0 0 800 ${chartHeight}"
             preserveAspectRatio="none"
             style="display:block; width:100%; height:100%;">
          <defs>
            <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:#22c55e;stop-opacity:0.3"/>
              <stop offset="100%" style="stop-color:#22c55e;stop-opacity:0.5"/>
            </linearGradient>
          </defs>
        </svg>

        <div style="position:absolute; right:12px; top:10px; font-size:12px; color:var(--primary-green);
                    font-weight:600; background:rgba(34,197,94,0.08); padding:3px 6px; border-radius:4px;">
          ${this.dailyStock.current_price} NOK
        </div>
      </div>

      <div class="chart-meta" style="display:flex; justify-content:center; flex-wrap:wrap; gap:32px; margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color);">
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">Markedsverdi</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${this.dailyStock.market_cap}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">Ansatte</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${(this.dailyStock.employees||0).toLocaleString("no-NO")}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:12px; color:var(--text-gray);">52-ukers område</div>
          <div style="font-size:15px; color:var(--primary-green); font-weight:600;">${this.dailyStock.price_52w_low}–${this.dailyStock.price_52w_high} NOK</div>
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
  const niceNumbers = [1, 2, 5, 10]; // Base nice numbers
  
  // Try different combinations of nice numbers and powers of 10
  for (const base of niceNumbers) {
    for (let power = -2; power <= 6; power++) {
      const interval = base * Math.pow(10, power);
      
      // Skip intervals that are too small or too large
      if (interval < 0.01 || interval > maxPrice * 2) continue;
      
      const yMax = Math.ceil(maxPrice / interval) * interval;
      const actualTicks = Math.round(yMax / interval) + 1; // +1 for zero
      
      // Skip if we get too many ticks (would be crowded)
      if (actualTicks > 15) continue;
      
      // Score this configuration using Wilkinson's criteria
      const simplicityScore = 1 - (niceNumbers.indexOf(base) / niceNumbers.length);
      const coverageScore = 1 - Math.abs(yMax - maxPrice) / Math.max(maxPrice, 1);
      const densityScore = 1 - Math.abs(actualTicks - targetTicks) / targetTicks;
      
      // Prefer intervals that don't overshoot too much
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
  
  // Return the best scoring configuration
  scores.sort((a, b) => b.score - a.score);
  
  if (scores.length === 0) {
    // Fallback if no good configuration found
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

    // Get container dimensions instead of SVG dimensions
    const container = svg.parentElement;
    const containerRect = container.getBoundingClientRect();
    
    // Use container width and ensure minimum dimensions
    let width = Math.max(300, containerRect.width || 0);
    let height = Math.max(150, containerRect.height || 0);
    
    // If still no dimensions, try alternative methods
    if (!width || !height) {
      const computedStyle = getComputedStyle(container);
      width = parseInt(computedStyle.width) || 300;
      height = parseInt(computedStyle.height) || 200;
    }

    if (!width || !height) {
      requestAnimationFrame(() => this.drawChartLine());
      return;
    }

    // Dynamic padding based on screen size
    const isMobile = width < 640;
    const padX = isMobile ? Math.max(40, width * 0.08) : 55; // 8% of width on mobile, min 40px
    const padY = 35;

    // Update SVG viewBox to match actual dimensions
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Clear existing elements
    [...svg.querySelectorAll("polyline,polygon,circle,text,line")].forEach(n => n.remove());

    const prices = data.map(d => d.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    // Use Wilkinson's algorithm for optimal Y-axis ticks
    const padding = maxPrice * 0.05;
    const adjustedMaxPrice = maxPrice + padding;
    
    const availableHeight = height - (2 * padY);
    const idealTickSpacing = isMobile ? 25 : 30; // Tighter spacing on mobile
    const maxPossibleTicks = Math.floor(availableHeight / idealTickSpacing);
    const targetTicks = Math.min(maxPossibleTicks, isMobile ? 8 : 10);
    
    const tickConfig = this.calculateOptimalYAxisTicks(adjustedMaxPrice, targetTicks);
    const { interval, yAxisMinFinal, yAxisMaxFinal, numSteps } = tickConfig;
    
    console.log(`📊 Chart: ${width}x${height}, padX: ${padX}, Y-axis: 0 to ${yAxisMaxFinal} NOK`);

    // Coordinate functions
    const x = i => padX + (i / (data.length - 1)) * (width - 2 * padX);
    const y = p => height - padY - ((p - yAxisMinFinal) / (yAxisMaxFinal - yAxisMinFinal)) * (height - 2 * padY);

    // Generate chart coordinates
    const pts = data.map((p, i) => `${x(i)},${y(p.price)}`).join(" ");
    const areaPts = `${x(0)},${height - padY} ${pts} ${x(data.length - 1)},${height - padY}`;

    // Draw Y-axis grid lines and labels
    for (let i = 0; i <= numSteps; i++) {
      const priceLevel = yAxisMinFinal + (i * interval);
      const yPos = y(priceLevel);
      
      // Price label with responsive font size
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", padX - 8);
      label.setAttribute("y", yPos + 4);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("font-size", isMobile ? "10" : "11");
      label.setAttribute("fill", "#94a3b8");
      label.setAttribute("font-weight", "500");
      
      // Format the label
      if (interval >= 1) {
        label.textContent = Math.round(priceLevel) + (isMobile ? "" : " NOK");
      } else {
        label.textContent = priceLevel.toFixed(2) + (isMobile ? "" : " NOK");
      }
      
      svg.appendChild(label);
      
      // Horizontal grid line
      const gridLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      gridLine.setAttribute("x1", padX);
      gridLine.setAttribute("y1", yPos);
      gridLine.setAttribute("x2", width - padX);
      gridLine.setAttribute("y2", yPos);
      gridLine.setAttribute("stroke", "rgba(255,255,255,0.15)");
      gridLine.setAttribute("stroke-width", "0.5");
      
      svg.appendChild(gridLine);
    }

    // Draw X-axis labels (years)
    const now = new Date();
    const yearPositions = [];
    
    // Fewer year labels on mobile
    if (isMobile) {
      // Show only 2020, 2022, I dag on mobile
      yearPositions.push(
        { label: "2020", x: padX + 0 * (width - 2 * padX) },
        { label: "2022", x: padX + 0.5 * (width - 2 * padX) },
        { label: "I dag", x: width - padX }
      );
    } else {
      // Full year labels on desktop
      for (let i = 5; i >= 1; i--) {
        const yearDate = new Date(now);
        yearDate.setFullYear(now.getFullYear() - i);
        const position = (5 - i) / 5;
        yearPositions.push({
          label: yearDate.getFullYear().toString(),
          x: padX + position * (width - 2 * padX)
        });
      }
      yearPositions.push({
        label: "I dag",
        x: width - padX
      });
    }

    yearPositions.forEach(pos => {
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

    // Draw chart area (gradient fill)
    const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    area.setAttribute("fill", "url(#chartGradient)");
    area.setAttribute("points", areaPts);
    svg.appendChild(area);

    // Draw chart line
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#22c55e");
    line.setAttribute("stroke-width", isMobile ? "2.2" : "2.6");
    line.setAttribute("points", pts);
    line.style.filter = "drop-shadow(0 0 2px rgba(34,197,94,0.28))";
    svg.appendChild(line);

    // Draw current price dot
    const last = data[data.length - 1];
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", x(data.length - 1));
    dot.setAttribute("cy", y(last.price));
    dot.setAttribute("r", isMobile ? "3.5" : "4.2");
    dot.setAttribute("fill", "#22c55e");
    svg.appendChild(dot);
}

  buildYearAxisLabels() {
    const now = new Date();
    const labels = [];
    for (let i = 5; i >= 1; i--) {
      const y = new Date(now); y.setFullYear(now.getFullYear() - i);
      labels.push(`<span>${y.getFullYear()}</span>`);
    }
    labels.push("<span>I dag</span>");
    return labels.join("");
  }

  // ------------------ Clues ------------------
  generateClueCards() {
    const s = this.dailyStock;
    this.clueTypes = [
      { id: "sector",      title: "Sektor",              unlock: 1, getValue: () => s?.sector || "Ikke tilgjengelig" },
      { id: "employees",   title: "Ansatte",             unlock: 2, getValue: () => (s?.employees ? `${s.employees.toLocaleString("no-NO")} ansatte` : "Ikke tilgjengelig") },
      { id: "price-range", title: "52-ukers prisområde", unlock: 3, getValue: () => (s?.price_52w_low != null && s?.price_52w_high != null ? `${s.price_52w_low} - ${s.price_52w_high} NOK` : "Ikke tilgjengelig") },
      { id: "location",    title: "Hovedkontor",         unlock: 4, getValue: () => s?.headquarters || "Norge" },
      { id: "industry",    title: "Bransje",             unlock: 5, getValue: () => s?.industry || "Ikke tilgjengelig" },
      { id: "description", title: "Hovedvirksomhet", unlock: 6, getValue: () => this.getShortDescription(s?.ticker, s?.description) }
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
          <div class="clue-icon">${c.icon}</div>
          <div class="clue-title">${c.title}</div>
        </div>
        <div class="clue-content">
          <div class="clue-value" id="clue-${c.id}-value">
            ${c.unlock === 1 ? c.getValue() : `🔒 Lås opp etter ${c.unlock - 1} feil gjetning${c.unlock > 2 ? "er" : ""}`}
          </div>
        </div>`;
      host.appendChild(card);
    });
    this.updateHintBar();
  }

async loadShortDescriptions() {
  try {
    const res = await fetch(`data/oslo_companies_short.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading oslo_companies_short.json`);
    const data = await res.json();
    
    // Create lookup map by ticker for fast access
    this.shortDescriptions = {};
    data.forEach(company => {
      if (company.ticker && company.original_description) {
        // Store both with and without .OL suffix for flexibility
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

// Get short description with fallback
getShortDescription(ticker, fallbackDescription) {
  if (!this.shortDescriptions) return fallbackDescription || "Norsk børsnotert selskap";
  
  // Try exact match first
  if (this.shortDescriptions[ticker]) {
    return this.shortDescriptions[ticker];
  }
  
  // Try without .OL suffix
  const baseTicker = ticker.replace('.OL', '');
  if (this.shortDescriptions[baseTicker]) {
    return this.shortDescriptions[baseTicker];
  }
  
  // Try with .OL suffix if not present
  if (!ticker.includes('.OL') && this.shortDescriptions[ticker + '.OL']) {
    return this.shortDescriptions[ticker + '.OL'];
  }
  
  // Fallback to original or default
  return fallbackDescription || "Norsk børsnotert selskap";
}

unlockClues() {
  this.clueTypes.forEach(c => {
    if (c.unlock <= this.currentAttempt) {
      const card = document.getElementById(`clue-${c.id}`);
      const val  = document.getElementById(`clue-${c.id}-value`);
      if (card && val) {
        card.classList.remove("locked");
        card.classList.add("revealed");
        val.textContent = c.getValue();
      }
    }
  });
  
  // ADD THIS LINE to update the hint bar when clues are unlocked
  this.updateHintBar();
}
  unlockAllClues() {
  this.clueTypes.forEach(c => {
    const card = document.getElementById(`clue-${c.id}`);
    const val  = document.getElementById(`clue-${c.id}-value`);
    if (card && val) {
      card.classList.remove("locked");
      card.classList.add("revealed");
      val.textContent = c.getValue();
    }
  });
  
  // Force update hint bar to show all clues as unlocked
  this.updateHintBar();
}

  // ------------------ End game & Stats ------------------
  endGame(won, attempts) {
    this.gameEnded = true;
    this.updateStats(won, attempts);
    this.revealCompanyName(); // Add this line
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
    const title   = document.getElementById("modal-title");
    const content = document.getElementById("modal-content");
    const name    = document.getElementById("company-name");
    const overlay = document.getElementById("modal-overlay");

    if (title)   title.textContent = won ? "Gratulerer! 🎉" : "Bra forsøk! 😊";
    if (content) content.textContent = won
      ? (attempts === 1 ? "Fantastisk! Du gjettet riktig på første forsøk!" : `Flott! Du gjettet riktig på ${attempts} forsøk!`)
      : `Det var ${this.dailyStock.company_name}. Prøv igjen i morgen!`;
    if (name)    name.textContent  = this.dailyStock.company_name;

    this.updateCompanyDetails();
    this.updateStatsDisplay();
    if (overlay) overlay.style.display = "flex";
  }

  updateCompanyDetails() {
    const box = document.querySelector(".company-details");
    if (!box) return;
    box.innerHTML = `
      <div class="detail-item"><span class="detail-label">Ticker:</span><span class="detail-value">${this.dailyStock.ticker}</span></div>
      <div class="detail-item"><span class="detail-label">Sektor:</span><span class="detail-value">${this.dailyStock.sector || "N/A"}</span></div>
      <div class="detail-item"><span class="detail-label">Markedsverdi:</span><span class="detail-value">${this.dailyStock.market_cap || "N/A"}</span></div>
      <div class="detail-item"><span class="detail-label">Ansatte:</span><span class="detail-value">${(this.dailyStock.employees || 0).toLocaleString("no-NO")}</span></div>
    `;
  }

  updateStatsDisplay() {
    const winPct = this.gameStats.played ? Math.round((this.gameStats.won / this.gameStats.played) * 100) : 0;
    const nodes = {
      played:     document.querySelector(".stats-grid .stat-item:nth-child(1) .stat-value"),
      winPercent: document.querySelector(".stats-grid .stat-item:nth-child(2) .stat-value"),
      streak:     document.querySelector(".stats-grid .stat-item:nth-child(3) .stat-value"),
      avgGuesses: document.querySelector(".stats-grid .stat-item:nth-child(4) .stat-value"),
    };
    if (nodes.played)     nodes.played.textContent     = this.gameStats.played;
    if (nodes.winPercent) nodes.winPercent.textContent = `${winPct}%`;
    if (nodes.streak)     nodes.streak.textContent     = this.gameStats.streak;
    if (nodes.avgGuesses) nodes.avgGuesses.textContent = this.gameStats.avgAttempts || "0";
  }

  // ------------------ Utils ------------------
  updateDayNumber() {
    const el = document.getElementById("daily-number");
    if (el) el.textContent = this.getDayNumber();
  }
  getDayNumber() {
    const today = new Date();
    const start = new Date("2025-09-23T00:00:00");
    start.setHours(0,0,0,0);
    return Math.floor((today - start) / 86400000) + 1;
  }

  setGuessButtonState(loading) {
    const btn = document.getElementById("guess-btn");
    const text = document.getElementById("guess-btn-text");
    const spin = document.getElementById("guess-loading");
    if (loading) {
      if (text) text.textContent = "Gjetter…";
      if (spin) spin.style.display = "inline-block";
      if (btn)  btn.disabled = true;
    } else {
      if (text) text.textContent = "Gjett";
      if (spin) spin.style.display = "none";
      if (btn)  btn.disabled = false;
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
    } catch { alert(message); }
  }

  shareResults() {
    const won = this.gameEnded && !!document.getElementById("modal-overlay")?.style?.display;
    const attempts = this.currentAttempt - (won ? 1 : 0);
    let squares = "";
    for (let i = 1; i <= 6; i++) squares += (won && i === attempts) ? "🟢" : (i < this.currentAttempt ? "🟡" : "⬛");
    const text = `Finansle ${this.getDayNumber()}\n${won ? `${attempts}/6` : "X/6"}\n\n${squares}\n\nSpill på: ${window.location.href}`;
    if (navigator.share) navigator.share({ title: "Finansle", text }).catch(() => navigator.clipboard?.writeText(text));
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => this.showError("Resultat kopiert til utklippstavlen!"));
    else {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      this.showError("Resultat kopiert!");
    }
  }

  loadStats() {
    const def = { played: 0, won: 0, streak: 0, maxStreak: 0, avgAttempts: 0 };
    try { const saved = localStorage.getItem("finansle-stats"); return saved ? { ...def, ...JSON.parse(saved) } : def; }
    catch { return def; }
  }
  saveStats() { try { localStorage.setItem("finansle-stats", JSON.stringify(this.gameStats)); } catch {} }
  updateStats(won, attempts) {
    this.gameStats.played++;
    if (won) {
      this.gameStats.won++; this.gameStats.streak++;
      this.gameStats.maxStreak = Math.max(this.gameStats.maxStreak, this.gameStats.streak);
      const total = this.gameStats.avgAttempts * (this.gameStats.won - 1) + attempts;
      this.gameStats.avgAttempts = +(total / this.gameStats.won).toFixed(1);
    } else { this.gameStats.streak = 0; }
    this.saveStats();
  }
}

// Global feedback function - works even before game starts
// Open feedback modal
function openFeedback() {
  const modal = document.getElementById('feedback-modal');
  const getDayNumber = () => {
    const today = new Date();
    const start = new Date("2025-09-23T00:00:00");
    start.setHours(0,0,0,0);
    return Math.floor((today - start) / 86400000) + 1;
  };

  // Pre-fill hidden fields
  document.getElementById('feedback-day').value = getDayNumber();
  document.getElementById('feedback-url').value = window.location.href;
  
  modal.style.display = 'flex';
}

// Close feedback modal
function closeFeedbackModal() {
  document.getElementById('feedback-modal').style.display = 'none';
}

// Handle form submission feedback
document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('feedback-form');
  if (form) {
    form.addEventListener('submit', function(e) {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Sender...';
      submitBtn.disabled = true;
    });
  }
});

// ... your existing FinansleGame class code ...

// ADD THIS AT THE BOTTOM OF finansle-backend.js:

// Handle form submission with AJAX
document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('feedback-form');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault(); // Prevent normal form submission
      
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
          // Success - just close modal and reset form
          closeFeedbackModal();
          form.reset();
          // Removed the success message line
        } else {
          throw new Error('Network response was not ok');
        }
      } catch (error) {
        console.error('Error:', error);
        // Only show error messages
        showErrorMessage('Noe gikk galt. Prøv igjen senere.');
      } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
  }
});

function showErrorMessage(message) {
  if (window.finansleGame && window.finansleGame.showError) {
    window.finansleGame.showError(message);
  } else {
    alert(message);
  }
}

function showSuccessMessage(message) {
  // Use your existing error function for success message
  if (window.finansleGame && window.finansleGame.showError) {
    window.finansleGame.showError(message);
  } else {
    alert(message);
  }
}

// Open feedback modal
function openFeedback() {
  const modal = document.getElementById('feedback-modal');
  const getDayNumber = () => {
    const today = new Date();
    const start = new Date("2025-09-23T00:00:00");
    start.setHours(0,0,0,0);
    return Math.floor((today - start) / 86400000) + 1;
  };

  // Pre-fill hidden fields
  document.getElementById('feedback-day').value = getDayNumber();
  document.getElementById('feedback-url').value = window.location.href;
  
  modal.style.display = 'flex';
}

// Close feedback modal
function closeFeedbackModal() {
  document.getElementById('feedback-modal').style.display = 'none';
}

document.addEventListener("DOMContentLoaded", () => new FinansleGame());
window.addEventListener("error", (e) => console.error("❌ Global JS error:", e.message, "at", e.filename, ":", e.lineno));