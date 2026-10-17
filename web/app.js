"use strict";

/**
 * RoV Pro Draft Intelligence Client Application
 * Production-grade MOBA Draft Stage Engine with Sequential 18-Step Pro Tournament Rules
 */

// Canonical 18 Pro Tournament Draft Steps:
// action: "ban" | "pick", side: "blue" | "red", phase: 1 | 2
const CANONICAL_STEPS = [
  { step: 0, phase: 1, action: "ban", side: "blue", label: "BLUE BAN 1" },
  { step: 1, phase: 1, action: "ban", side: "red", label: "RED BAN 1" },
  { step: 2, phase: 1, action: "ban", side: "blue", label: "BLUE BAN 2" },
  { step: 3, phase: 1, action: "ban", side: "red", label: "RED BAN 2" },
  { step: 4, phase: 1, action: "pick", side: "blue", label: "BLUE PICK 1" },
  { step: 5, phase: 1, action: "pick", side: "red", label: "RED PICK 1" },
  { step: 6, phase: 1, action: "pick", side: "red", label: "RED PICK 2" },
  { step: 7, phase: 1, action: "pick", side: "blue", label: "BLUE PICK 2" },
  { step: 8, phase: 1, action: "pick", side: "blue", label: "BLUE PICK 3" },
  { step: 9, phase: 1, action: "pick", side: "red", label: "RED PICK 3" },
  { step: 10, phase: 2, action: "ban", side: "red", label: "RED BAN 3" },
  { step: 11, phase: 2, action: "ban", side: "blue", label: "BLUE BAN 3" },
  { step: 12, phase: 2, action: "ban", side: "red", label: "RED BAN 4" },
  { step: 13, phase: 2, action: "ban", side: "blue", label: "BLUE BAN 4" },
  { step: 14, phase: 2, action: "pick", side: "red", label: "RED PICK 4" },
  { step: 15, phase: 2, action: "pick", side: "blue", label: "BLUE PICK 4" },
  { step: 16, phase: 2, action: "pick", side: "blue", label: "BLUE PICK 5" },
  { step: 17, phase: 2, action: "pick", side: "red", label: "RED PICK 5" },
];

class DraftApp {
  constructor() {
    this.heroes = [];
    this.heroMap = new Map();
    this.images = {};

    // Draft State
    this.stepIndex = 0; // 0 to 18 (18 = finished)
    this.bluePicks = [];
    this.redPicks = [];
    this.blueBans = [];
    this.redBans = [];
    this.globalBans = [];

    // History stack for Undo
    this.history = [];

    // Filters & UI State
    this.selectedRole = "all";
    this.searchQuery = "";
    this.isLookaheadEnabled = false;
    this.manualSlotTarget = null; // optional manual slot override

    // Cache DOM Elements
    this.$turnLabel = document.getElementById("current-turn-label");
    this.$blueWin = document.getElementById("blue-win-val");
    this.$redWin = document.getElementById("red-win-val");
    this.$meterBlue = document.getElementById("meter-bar-blue");
    this.$meterRed = document.getElementById("meter-bar-red");
    this.$recsContainer = document.getElementById("recs-container");
    this.$missingLanes = document.getElementById("missing-lanes-box");
    this.$heroGrid = document.getElementById("hero-pool-grid");
    this.$searchInput = document.getElementById("hero-search");
    this.$roleTabs = document.getElementById("role-tabs");
    this.$lookaheadToggle = document.getElementById("lookahead-toggle");
    this.$btnUndo = document.getElementById("btn-undo");
    this.$btnReset = document.getElementById("btn-reset");
  }

  async init() {
    this.bindEvents();
    await this.loadData();
    this.updateUI();
    this.fetchRecommendations();
  }

  bindEvents() {
    this.$searchInput.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderHeroGrid();
    });

    this.$roleTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".role-tab");
      if (!btn) return;
      this.$roleTabs.querySelectorAll(".role-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      this.selectedRole = btn.dataset.role;
      this.renderHeroGrid();
    });

    this.$lookaheadToggle.addEventListener("change", (e) => {
      this.isLookaheadEnabled = e.target.checked;
      this.fetchRecommendations();
    });

    this.$btnUndo.addEventListener("click", () => this.undo());
    this.$btnReset.addEventListener("click", () => this.reset());

    // Slot clicks to allow manual inspection or removal
    document.querySelectorAll(".pick-slot, .ban-slot").forEach((slot) => {
      slot.addEventListener("click", () => {
        const slotType = slot.dataset.slot;
        const idx = parseInt(slot.dataset.idx, 10);
        this.handleSlotClick(slotType, idx);
      });
    });
  }

  async loadData() {
    try {
      const [heroesRes, imagesRes] = await Promise.all([
        fetch("/heroes").then((r) => r.json()),
        fetch("/hero_images.json").then((r) => (r.ok ? r.json() : {})),
      ]);

      this.images = imagesRes || {};
      this.heroes = heroesRes.hero_details || [];

      // Sort alphabetically
      this.heroes.sort((a, b) => a.name.localeCompare(b.name));

      this.heroes.forEach((h) => {
        if (!h.image_url && this.images[h.name]) {
          h.image_url = this.images[h.name];
        }
        this.heroMap.set(h.name, h);
      });
    } catch (err) {
      console.error("Failed to load initial hero data:", err);
    }
  }

  getCurrentStep() {
    if (this.stepIndex >= CANONICAL_STEPS.length) return null;
    return CANONICAL_STEPS[this.stepIndex];
  }

  getAllUsedHeroes() {
    return new Set([
      ...this.bluePicks,
      ...this.redPicks,
      ...this.blueBans,
      ...this.redBans,
      ...this.globalBans,
    ]);
  }

  handleHeroSelect(heroName) {
    const used = this.getAllUsedHeroes();
    if (used.has(heroName)) return;

    const step = this.getCurrentStep();
    if (!step) return; // draft is finished

    // Save history for undo
    this.history.push({
      stepIndex: this.stepIndex,
      bluePicks: [...this.bluePicks],
      redPicks: [...this.redPicks],
      blueBans: [...this.blueBans],
      redBans: [...this.redBans],
    });

    // Apply selection
    if (step.side === "blue") {
      if (step.action === "ban") this.blueBans.push(heroName);
      else this.bluePicks.push(heroName);
    } else {
      if (step.action === "ban") this.redBans.push(heroName);
      else this.redPicks.push(heroName);
    }

    this.stepIndex += 1;
    this.updateUI();
    this.fetchRecommendations();
  }

  handleSlotClick(slotType, idx) {
    // If slot is filled, allow removing it
    let targetArr = null;
    if (slotType === "blue_picks") targetArr = this.bluePicks;
    else if (slotType === "red_picks") targetArr = this.redPicks;
    else if (slotType === "blue_bans") targetArr = this.blueBans;
    else if (slotType === "red_bans") targetArr = this.redBans;

    if (targetArr && idx < targetArr.length) {
      const removedHero = targetArr[idx];
      targetArr.splice(idx, 1);
      if (this.stepIndex > 0) this.stepIndex -= 1;
      this.updateUI();
      this.fetchRecommendations();
    }
  }

  undo() {
    if (this.history.length === 0) return;
    const prev = this.history.pop();
    this.stepIndex = prev.stepIndex;
    this.bluePicks = prev.bluePicks;
    this.redPicks = prev.redPicks;
    this.blueBans = prev.blueBans;
    this.redBans = prev.redBans;

    this.updateUI();
    this.fetchRecommendations();
  }

  reset() {
    this.history = [];
    this.stepIndex = 0;
    this.bluePicks = [];
    this.redPicks = [];
    this.blueBans = [];
    this.redBans = [];
    this.globalBans = [];

    this.updateUI();
    this.fetchRecommendations();
  }

  updateUI() {
    this.renderTurnHeader();
    this.renderSlots();
    this.renderHeroGrid();
  }

  renderTurnHeader() {
    const step = this.getCurrentStep();
    if (!step) {
      this.$turnLabel.textContent = "🏆 DRAFT COMPLETED (พร้อมเข้าสู่เกม)";
      return;
    }

    const actionText = step.action === "ban" ? "BAN" : "PICK";
    const sideText = step.side === "blue" ? "BLUE TEAM" : "RED TEAM";
    const phaseText = `PHASE ${step.phase}`;

    document.querySelector(".turn-phase").textContent = phaseText;
    this.$turnLabel.textContent = `TURN ${step.step + 1}/18 • ${sideText} ${actionText}`;

    // Highlight active flank
    const panelBlue = document.getElementById("panel-blue");
    const panelRed = document.getElementById("panel-red");
    if (step.side === "blue") {
      panelBlue.style.boxShadow = "0 0 0 2px var(--blue-team)";
      panelRed.style.boxShadow = "none";
    } else {
      panelRed.style.boxShadow = "0 0 0 2px var(--red-team)";
      panelBlue.style.boxShadow = "none";
    }
  }

  renderSlots() {
    const used = this.getAllUsedHeroes();

    // Render Blue Bans
    document.querySelectorAll('#blue-bans-slots .ban-slot').forEach((slot, i) => {
      const hero = this.blueBans[i];
      this.populateSlot(slot, hero);
    });

    // Render Red Bans
    document.querySelectorAll('#red-bans-slots .ban-slot').forEach((slot, i) => {
      const hero = this.redBans[i];
      this.populateSlot(slot, hero);
    });

    // Render Blue Picks
    document.querySelectorAll('#blue-picks-list .pick-slot').forEach((slot, i) => {
      const hero = this.bluePicks[i];
      this.populatePickSlot(slot, hero);
    });

    // Render Red Picks
    document.querySelectorAll('#red-picks-list .pick-slot').forEach((slot, i) => {
      const hero = this.redPicks[i];
      this.populatePickSlot(slot, hero);
    });
  }

  populateSlot(el, heroName) {
    el.innerHTML = "";
    if (heroName) {
      el.classList.add("filled");
      const img = document.createElement("img");
      img.src = this.getHeroImage(heroName);
      img.alt = heroName;
      el.appendChild(img);
    } else {
      el.classList.remove("filled");
    }
  }

  populatePickSlot(el, heroName) {
    const preview = el.querySelector(".hero-preview");
    if (!preview) return;

    if (heroName) {
      preview.className = "hero-preview";
      preview.innerHTML = `
        <span class="hero-name">${heroName}</span>
        <img class="hero-thumb" src="${this.getHeroImage(heroName)}" alt="${heroName}" />
      `;
    } else {
      preview.className = "hero-preview empty";
      preview.textContent = "ว่าง (แตะเลือก)";
    }
  }

  getHeroImage(name) {
    const hero = this.heroMap.get(name);
    if (hero && hero.image_url) return hero.image_url;
    if (this.images[name]) return this.images[name];
    const initials = (name || "??").slice(0, 2).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1e293b"/><text x="50" y="58" fill="#ffffff" font-size="32" font-family="sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  renderHeroGrid() {
    const used = this.getAllUsedHeroes();
    this.$heroGrid.innerHTML = "";

    const filtered = this.heroes.filter((h) => {
      const matchSearch = h.name.toLowerCase().includes(this.searchQuery);
      let matchRole = true;
      if (this.selectedRole !== "all") {
        matchRole = h.role === this.selectedRole || (this.selectedRole === "Support" && h.role === "Tank");
      }
      return matchSearch && matchRole;
    });

    const frag = document.createDocumentFragment();
    filtered.forEach((hero) => {
      const isUsed = used.has(hero.name);
      const item = document.createElement("div");
      item.className = `pool-hero-item ${isUsed ? "disabled" : ""}`;
      item.title = `${hero.name} (${hero.role} - ${hero.lane})`;

      const tierClass = hero.tier === "S+" ? "tier-s-plus" : hero.tier === "S" ? "tier-s" : "";
      item.innerHTML = `
        <span class="tier-badge ${tierClass}">${hero.tier}</span>
        <img class="pool-hero-thumb" src="${this.getHeroImage(hero.name)}" alt="${hero.name}" loading="lazy" />
        <span class="pool-hero-name">${hero.name}</span>
      `;

      if (!isUsed) {
        item.addEventListener("click", () => this.handleHeroSelect(hero.name));
      }
      frag.appendChild(item);
    });

    this.$heroGrid.appendChild(frag);
  }

  async fetchRecommendations() {
    const step = this.getCurrentStep();
    if (!step) {
      this.$recsContainer.innerHTML = `<div class="rec-loading">การดราฟต์สิ้นสุดแล้วครบทั้ง 18 ขั้นตอน</div>`;
      this.updateWinMeter(this.lastWinRate || 50.0);
      return;
    }

    const payload = {
      mode: step.action,
      side: step.side,
      phase: step.phase,
      ally_picks: step.side === "blue" ? this.bluePicks : this.redPicks,
      enemy_picks: step.side === "blue" ? this.redPicks : this.bluePicks,
      ally_bans: step.side === "blue" ? this.blueBans : this.redBans,
      enemy_bans: step.side === "blue" ? this.redBans : this.blueBans,
      global_bans: this.globalBans,
      top_k: 5,
      use_lookahead: this.isLookaheadEnabled,
    };

    try {
      const res = await fetch("/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }

      const data = await res.json();
      this.renderRecommendations(data, step);
    } catch (err) {
      console.error("Prediction fetch failed:", err);
      this.$recsContainer.innerHTML = `<div class="rec-loading" style="color: var(--error);">เกิดข้อผิดพลาดในการคำนวณโมเดล AI</div>`;
    }
  }

  renderRecommendations(data, currentStep) {
    const recs = data.recommendations || [];
    if (recs.length === 0) {
      this.$recsContainer.innerHTML = `<div class="rec-loading">ไม่มีคำแนะนำสำหรับสถานการณ์นี้</div>`;
      return;
    }

    // Update Win Rate Meter using Top-1 predicted win rate
    const topRec = recs[0];
    const topWinRate = topRec.lookahead_win_rate_pct ?? topRec.predicted_win_rate_pct;
    const blueWinRate = currentStep.side === "blue" ? topWinRate : 100.0 - topWinRate;
    this.updateWinMeter(blueWinRate);

    // Render Missing Lanes Alert
    if (data.missing_ally_lanes && data.missing_ally_lanes.length > 0) {
      this.$missingLanes.style.display = "block";
      this.$missingLanes.innerHTML = `⚠️ <strong>เลนที่ทีมยังขาด:</strong> ${data.missing_ally_lanes.join(", ")}`;
    } else {
      this.$missingLanes.style.display = "none";
    }

    // Render Top 3 Cards
    this.$recsContainer.innerHTML = "";
    recs.slice(0, 3).forEach((rec, i) => {
      const isPrimary = i === 0;
      const card = document.createElement("div");
      card.className = `rec-card ${isPrimary ? "primary-rec" : ""}`;

      const winRate = rec.lookahead_win_rate_pct ?? rec.predicted_win_rate_pct;
      const synClass = rec.synergy_edge_pct >= 0 ? "positive" : "negative";
      const cntClass = rec.counter_edge_pct >= 0 ? "positive" : "negative";

      card.innerHTML = `
        <div class="rec-top-row">
          <img class="rec-avatar" src="${this.getHeroImage(rec.hero_name)}" alt="${rec.hero_name}" />
          <div class="rec-meta">
            <div class="rec-rank-hero">
              <span class="rec-rank">#${rec.rank}</span>
              <span class="rec-hero-name">${rec.hero_name}</span>
            </div>
            <span class="rec-lane-badge">${rec.primary_lane} • ${rec.primary_role}</span>
          </div>
        </div>

        <div class="rec-stats-row">
          <div class="stat-item">
            <span class="stat-lbl">โอกาสเลือก</span>
            <span class="stat-val">${rec.probability_pct.toFixed(1)}%</span>
          </div>
          <div class="stat-item">
            <span class="stat-lbl">อัตราการชนะ</span>
            <span class="stat-val ${winRate >= 50 ? 'positive' : ''}">${winRate.toFixed(1)}%</span>
          </div>
          <div class="stat-item">
            <span class="stat-lbl">ซินเนอร์จี้</span>
            <span class="stat-val ${synClass}">${rec.synergy_edge_pct > 0 ? '+' : ''}${rec.synergy_edge_pct.toFixed(1)}%</span>
          </div>
        </div>

        <button class="btn-lockin" type="button">
          ⚡ LOCK IN (เลือกทันที)
        </button>
      `;

      card.querySelector(".btn-lockin").addEventListener("click", () => {
        this.handleHeroSelect(rec.hero_name);
      });

      this.$recsContainer.appendChild(card);
    });
  }

  updateWinMeter(bluePct) {
    const clampedBlue = Math.max(10, Math.min(90, bluePct));
    const redPct = 100.0 - clampedBlue;

    this.$blueWin.textContent = `${clampedBlue.toFixed(1)}%`;
    this.$redWin.textContent = `${redPct.toFixed(1)}%`;

    this.$meterBlue.style.width = `${clampedBlue}%`;
    this.$meterRed.style.width = `${redPct}%`;
  }
}

// Instantiate and initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  const app = new DraftApp();
  app.init();
});
