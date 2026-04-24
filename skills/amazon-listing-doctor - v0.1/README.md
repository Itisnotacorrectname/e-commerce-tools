# Amazon Listing Doctor

Diagnose any Amazon listing with a comprehensive 12-section audit report, Rufus intent testing, and Cosmo content scoring.

## What This Skill Does

When you paste an Amazon product link, this skill:
1. Scrapes live listing data (title, price, rating, reviews, bullets, BSR)
2. Audits title quality and flags issues by severity
3. Benchmarks against top 20 competitors (6-round cascade search)
4. Maps the full keyword universe (primary / secondary / long-tail)
5. Generates 3 optimized title versions
6. Produces a backend keyword block (250 bytes)
7. Rewrites all 5 bullet points with optimization notes
8. Plans A+ content improvements
9. Assesses listing weight factors (reviews, price, images, video)
10. **Simulates Rufus** asking 3 deep consumer intent questions
11. **Scores content against Cosmo** — each question rated 0/3/5 with intent enhancement suggestions
12. Compiles a prioritized action plan (P0/P1/P2/P3)

## Triggering the Skill

Paste any Amazon product URL in the conversation:

```
https://www.amazon.com/dp/B0GGB75W8K
https://www.amazon.com/dp/B0D2LZYQ2M?th=1
https://www.amazon.com/gp/product/B07XJ8C8F5
```

Also activates on phrases like:
- "诊断这个listing" / "diagnose this listing"
- "分析这个亚马逊链接" / "analyze this Amazon link"

## Report Sections

| Section | Content |
|---------|---------|
| 1 | Current Listing Audit — live data card |
| 2 | Title Issues — severity rated Critical/High/Medium/Low |
| 3 | Competitor Benchmark — top 20 titles + winning patterns |
| 4 | Keyword Universe — tiered keyword map |
| 5 | Optimized Titles — 3 versions (max coverage / high CTR / mobile-first) |
| 6 | Backend Keywords — 250-byte block ready for Seller Central |
| 7 | Bullet Optimization — rewrite plan per bullet |
| 8 | A+ Content Plan — text module recommendations |
| 9 | Listing Weight — review count, price, images, video, coupon |
| 10 | **Rufus Intent Test** — 3 deep questions Rufus would ask |
| 11 | **Cosmo Scoring** — 0/3/5 per question + intent enhancement copy |
| 12 | Priority Action Plan — P0/P1/P2/P3 numbered list |
| + | Anomalies — transparent data quality flags, no fabricated data |

## Output Format

- **HTML report**: Automatically saved to `workspace/amazon-listing-doctor/reports/[ASIN]/report.html`
- **PDF report**: Automatically saved alongside the HTML

## Directory Structure

```
skills/amazon-listing-doctor/     ← Skill CODE (portable, upgrade-safe)
├── diagnose.js                   # Main诊断 engine
├── report_gen.js                # HTML/PDF report generator
├── SKILL.md                     # Skill definition
├── README.md                    # This file
├── workflow.md                  # Full procedure reference
├── lib/
│   └── amazon_price.js          # Universal Amazon price fetcher (14 marketplaces)
├── references/
│   ├── rufus_test.md            # Step 10 prompt template
│   └── cosmo_evaluation.md      # Step 11 scoring rubric
└── knowledge/
    └── rufus_cosmos_kb.md       # Rufus/Cosmo knowledge base (38KB)

workspace/amazon-listing-doctor/  ← User DATA (persistent, survives upgrades)
├── reports/                     # All HTML/PDF reports
│   └── [ASIN]/
│       ├── report.html
│       └── report.pdf
├── checkpoints/                 # Intermediate diagnostic data (regeneratable)
│   └── [ASIN]/
│       └── step*.json
└── knowledge/                   # Learned patterns (auto-generated)
    ├── ads/                     # Amazon Ads research
    ├── research/                # Market research data
    ├── rufus_links/             # Rufus/Cosmo articles (web-scraped)
    └── violations/              # Listing violation rules
```

## Installation (First Run)

The skill automatically creates the `workspace/amazon-listing-doctor/` directory on first run. No manual setup required.

If you need to create it manually:
```
~/.openclaw/workspace/amazon-listing-doctor/
├── reports/
├── checkpoints/
└── knowledge/
```

## Key Innovation: Rufus + Cosmo Testing

Unlike standard SEO audits, this skill includes:

**Rufus Intent Simulation (Step 10)**
Act as Amazon's AI shopping assistant to generate 3 deep consumer questions from the product's keyword context — revealing the exact use-case and pain-point dimensions that Cosmo expects your listing to address.

**Cosmo Content Scoring (Step 11)**
Score each bullet against each Rufus question using a 0/3/5 rubric:
- 5 = Directly addresses the intent
- 3 = Implicitly touches it but requires inference
- 0 = Not mentioned — Rufus cannot recommend for this intent

For any score ≤ 3, the report includes an "intent enhancement" paragraph — natural-language copy suggestion to raise the score to 5.

## Knowledge Base

The skill includes a 38KB knowledge base covering:
- Rufus technical architecture (RAG, custom LLM, reinforcement learning)
- Cosmo Knowledge Graph mechanism vs A10 semantic blindness
- Knowledge Graph Optimization (KGO) framework
- 8-part Rufus optimization framework
- Listing optimization (NPO, bullets, backend, A+, visual, Q&A)
- Amazon PPC fundamentals (Sponsored Products/Brands/Display, match types, bidding)
- Academic research: eBay keyword expansion, algorithmic collusion, Rufus Q&A impact

## Core Product Detection

When a new product type is diagnosed incorrectly (e.g., "tier" instead of "bathroom organizer"), expand the detection dictionary:

**`diagnose.js` Step4 fallback section** — `productTypeWords` array:
```
'bathroom organizer', 'storage rack', 'tier rack', 'storage shelf',
'shower curtain', 'bath mat', 'rack', 'shelf', 'cabinet', 'bin', ...
```

Add new 2-word phrases first, then single-word fallbacks. This survives skill upgrades if you keep `workspace/amazon-listing-doctor/knowledge/` backed up.

## Data Integrity

**No data is fabricated.** If live scraping fails or data is unverifiable, the report flags it in yellow and marks it "could not verify — confirm manually." The Anomalies section at the end of every report documents exactly what was and was not confirmed from live data.

## Requirements

- Playwright for Node.js (`npm install playwright`)
- Internet connection (for live scraping)
- Amazon.com listing (US marketplace; other marketplaces may work but are untested)
- Chrome remote debugging enabled (`chrome://inspect/#remote-debugging`) for CDP features

## For Team Use

This skill is designed for multi-user environments:
- Report output is in clean IM-friendly markdown (no raw HTML in chat)
- HTML report file can be shared via file sharing tools
- The Rufus + Cosmo framework provides consistent scoring methodology across all team members
- Knowledge base ensures consistent application of Amazon's latest algorithm understanding
