---
name: Amazon Listing Doctor
slug: amazon-listing-doctor
version: 4.2.0
description: Diagnose Amazon listings with a 15-step mechanical audit, Rufus intent testing, and Cosmo scoring. Paste any amazon.com product link to run.
---

## When to Use

Trigger phrases:
- "诊断这个listing" / "diagnose this listing"
- "分析这个亚马逊链接" / "analyze this Amazon link"
- Any amazon.com/dp/ or amazon.com/gp/product/ link

## Architecture

### Skill Code (portable, upgrade-safe)
```
skills/amazon-listing-doctor/
├── diagnose.js              # 15-step checkpoint engine
├── report_gen.js            # HTML/PDF report generator
├── workflow.md              # 15-step procedure
├── SKILL.md                 # This file
├── README.md                # User documentation
├── lib/
│   └── amazon_price.js      # Universal Amazon price fetcher (14 marketplaces)
├── references/
│   ├── rufus_test.md        # Step 10 Rufus intent prompt template
│   ├── cosmo_evaluation.md   # Step 11 Cosmo scoring rubric
│   └── kb_retrieval_rules.md # Knowledge base retrieval rules
└── knowledge/
    └── rufus_cosmos_kb.md   # Rufus/Cosmo optimization knowledge base
```

### User Data (persistent, survives upgrades)
```
workspace/amazon-listing-doctor/
├── reports/                  # HTML/PDF reports per ASIN
│   └── [ASIN]/
│       ├── report.html
│       └── report.pdf
├── checkpoints/              # Intermediate data (regeneratable)
│   └── [ASIN]/
│       └── step*.json
└── knowledge/                # User-supplied / auto-learned knowledge
    ├── ads/                  # Amazon Ads research
    ├── research/             # Academic research distillations
    ├── rufus_links/          # Rufus/Cosmo/PPC articles
    └── violations/           # Listing violation rules
```

## Directory Separation Rule

**Skill upgrades do not delete user data.** The `workspace/amazon-listing-doctor/` directory lives outside the skill folder and is never modified or deleted during skill updates.

On first run, the skill auto-creates these directories if they don't exist.

## Core Rules

### Data Source Rules (Critical)

| Data Type | Source | Acceptable? |
|-----------|--------|-------------|
| Target listing (title, price, bullets) | HTTP+cheerio scrape | ✅ Yes |
| Competitor data | HTTP+cheerio from Amazon search | ✅ Required |
| Keywords | Amazon search suggestions + Filter labels | ✅ Required |
| Optimization rules | KB retrieval per `references/kb_retrieval_rules.md` | ✅ Yes |
| Inference / training guesses | DO NOT USE | ❌ Never |

**If competitor scraping fails:** Write explicitly: "竞品数据未获取，基于优化原则推断，非实测数据。" Do not fabricate competitor titles, prices, or ranks.

### Core Product Detection (Step 3 → Step 4)

The skill detects the core product type using a three-tier fallback:

**Tier 1 — `PRODUCT_PHRASES` (hardcoded list)**
Longest-match wins. Covers: beds, mattresses, cats, coffee makers, air fryers, etc.
If a phrase matches → use it directly as `coreProduct`.

**Tier 2 — `productTypeWords` (dynamic list)**
When `PRODUCT_PHRASES` produces no match, Step4 scans the title's `other` keyword bucket for product-type nouns:
```
bathroom organizer, storage rack, tier rack, shower curtain, bath mat, rug, rack, shelf, cabinet, bin, basket, organizer, ...
```
Two-word types are preferred over single-word (e.g., "bathroom organizer" > "organizer").

**Tier 3 — title split**
Falls back to first two words of the title.

**Expanding `productTypeWords`**:
When a new product type (e.g., "bathroom organizer") fails to match `coreProduct`, add it to the `productTypeWords` array in `diagnose.js` (Step4 fallback section). Format: prefer 2-word phrases first, single words second.

### Workflow Steps (15 steps)

| Step | Name | KB Retrieval |
|------|------|-------------|
| 1 | ASIN Extraction | — |
| 2 | Live Scrape | — |
| 3 | Keyword Research | rufus_links/02, 10 |
| 4 | Competitor Benchmark | — |
| 5 | Keyword Universe | — |
| 6 | Title Audit | rufus_links/02, 03 |
| 7 | Optimized Titles | — |
| 8 | Backend Keywords | — |
| 9 | Bullet Optimization | — |
| 10 | Rufus Intent Test | rufus_test.md + 03, 06 |
| 11 | Cosmo Scoring | cosmo_evaluation.md + 06, E-GEO |
| 12 | Explicit Violations | listing violations KB |
| 13 | Implicit Violations | listing violations KB + E-GEO, p15 |
| 14 | Listing Weight | — |
| 15 | Priority Action Plan | E-GEO rewriting, pre-emptive answering |

## Usage

```bash
node diagnose.js [ASIN|URL]       # Run all 15 steps (network steps always re-fetch)
node diagnose.js [ASIN] --force    # Force re-run all steps
```

**Caching logic:**
- Steps 1–4 (network): **re-fetch every run**, never use cache
- Steps 5–15 (compute): depend on upstream data, skip if cache exists
- `--force`: re-execute all 15 steps including network steps

## Key Files

| File | Description |
|------|-------------|
| `diagnose.js` | Main 15-step checkpoint engine |
| `report_gen.js` | HTML/PDF report generator |
| `workflow.md` | Complete 15-step procedure |
| `lib/amazon_price.js` | Universal Amazon price fetcher (14 marketplaces) |
| `references/rufus_test.md` | Step 10 Rufus intent simulation prompt |
| `references/cosmo_evaluation.md` | Step 11 Cosmo scoring rubric |

