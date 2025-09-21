// js/finansle-backend.js
class FinansleGame {
  constructor() {
    this.currentAttempt = 1;
    this.gameEnded = false;
    this.gameStats = this.loadStats();

    this.allStocks = [];
    this.dailyStock = null;
    this.clueTypes = [];

    this.init();
  }

  async init() {
    try {
      console.log("🚀 Initializing Finansle…");

      await this.loadDailyJson();
      // Always ensure the full universe is loaded from obx.json
      await this.loadStocksList();

      this.setupEventListeners();

      this.showMainChart();
      this.positionCluesAboveSearch();
      this.generateClueCards();
      this.updateDayNumber();

      console.log("✅ Game initialized");
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
    shareBtn?.addEventListener("click", () => this.shareResults());
    overlay?.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });

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
    options.forEach(s => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      const label = `${s.name} (${s.ticker})`;
      item.textContent = label;
      item.addEventListener("click", () => this.selectStock(s));
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
    if (e.key === "Enter" && guessBtn && !guessBtn.disabled) this.handleGuess();
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

  processGuess(guess) {
    try {
      const g = (this.allStocks || []).find(
        s => s.name?.toLowerCase() === guess.toLowerCase() ||
             s.english_name?.toLowerCase() === guess.toLowerCase() ||
             s.ticker?.toLowerCase() === guess.toLowerCase() ||
             s.tickerOL?.toLowerCase() === guess.toLowerCase()
      );
      if (!g) { this.showError("Aksjen ble ikke funnet. Velg fra listen."); return; }

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

    const el = document.getElementById("current-attempt");
    if (el) el.textContent = this.currentAttempt;

    if (this.currentAttempt > 6) this.endGame(false, 6);
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
      <div class="chart-card" style="width:100%; background:var(--card-bg); border:1px solid var(--border-color); border-radius:14px; padding:16px;">
        <div style="text-align:center; margin-bottom:10px;">
          <div style="color:var(--primary-green); font-weight:600; font-size:1.05rem;">
            ${perfText} <em style="color:var(--text-gray); font-weight:normal;">Siste 5 år</em>
          </div>
        </div>

        <div class="chart-stage" style="height:${chartHeight}px; position:relative; background:rgba(255,255,255,0.02); border-radius:12px; overflow:hidden;">
          <svg id="main-stock-chart"
               viewBox="0 0 1000 ${chartHeight}"
               preserveAspectRatio="none"
               style="display:block; width:100%; height:100%;">
            <defs>
              <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#22c55e;stop-opacity:0.3"/>
                <stop offset="100%" style="stop-color:#22c55e;stop-opacity:0.05"/>
              </linearGradient>
              <pattern id="grid" width="64" height="36" patternUnits="userSpaceOnUse">
                <path d="M 64 0 L 0 0 0 36" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)"/>
          </svg>

          <div style="position:absolute; right:12px; top:10px; font-size:12px; color:var(--primary-green);
                      font-weight:600; background:rgba(34,197,94,0.08); padding:3px 6px; border-radius:4px;">
            ${this.dailyStock.current_price} NOK
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; margin:8px 6px 0;
                    font-size:12px; color:var(--text-gray); font-weight:500;">
          ${this.buildYearAxisLabels()}
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

  drawChartLine() {
    const svg = document.getElementById("main-stock-chart");
    const data = this.dailyStock?.chart_data || [];
    if (!svg || data.length < 2) return;

    const rect = svg.getBoundingClientRect();
    const width  = Math.max(300, rect.width  || 0);
    const height = Math.max(150, rect.height || 0);

    if (!width || !height) {
      requestAnimationFrame(() => this.drawChartLine());
      return;
    }

    const padX = 28, padY = 20;

    const prices = data.map(d => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const yMin = min - (max - min) * 0.1;
    const yMax = max + (max - min) * 0.1;

    const x = i => padX + (i / (data.length - 1)) * (width  - 2 * padX);
    const y = p => height - padY - ((p - yMin) / (yMax - yMin)) * (height - 2 * padY);

    const pts = data.map((p, i) => `${x(i)},${y(p.price)}`).join(" ");
    const areaPts = `${x(0)},${height - padY} ${pts} ${x(data.length - 1)},${height - padY}`;

    [...svg.querySelectorAll("polyline,polygon,circle")].forEach(n => n.remove());

    const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    area.setAttribute("fill", "url(#chartGradient)");
    area.setAttribute("points", areaPts);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#22c55e");
    line.setAttribute("stroke-width", "2.6");
    line.setAttribute("points", pts);
    line.style.filter = "drop-shadow(0 0 2px rgba(34,197,94,0.28))";

    const last = data[data.length - 1];
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", x(data.length - 1));
    dot.setAttribute("cy", y(last.price));
    dot.setAttribute("r", "4.2");
    dot.setAttribute("fill", "#22c55e");

    svg.appendChild(area);
    svg.appendChild(line);
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
      { id: "sector",      icon: "🏭", title: "Sektor",              unlock: 1, getValue: () => s?.sector || "Ikke tilgjengelig" },
      { id: "employees",   icon: "👥", title: "Ansatte",             unlock: 2, getValue: () => (s?.employees ? `${s.employees.toLocaleString("no-NO")} ansatte` : "Ikke tilgjengelig") },
      { id: "price-range", icon: "💵", title: "52-ukers prisområde", unlock: 3, getValue: () => (s?.price_52w_low != null && s?.price_52w_high != null ? `${s.price_52w_low} - ${s.price_52w_high} NOK` : "Ikke tilgjengelig") },
      { id: "location",    icon: "📍", title: "Hovedkontor",         unlock: 4, getValue: () => s?.headquarters || "Norge" },
      { id: "industry",    icon: "⚙️", title: "Bransje",             unlock: 5, getValue: () => s?.industry || "Ikke tilgjengelig" },
      { id: "description", icon: "📝", title: "Virksomhet",          unlock: 6, getValue: () => s?.description || "Norsk børsnotert selskap" },
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
  }

  // ------------------ End game & Stats ------------------
  endGame(won, attempts) {
    this.gameEnded = true;
    this.updateStats(won, attempts);
    this.showEndGameModal(won, attempts);
    this.unlockAllClues();
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
    const start = new Date("2024-01-01T00:00:00");
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

document.addEventListener("DOMContentLoaded", () => new FinansleGame());
window.addEventListener("error", (e) => console.error("❌ Global JS error:", e.message, "at", e.filename, ":", e.lineno));
