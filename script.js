// OBXdle Game Logic
class OBXdleGame {
    constructor() {
        this.gameData = null;
        this.currentAttempt = 1;
        this.maxAttempts = 6;
        this.gameOver = false;
        this.won = false;
        this.revealedClues = 0;
        
        this.initializeGame();
    }

    async initializeGame() {
        try {
            // Load today's stock data
            const response = await fetch('./data/daily.json');
            this.gameData = await response.json();
            
            // Check if already played today
            this.checkGameState();
            
            // Set up UI
            this.setupUI();
            this.setupEventListeners();
            
            // Hide loading, show game
            document.getElementById('loading').style.display = 'none';
            document.getElementById('game-content').style.display = 'block';
            
        } catch (error) {
            console.error('Failed to load game data:', error);
            document.getElementById('loading').innerHTML = 
                '<p>Failed to load today\'s stock. Please try again later.</p>';
        }
    }

    checkGameState() {
        const today = new Date().toDateString();
        const savedGame = localStorage.getItem('obxdle-game');
        
        if (savedGame) {
            const gameState = JSON.parse(savedGame);
            if (gameState.date === today) {
                // Continue existing game
                this.currentAttempt = gameState.attempt;
                this.revealedClues = gameState.revealedClues;
                this.gameOver = gameState.gameOver;
                this.won = gameState.won;
                
                // Restore UI state
                this.restoreGameState(gameState);
            }
        }
    }

    saveGameState() {
        const gameState = {
            date: new Date().toDateString(),
            attempt: this.currentAttempt,
            revealedClues: this.revealedClues,
            gameOver: this.gameOver,
            won: this.won,
            guesses: this.getGuesses()
        };
        
        localStorage.setItem('obxdle-game', JSON.stringify(gameState));
        this.updateStats();
    }

    setupUI() {
        // Set date
        document.getElementById('game-date').textContent = 
            new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });

        // Reveal first clue
        this.revealNextClue();
    }

    setupEventListeners() {
        const input = document.getElementById('stock-input');
        const submitBtn = document.getElementById('submit-guess');
        const suggestionsDiv = document.getElementById('suggestions');

        // Input handling
        input.addEventListener('input', (e) => {
            this.showSuggestions(e.target.value);
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.submitGuess();
            }
        });

        // Submit button
        submitBtn.addEventListener('click', () => {
            this.submitGuess();
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.guess-section')) {
                suggestionsDiv.style.display = 'none';
            }
        });

        // Share button
        document.getElementById('share-button').addEventListener('click', () => {
            this.shareResults();
        });
    }

    showSuggestions(query) {
        if (!query || query.length < 2 || this.gameOver) {
            document.getElementById('suggestions').style.display = 'none';
            return;
        }

        const suggestions = this.gameData.all_stocks.filter(stock => 
            stock.name.toLowerCase().includes(query.toLowerCase()) ||
            stock.symbol.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 8);

        if (suggestions.length === 0) {
            document.getElementById('suggestions').style.display = 'none';
            return;
        }

        const suggestionsHTML = suggestions.map(stock => `
            <div class="suggestion-item" onclick="game.selectStock('${stock.name}', '${stock.symbol}')">
                <span class="suggestion-name">${stock.name}</span>
                <span class="suggestion-symbol">(${stock.symbol})</span>
            </div>
        `).join('');

        const suggestionsDiv = document.getElementById('suggestions');
        suggestionsDiv.innerHTML = suggestionsHTML;
        suggestionsDiv.classList.add('show');
    }

    selectStock(name, symbol) {
        document.getElementById('stock-input').value = name;
        document.getElementById('suggestions').style.display = 'none';
    }

    submitGuess() {
        if (this.gameOver) return;

        const input = document.getElementById('stock-input');
        const guess = input.value.trim();
        
        if (!guess) return;

        // Find the stock
        const stock = this.gameData.all_stocks.find(s => 
            s.name.toLowerCase() === guess.toLowerCase() ||
            s.symbol.toLowerCase() === guess.toLowerCase()
        );

        if (!stock) {
            alert('Please select a valid Norwegian stock from the suggestions.');
            return;
        }

        // Check if correct
        const isCorrect = stock.symbol === this.gameData.stock.symbol;
        
        // Add to guesses
        this.addGuess(stock, isCorrect);
        
        if (isCorrect) {
            this.won = true;
            this.gameOver = true;
            this.showGameOver();
        } else {
            this.currentAttempt++;
            
            if (this.currentAttempt <= this.maxAttempts) {
                this.revealNextClue();
                this.updateAttemptCounter();
            } else {
                this.gameOver = true;
                this.showGameOver();
            }
        }

        // Clear input
        input.value = '';
        document.getElementById('suggestions').style.display = 'none';
        
        // Save game state
        this.saveGameState();
    }

    addGuess(stock, isCorrect) {
        const guessesList = document.getElementById('guesses-list');
        const guessDiv = document.createElement('div');
        guessDiv.className = `guess-item ${isCorrect ? 'correct' : 'incorrect'}`;
        
        guessDiv.innerHTML = `
            <div>
                <span class="guess-number">${this.currentAttempt}.</span>
                ${stock.name} (${stock.symbol})
            </div>
            <div>${isCorrect ? '✅' : '❌'}</div>
        `;
        
        guessesList.appendChild(guessDiv);
    }

    revealNextClue() {
        if (this.revealedClues >= this.gameData.stock.clues.length) return;

        const cluesContainer = document.getElementById('clues-container');
        const clue = this.gameData.stock.clues[this.revealedClues];
        
        const clueDiv = document.createElement('div');
        clueDiv.className = 'clue revealed';
        clueDiv.textContent = clue;
        
        cluesContainer.appendChild(clueDiv);
        this.revealedClues++;
    }

    updateAttemptCounter() {
        document.getElementById('attempt-counter').textContent = 
            `Attempt ${this.currentAttempt}/${this.maxAttempts}`;
    }

    showGameOver() {
        document.getElementById('guess-section').style.display = 'none';
        
        const gameOverDiv = document.getElementById('game-over');
        const resultTitle = document.getElementById('result-title');
        const finalReveal = document.getElementById('final-reveal');
        
        if (this.won) {
            resultTitle.textContent = '🎉 Congratulations!';
            resultTitle.className = 'win';
        } else {
            resultTitle.textContent = '😞 Game Over';
            resultTitle.className = 'lose';
            
            // Reveal all remaining clues
            while (this.revealedClues < this.gameData.stock.clues.length) {
                this.revealNextClue();
            }
        }
        
        // Show company info
        const stock = this.gameData.stock;
        finalReveal.innerHTML = `
            <div class="company-info">
                <h3>${stock.name} (${stock.symbol})</h3>
                <p><strong>Current Price:</strong> ${stock.quote?.c || 'N/A'} NOK</p>
                <p><strong>Industry:</strong> ${stock.profile?.finnhubIndustry || 'N/A'}</p>
                <p><strong>Market Cap:</strong> ${this.formatMarketCap(stock.profile?.marketCapitalization)}</p>
            </div>
        `;
        
        gameOverDiv.style.display = 'block';
        this.showStats();
        this.startCountdown();
    }

    formatMarketCap(marketCap) {
        if (!marketCap) return 'N/A';
        const cap = marketCap * 1000000; // Convert to actual value
        if (cap > 1000000000) {
            return `${(cap / 1000000000).toFixed(1)}B NOK`;
        } else if (cap > 1000000) {
            return `${(cap / 1000000).toFixed(0)}M NOK`;
        }
        return `${cap.toLocaleString()} NOK`;
    }

    getGuesses() {
        const guesses = document.querySelectorAll('.guess-item');
        return Array.from(guesses).map(g => g.textContent);
    }

    restoreGameState(gameState) {
        // Restore clues
        for (let i = 0; i < gameState.revealedClues; i++) {
            this.revealNextClue();
        }
        
        // Restore guesses (simplified - you'd need to save more detail)
        this.updateAttemptCounter();
        
        if (gameState.gameOver) {
            this.showGameOver();
        }
    }

    showStats() {
        const stats = this.getStats();
        const statsDiv = document.getElementById('user-stats');
        
        statsDiv.innerHTML = `
            <div class="stat-item">
                <div class="stat-number">${stats.played}</div>
                <div class="stat-label">Played</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${stats.winPercent}%</div>
                <div class="stat-label">Win Rate</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${stats.currentStreak}</div>
                <div class="stat-label">Current Streak</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${stats.maxStreak}</div>
                <div class="stat-label">Best Streak</div>
            </div>
        `;
    }

    getStats() {
        const saved = localStorage.getItem('obxdle-stats');
        const defaultStats = {
            played: 0,
            won: 0,
            currentStreak: 0,
            maxStreak: 0,
            winPercent: 0
        };
        
        return saved ? JSON.parse(saved) : defaultStats;
    }

    updateStats() {
        const stats = this.getStats();
        
        if (this.gameOver) {
            stats.played++;
            
            if (this.won) {
                stats.won++;
                stats.currentStreak++;
                stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
            } else {
                stats.currentStreak = 0;
            }
            
            stats.winPercent = Math.round((stats.won / stats.played) * 100);
        }
        
        localStorage.setItem('obxdle-stats', JSON.stringify(stats));
    }

    shareResults() {
        const attempts = this.won ? this.currentAttempt : 'X';
        const squares = this.won ? '🟩'.repeat(this.currentAttempt) + '⬜'.repeat(6 - this.currentAttempt) 
                                : '🟥'.repeat(6);
        
        const shareText = `OBXdle ${new Date().toLocaleDateString('en-CA')} ${attempts}/6\n\n${squares}\n\nhttps://yourdomain.github.io/obxdle`;
        
        if (navigator.share) {
            navigator.share({
                text: shareText
            });
        } else {
            navigator.clipboard.writeText(shareText);
            alert('Results copied to clipboard!');
        }
    }

    startCountdown() {
        const countdownElement = document.getElementById('countdown');
        
        const updateCountdown = () => {
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            
            const diff = tomorrow - now;
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            
            countdownElement.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };
        
        updateCountdown();
        setInterval(updateCountdown, 1000);
    }
}

// Initialize game when page loads
let game;
document.addEventListener('DOMContentLoaded', () => {
    game = new OBXdleGame();
});