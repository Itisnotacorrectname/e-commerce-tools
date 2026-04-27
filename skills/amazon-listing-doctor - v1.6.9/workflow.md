# Amazon Listing Doctor — 12-Section Diagnostic Workflow

Execute in order. All sections are mandatory except where data is unavailable.

---

## Prerequisite

Before starting, read:
- `references/rufus_test.md` — Step 10 mandatory procedure
- `references/cosmo_evaluation.md` — Step 11 mandatory scoring rubric
- `knowledge/rufus_cosmos_kb.md` — A10/Cosmo rules for title auditing

---

## DATA SOURCE RULES (Critical — Read First)

**Three categories of data:**

| Category | Source | Acceptable? |
|----------|--------|-------------|
| Target listing data (title, price, rating, bullets) | HTTP + cheerio from Amazon detail page | ✅ Yes |
| Competitor data (titles, prices, bullets) | HTTP + cheerio from Amazon detail page | ✅ Yes — REQUIRED |
| Competitor reviews | Individual ASIN detail pages (search results do not render reviews) | ✅ Yes — REQUIRED |
| Keyword universe | Amazon search suggestions + Filter labels + scraped competitor titles | ✅ Yes — REQUIRED |
| Knowledge base rules (A10/Cosmo scoring, optimization) | `knowledge/rufus_cosmos_kb.md` | ✅ Yes |
| Inference / training knowledge / guesses | DO NOT USE | ❌ Never |

**If competitor data cannot be scraped:** Report the section honestly as "Could not scrape competitor data — this section reflects known Amazon optimization principles only, not verified competitor information." Never fabricate competitor titles, prices, or ranks.

---

## Step 1 — Link Detection & ASIN Extraction

Accept any amazon.com product URL. Extract ASIN using pattern: `/dp/([A-Z0-9]{10})`.

Strip affiliate tags, tracking parameters before proceeding.

---

## Step 2 — Live Data Scraping (Target Listing)

**Primary method: HTTP + cheerio (bypasses Amazon's TCP-level Playwright detection)**

See `reports/http_scrape.js` in this skill's directory for working code. Key pattern:
- Use Node.js native `https` module with `Accept-Encoding: gzip, deflate, br`
- Decompress with `zlib.gunzipSync()` or `zlib.brotliDecompressSync()`
- Parse with cheerio (already available in workspace via textract dependency)
- Cheerio selectors: `#productTitle`, `.a-price .a-offscreen`, `.a-icon-alt`, `#acrCustomerReviewText`, `#feature-bullets li span.a-list-item`, `#bylineInfo`

**Fallback: Playwright** — only if HTTP method returns garbled/challenged HTML. Amazon TCP-blocks headless Playwright in many regions; if Playwright returns `ERR_CONNECTION_CLOSED`, switch to HTTP method immediately.

**For review counts:** Always use the detail page selector `#acrCustomerReviewText`. Amazon search results pages do NOT render review counts in static HTML.

**Geo-redirect rule:** If geo-redirect is detected (price shows CNY), either (a) wait for US VPN to reconnect and retry, or (b) note in report as "price estimated from CNY at [rate]" and state it must be confirmed manually. Do NOT assume a manual USD price without flagging it.

---

## Step 3 — Keyword Research from Amazon (Required for Steps 4-6)

**Recommended scraping approach (HTTP + cheerio):**
Use Node.js with native HTTPS and cheerio (not Playwright — Amazon TCP-blocks Playwright headless browsers). See the scraping script pattern in `reports/scrape_us2.js` in this skill's directory for working code.

**A. Search result page (primary keyword):**
URL: `https://www.amazon.com/s?k=[primary-keyword]&s=review-rank`
Extract:
- All product titles from page 1 (for keyword frequency analysis)
- Filter/sort options visible on page
- "Related searches" at bottom of page

**B. IP check before scraping:**
Always verify exit IP first. If the IP is non-US, geo-redirect will corrupt price data. Use: `https://api.ipify.org?format=json` or `https://ifconfig.me/all.json`. If non-US, either wait for VPN or note in report: "Price data may be geo-redirected."

**C. From competitor listing pages (Step 4):**
Visit each competitor ASIN and extract:
- Their keyword title patterns
- "Frequently bought together" and "Customers also bought" — for keyword expansion

**This data is required for Steps 4, 5, and 6. Do not skip this step.**

---

## Step 4 — Competitor Benchmark (Real Data Only)

**Universal Competitor Selection Method (works for any product category):**

### Step 4A — Extract Primary Search Keyword
From the target listing title, identify the primary keyword buyers would search.
Rule: The leftmost significant noun phrase in the title is usually the primary keyword.

Examples:
- "sogesfurniture Queen Size Mattress, 12 inch..." → keyword: "queen mattress" or "queen 12 inch mattress"
- "Vitamix 5200 Blender, Professional Grade, 64-Ounce, Stainless Steel" → keyword: "blender" or "professional blender"
- "Sony WH-1000XM5 Wireless Noise Canceling Headphones" → keyword: "noise canceling headphones" or "wireless headphones"

### Step 4B — Search Amazon with That Keyword
URL: `https://www.amazon.com/s?k=[keyword]&s=review-rank`

### Step 4B½ — Keyword Broadening Cascade (Mandatory — No Skipping)

**Trigger:** After applying Step 4C filters, if fewer than **3 valid competitors** remain.

**Rule: Must attempt at least 3 broadening rounds before declaring "no competitors found."**

| Round | Trigger | Action | Example if Round 1 = "rv mattress short queen" |
|-------|---------|--------|------|
| **Round 1** | Initial keyword | Direct match | `"rv mattress short queen"` |
| **Round 2** | < 3 competitors after filters | Remove size specifier | `"rv mattress"` |
| **Round 3** | < 3 competitors after Round 2 | Remove form factor | `"motorhome mattress"` or `"camper mattress"` |
| **Round 4** | < 3 competitors after Round 3 | Also-Bought from target ASIN | Scrape `https://www.amazon.com/dp/[TARGET]/#also-bought` section for ASINs |

**Broadening logic:**
- Each round removes **one** modifier in this priority: size → brand/form → material
- Always keep the **core product noun** (e.g., "mattress", "blender")
- Stop broadening when results exceed 3 competitors OR Round 4 exhausted

**Tracking in report:**
```
Round 1: "rv mattress short queen" → 1 competitor found (filters applied)
Round 2: "rv mattress" → 4 competitors found ✓
→ Proceeding with Round 2 results (4 competitors)
```

**If all 4 rounds yield < 3 competitors:**
Write in report: `"⚠️ This is a data-sparse niche — only N competitor(s) found after 4 broadening rounds. Analysis is based on available data only."`

### Step 4C — Universal Filters (apply to ALL products)

**Filter 1 — Product Type Match:**
The competitor's title must describe the same product type as the target.
- Method: Check if the target's core product word appears in the competitor's title
- Example: Target = "Stand Mixer" → exclude "Hand Mixer", "Food Processor"
- Example: Target = "Mattress" → exclude "Mattress Topper", "Bed Frame"

**Filter 2 — Size/Format Match (if applicable):**
If the target title contains a size/format keyword, competitors MUST have the same one:
- mattress examples: "Queen" vs "Twin" vs "King" — must match
- blender examples: "64-Ounce" vs "32-Ounce" — must match
- headphone examples: "over-ear" vs "in-ear" — must match
- laptop examples: "15 inch" vs "13 inch" — must match

If the target title does NOT contain a specific size/format keyword, do NOT filter by size.

**Filter 3 — Exclude Irrelevant Products:**
- Sponsored/Ad placements (marked "Ad" or "Sponsored")
- Accessories/parts for your product (e.g., "replacement brush for Vacuum X")
- Bundles that include non-core items
- Products in a different subcategory entirely

### Step 4D — Sort and Select
From the filtered results:
1. Sort by review count (highest first) — this is the best BSR proxy available from search results
2. Select top 5-8 competitors

### Step 4E — Scrape Competitor Details
Visit each selected ASIN and extract:
- Full title
- Price (USD)
- Rating (stars)
- Number of reviews
- Key bullet point themes (1-2 sentences)
- BSR if available

### Step 4F — Present Results

In the report table, show:
- Included competitors with a brief reason
- Excluded competitors with the specific filter that excluded them (this proves the filtering was applied correctly)

| # | ASIN | Title | Price | Rating | Reviews | Included Because |
|---|------|-------|-------|--------|---------|-----------------|
| 1 | [ASIN] | [title] | $XXX | X.X⭐ | N | Same product type, same size |
| X | [EXCLUDED] | [title] | — | — | — | Wrong size (Twin vs target's Queen) |

### Title Pattern Analysis
From the real filtered titles, identify:
- What noun phrases lead in ALL top performers
- What is missing from the subject listing that competitors include
- What formatting conventions are standard

### If Scraping Fails
Write "Could not verify — based on optimization principles only." Do not fabricate competitor data.

---

## Step 5 — Keyword Universe (From Real Amazon Data)

**Source this step ONLY from:**
- Amazon search suggestions (Step 3B)
- Filter labels visible on Amazon search pages
- Actual competitor titles (Step 4 — real scraped titles)

**Tier 1 — Primary Keywords:**
Extract from: search suggestions for main product term + Filter labels (size/width/height/material). These are buyer non-negotiables.

**Tier 2 — Secondary Keywords:**
Extract from: competitor titles' differentiating features + related searches section. These are competitive differentiators.

**Tier 3 — Long-tail / Backend:**
Extract from: "Customers also bought" context + Q&A signals. These are use-case and scenario modifiers.

**Format:** Keyword chips for chat + a copy-paste block for Seller Central backend.

---

## Step 6 — Title Issue Analysis (Against Real Data)

Audit the title using:
- A10/Cosmo rules from knowledge base
- Real competitor title patterns from Step 4 (what are actual competitors doing?)

For each issue:
- Quote the exact title snippet
- Reference the real competitor data that shows this is a problem
- Assign severity from knowledge base rubric

---

## Step 7 — Optimized Title Versions (Based on Real Keywords)

Use only keywords confirmed in Step 5 (real Amazon data).

For each version:
- List which REAL keywords from the keyword universe it covers
- Note which competitor pattern it aligns with
- Character count

---

## Step 8 — Backend Search Terms

Based on real keywords from Step 5 that are NOT already in the optimized title. No fabricating keywords not found in Amazon search data.

---

## Step 9 — Bullet Point Optimization

Based on real competitor bullet analysis (what are top competitors writing in their bullets?) plus knowledge base rules.

For each bullet rewrite:
- Reference the current weakness with exact quote
- Show the recommended rewrite
- Note which keyword(s) from Step 5 the rewrite incorporates

---

## Step 10 — Rufus Intent Simulation (MANDATORY)

Read `references/rufus_test.md` for the exact prompt template.

Generate 3 questions from:
- The REAL primary keyword context (Step 5 data)
- Actual use-case signals from Amazon Q&A and "Customers also bought"
- NOT from generic templates

---

## Step 11 — Cosmo Content Scoring (MANDATORY)

Read `references/cosmo_evaluation.md` for the 0/3/5 rubric.

Score each bullet against each Rufus question:
- Quote the exact bullet text
- Show the score and reasoning
- For any score ≤ 3: write intent enhancement copy that specifically addresses that question

---

## Step 12 — 显性违规识别 (Explicit Violation Detection)

**依据：** Amazon内容准则 + E-GEO论文 "maintains factuality" 原则

显性违规是直接违反Amazon政策的内容，可从listing文本直接检测：

| # | 违规类型 | 检测规则 | 命中时的描述 |
|---|---------|---------|------------|
| V1 | 无依据最高级 | 标题/Bullet含 "#1"、"Best Ever"、"Top Rated" 等未经独立验证的 superlative | 引述原文 + "违反Amazon比较性声明政策" |
| V2 | 直接贬低竞品 | 标题/Bullet含 "vs"、"better than"、"unlike" + 竞品名称 | 引述原文 + "违反Amazon比较性表述政策" |
| V3 | 未经证实的健康/安全声明 | Bullet含 "clinically proven"、"scientifically proven"、"FDA approved"（非医疗器械类别）| 引述原文 + "无支持证据的声明" |
| V4 | 促销性价格语言 | 含 "free shipping"、"best price"、"deal"、"limited time" 等价格催迫语 | 引述原文 + "违反Amazon定价促销准则" |
| V5 | 虚假稀缺性 | 含 "only X left"、"running out"、"high demand" 等库存操纵语言 | 引述原文 + "违反库存状态准确性政策" |
| V6 | 误导性认证声明 | CertiPUR-US / OEKO-TEX 等认证提及但未在标题或bullet说明已获认证 | 引述原文 + "认证声明无对应证据" |
| V7 | 标题/Bullet超出字符限制 | Title > 200 bytes / Bullet > 500 bytes（含空格）| 测量实际字符数 + "超出Amazon限制" |
| V8 | 保修条款自相矛盾 | 同时声称 "无保修" 和 Lifetime Warranty | 两个矛盾说法 + "保修信息不一致" |

**检测方法：**
- 扫描标题 + 所有Bullet文本
- 用正则匹配上述模式
- 对每个命中：引用原文片段，说明违规类型

**E-GEO关联：** E-GEO论文 Table 3 "Maintains Factuality" — factuality violation（虚假声明）会导致Rufus对listing的信任度下降，排名受损。

---

## Step 13 — 隐性违规识别 (Implicit Violation Detection)

**依据：** E-GEO论文 + p15 Q&A推荐论文

隐性违规不是明显违规，但会触发Rufus/Cosmo负面信号或降低转化：

| # | 违规类型 | 检测规则 | 命中时的描述 |
|---|---------|---------|------------|
| V9 | **买前不答（E-GEO核心）** | listing未覆盖买家的典型问题（如"安装方便吗"、"尺寸合适吗"），且Q&A区无对应问答 | "E-GEO: 描述未在买家提问前提供答案，Rufus无法从此listing提取答案" |
| V10 | **Q&A信号空洞** | listing的Q&A区无任何问题，或有未回答的问题超过3天 | "p15: Q&A是Rufus的信息来源，无Q&A = Rufus找不到答案" |
| V11 | **唯一差异化缺失** | 标题 + Bullet无任何独特价值主张，只有通用属性堆砌 | "E-GEO "Unique Selling Points" 特征缺失 — 竞品列表中无法脱颖而出" |
| V12 | **权威性空洞** | 标题/Bullet无任何证明文件（无认证、无测试数据、无具体参数） | "E-GEO "Authoritativeness" 特征缺失 — Rufus无证据可引用" |
| V13 | **紧迫性缺失** | listing无任何场景/时机暗示（节日/礼物/搬家/特定用途） | "E-GEO "Urgent Call" 特征缺失 — 无法触发即时购买冲动" |
| V14 | **可扫描性差** | Bullet由连续长句构成，无换行、无数字标记、无结构化表达 | "E-GEO "Easily Scannable" 特征缺失 — Rufus解析效率低" |
| V15 | **评论评分未引用** | 评分 ≥ 4.5 但 Bullet 无任何 "customers love" / "#1 bestseller" / 评分相关语句 | "E-GEO "Reviews Ratings" 特征缺失 — 社会证明信号未激活" |
| V16 | **E-GEO 特征冲突** | listing同时声称多个 superlative（"best" + "easiest" + "most durable"）而缺乏证据 | "E-GEO: 多重未验证声明触发 factuality violation 风险" |

**E-GEO关联：** Optimized prompts一致包含10个特征（Table 3）：Ranking Emphasis、User Intent、Competitiveness、Reviews Ratings、Compelling、Narrative、Authoritativeness、Unique Selling Points、Urgent Call、Easily Scannable、Maintains Factuality。缺失任一特征即构成隐性违规。

**p15关联：** p15论文强调 Q&A pair 应在买家提问前就存在于 listing 中（"bridging the gap between information seeking and product search"）。买家的典型问题（如Step 10模拟的Rufus问题）如果bullet中无答案、Q&A中也无答案，则V9违规。

---

## Step 14 — Listing Weight Improvement

| Factor | Current (from scrape) | Action | Priority |
|--------|----------------------|--------|----------|
| Review count | [N] from scrape | Specific action based on real gap vs competitors | P1-P3 |
| Price | [price] vs avg from Step 4 real data | If >20% above competitor avg: note and suggest coupon or justify | P1 |
| Main image | Cannot assess from scrape | Note: "assess manually — request screenshot" | P2 |
| Video | Cannot confirm | Same | P2 |
| Coupon | Unknown from scrape | "Activate if price is above category avg" | P2 |

Only use real competitor price/rating data from Step 4. If you don't have it, say so.

---

## Step 15 — Priority Action Plan

P0/P1 items from all sections (显性违规 → 隐性违规 → 其他). Number each action.

---

## Step 16 — Anomalies & Data Integrity

Always add closing section:

```
⚠ ANOMALIES FLAGGED — NO DATA FABRICATED:
- [Item]: [status — live scrape / could not verify / N/A]
```

Rules:
- If competitor data came from scrape: note "from live Amazon search"
- If competitor data could not be scraped: explicitly say "competitor data not verified — based on optimization principles only"
- If price is from geo-redirect: note the exchange rate source and that USD price is estimated
- Never use training knowledge to fill in missing competitor data

---

## Output Format

- Primary delivery: clean markdown for chat
- HTML report saved to: `amazon-listing-doctor/reports/[ASIN]_[YYYY-MM-DD].html`
- Always include the Anomalies section (Step 14)
