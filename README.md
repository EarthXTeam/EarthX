<div align="center">

<h1>🌍 EarthX</h1>

<p><b>Be an Earth System Trend Detective</b><br>
Turning NASA Earth observation data into case files — with verdicts.</p>

<p>
<img src="https://img.shields.io/badge/NASA%20Space%20Apps-2026-0B3D91?style=for-the-badge&logo=nasa&logoColor=white" alt="NASA Space Apps 2026">
<img src="https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python">
<img src="https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge" alt="MIT License">
<img src="https://img.shields.io/badge/status-hackathon%20build-F59E0B?style=for-the-badge" alt="Status">
</p>

<p>
<a href="ADD_LIVE_DEMO_LINK_HERE"><b>🔗 Live Demo</b></a>
·
<a href="ADD_VIDEO_LINK_HERE"><b>🎥 Demo Video</b></a>
·
<a href="https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/"><b>📋 The Challenge</b></a>
</p>

<img src="docs/screenshot.png" alt="EarthX trend map" width="800">

</div>

---

## 🕵️ About The Project

Earth is changing, but proving it is harder than it looks. A variable can rise in one region and fall in another while the same process drives both — and a trend that *looks* obvious on a chart often fails a significance test.

EarthX turns that problem into an investigation. You pick what you want to look into and where. EarthX gathers the NASA evidence, runs the statistics, and closes the case with one of three verdicts:

- ✅ **Confirmed** — the trend is statistically significant. The evidence holds up.
- 🕵️ **Case open** — there is a trend, but the record isn't long enough to prove it yet. EarthX estimates **how many more years of data** it would take.
- ❌ **No evidence** — no meaningful trend in this variable, in this place.

That middle verdict is the one we care about most. A trend that misses significance isn't a failure — it's an open case. Telling a user *"come back in 11 years"* is more honest, and far more interesting, than *"not significant."*

## ✨ Features

- **Case-file framing** — every result is a verdict in plain language, never a bare p-value.
- **Years to significance** — for open cases, how much longer the record needs to be.
- **Guided questions** — users answer a short series of questions about what and where they want to investigate, and EarthX selects the relevant variables for them. No prior knowledge of Earth science variable names needed.
- **Plain-language definitions** — every variable explained in a sentence, for students and curious non-specialists.

## 🛰️ The Data

- **Source** — NASA Earth observation data, accessed through [Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/)
- **Variables** — precipitation, evapotranspiration, soil moisture, surface temperature
- **Regions** — Mediterranean Basin, Sahel, Amazon Basin
- **Period** — 1980 to 2024, monthly
- **Grid** — 0.75°

Those three regions were chosen deliberately. The same water-balance variables trend in **different directions** in each one, which is exactly the complication the challenge describes: one process, opposite signs, depending on where you look.

## 🔬 How It Works

1. **Acquire** — monthly gridded data pulled per variable, per region.
2. **Clean** — reshaped to one row per location, per month, per variable. Missing values stay genuinely missing, never `0`, never `-9999`, never `NaN`.
3. **Analyse** — a linear trend per grid cell: slope per decade, p-value, and confidence interval, with significance testing.
4. **Judge** — slope, significance and record length map to one of the three verdicts, plus a years-to-significance estimate for open cases.
5. **Visualise** — a trend map coloured by slope per decade, and a regional case-file chart showing the monthly series with its confidence band.

The frontend never interprets statistics. Every verdict arrives from the analysis layer as both a machine-readable state and a plain-language sentence, so the science and the storytelling can't drift apart.

## 📁 Repository Structure

```
data/        cleaned CSVs — gridded and regional means, per variable
analysis/    trend statistics, significance testing, verdict logic
output/      map files and regional series files consumed by the frontend
web/         the EarthX interface
docs/        data format contracts, screenshots and notes
```

## 🔌 Data Contracts

The pipeline is split across the team, so the handoffs are fixed in writing.

**Cleaning → analysis (CSV)** — columns are `date, lat, lon, variable, value, unit`, one row per location, per month, per variable. `date` is always the 1st of the month, longitude runs −180 to 180, and `unit` is identical on every row of a variable.

**Analysis → frontend (JSON)** — two files per variable and region:

- **Map file** — carries `variable`, `unit`, `region`, `period`, and a `cells` array where each cell holds `lat`, `lon`, `slope_per_decade`, `p_value`, `verdict`, `years_to_significance`, `ci_low` and `ci_high`. Drives the map.
- **Regional series file** — the region averaged to a single monthly value, with the same trend statistics plus `verdict_text` and the full `series` array. Drives the case-file chart.

Keeping the series out of the map file was a deliberate call: embedded per cell, it ran to hundreds of megabytes per variable and froze the browser.

## 🚀 Getting Started

```bash
git clone https://github.com/EarthXTeam/EarthX.git
cd EarthX
pip install -r requirements.txt
```

_Full setup instructions to follow._

## 👩‍🚀 The Team

Five third-year data science students.

- **Celine** — data collection and cleaning
- **Reina** — statistical analysis
- **Mahdi** — web development
- **Hussein** — web development
- **Fatima** — visualization and web development

## 🙏 Acknowledgements

Data courtesy of NASA's Earth science missions and models, accessed through Giovanni. Built in 48 hours for the NASA Space Apps Challenge 2026.

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.
