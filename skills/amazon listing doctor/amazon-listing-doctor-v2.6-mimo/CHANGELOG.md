# Amazon Listing Doctor v2.6 -mimo 更新日志

---

## v2.6-mimo.20260507 (晚间) - 2026-05-07

### 修复 (scraper 架构根因修复)
- **`--disable-web-security` 导致 Amazon 返回错误页** — 此 flag 被 Amazon 反爬检测，返回 2KB "Something went wrong" 页面。已移除，对齐 universal-scraper v2.0
- **`locale: 'en_US'` 导致 Amazon 返回错误页** — Playwright 的 locale 选项使用下划线格式（en_US），但浏览器标准是连字符（en-US）。Amazon 检测到非标准 locale 后拒绝服务。已移除 locale 选项，仅保留 acceptLang（自动转换格式）
- **搜索页 ZIP bypass 逻辑确认正确** — Kane 确认不改 zip 会弹出不正确结果，保留 ZIP bypass
- **新增 Strategy 3 解析** — Amazon 2025 新版 UI 将标题放在 `data-cy="title-recipe"` 而非 `data-asin` 内部，旧 selector 无法匹配标题

### 变更
- **Phase 2 分析改为主 session 执行** — SKILL.md 新增执行位置约束：Phase 2 必须在主 session 做，禁止子任务（上下文割裂导致分析不完整）
- **Phase 1 分析改为主 session 执行** — SKILL.md 新增执行位置约束：Phase 1 用 exec 在主 session 执行

## v2.7 - 2026-05-08

### 重构 (PRODUCT_TYPE_WORDS → category 驱动)
- **删除硬编码 PRODUCT_TYPE_WORDS**（50+家具/家居/健身产品词），改为 category 路径驱动
- 有 category 时：trigram/bigram 必须含 ≥1 个 catLastWords 词才入选（category 就是产品分类，不需要猜测）
- 无 category 时：用标题位置兜底，取前 5 个非 stopword 位置的短语
- trigram/bigram 排序统一用 catBoost（category 信号加权）

### 新增
- **step4_worker.js ASIN 预校验** — 匹配 /^[A-Z0-9]{10}$/，不合法直接报错，不浪费 Playwright 导航时间
- **竞品价格偏差警告** — 目标价格与竞品均价偏差 >50% 时发出警告，低价竞品（<目标50%）单独提示运费风险
- **竞品运费检测** — 搜索结果中检测 Prime 徽章和 "FREE Shipping" 文本，写入 freeShipping 字段
- **浏览器 headless 可配置** — 环境变量 SCRAPER_HEADLESS=false 可使浏览器可见（默认 headless）
- **coreProduct 短语完整性检测** — 检查 trigram 末尾词是否与下一词形成常见搭配（pull→up, tv→stand 等），排除不完整短语

### 核心修复
- **step3 coreProduct 提取重大改进**：
  - trigram 门控改为 catAllWords（全路径词集），避免窄品类名误杀
  - 排序改为 完整性优先 > 位置升序 > 长度升序
  - 移除 category constraint（品类路径太窄导致正确产品被替换）
  - B0GVRS65WW: "bar stand dip" → "pull up bar" ✅
  - B0FZK3PM64: "& entertainment" → "rattan tv stand" ✅

### 清理
- 删除 diagnose.bak.js、step4_worker.bak.js、diagnose.bak_old 残留备份

### 未来改进（暂不实现）
- **视觉模型识图**：调用视觉模型分析产品主图，与 coreProduct 做匹配验证。成本约 $0.03-0.05/次。需评估成本效益比。

---

## v2.6-mimo.20260507 (下午) - 2026-05-07

### 新增
- **step13 评论爬取**：自动抓取 Amazon 产品评论（reviewCount ≥ 10 时触发，最多 60 条）
  - 新文件：`step13_review_worker.js`（14.8KB，Playwright 爬虫）
  - `diagnose.js` 新增 step13 函数 + main() 调用 + data_package 输出

### 修复
- **step3 coreProduct 提取全面重写**（7 处改动）：
  1. 新增 `catAllWords`（全路径 category 词集）用于约束验证
  2. catBoost/catWordCount 只用 `catLastWords`（最后一段），避免 "living room" 等场景词干扰
  3. category 约束：coreProduct 必须含 category 词，否则降级
  4. trigram 阈值从 productTypeCount ≥ 2 降至 ≥ 1（很多产品核心类型词只有 1 个）
  5. trigram 排序增加位置 tiebreaker（catWordCount 相同时优先 title 前面的词）
  6. 新增 contiguity check：验证 coreProduct 是 title 的连续子序列
  7. `titleBigrams` 返回字符串数组而非对象数组（修复 retry 的 "[object Object]" bug）
  - 修复前：B09NR5DQK4 → "machine lat pull"（错误），B0GTNTWN6X → "sofa couch living"（错误）
  - 修复后：B09NR5DQK4 → "power rack" ✅，B0GTNTWN6X → "sofa couch" ✅
- **titleBigrams 返回字符串数组**：修复 retry 的 "[object Object]" bug
- **Phase 1 数据质量门禁**：Phase 1 完成后检查数据是否足够（标题、五点、竞品数），不足则停止并提示原因，不浪费 Phase 2 的 API 费用
  - 竞品 = 0 → 停止 + 建议等待冷却
  - 竞品 < 5 → 警告但继续
  - 标题/五点缺失 → 停止
  - 评论数据写入 `step13.json` checkpoint，供 Claude 分析

### 变更
- **amazon_scraper.js 升级到 v2.4 版本**（27.5KB → 30.9KB，+76行）
  - 新增 `extractCompPriceRating`（竞品价格/评分提取）
  - 新增 delivery address 相关逻辑
  - 原因：v2.4 的 scraper 比 old 版本更完善

### 修复
- **lib/amazon_scraper.js 缺失问题**：v2.6-mimo 创建时 lib/ 目录为空，step2_worker 和 step4_worker 无法运行
  - 解决：从 v2.4 复制 scraper（后升级到 v2.4 版本）
  - 验证：模块加载正常，11 个导出函数全部识别

### 文件变更
| 文件 | 变更 |
|------|------|
| lib/amazon_scraper.js | 27.5KB → 30.9KB（v2.4 升级） |
| step13_review_worker.js | 新增 14.8KB |
| diagnose.js | 655行 → 712行（+57行 step13 集成） |

---

## v2.6-mimo.20260507 (上午) - 2026-05-07

## v2.6-mimo 完成状态

### ✅ 已完成

1. **创建全新目录** `amazon-listing-doctor-v2.6-mimo`
   - 基于 v2.3 清洁架构
   - 不修改任何源文件

2. **加入 v2.4 核心优化**
   - category-weighted bigram 打分（catBoost）
   - GENERIC_PARENTS 过滤
   - smart fallback（category 与 title 交叉验证）
   - 断裂 bigram 修复（flip 逻辑）

3. **修复核心产品提取问题**
   - 问题：coreProduct 为 "pull up" 而非 "pull up bar"
   - 原因：trigrams 不作为 coreProduct 直接来源
   - 解决：优先选择包含最多产品类型词的 trigram
   - 结果：coreProduct 正确提取为 "pull up bar"

4. **修复连字符处理问题**
   - 问题：category "Pull-Up Bars" 中的连字符未处理
   - 原因：catLastWords = {"pull-up", "bar"}，而 words 中是 {"pull", "up", "bar"}
   - 解决：在 catLast 处理中替换连字符为空格
   - 结果：catLastWords 正确为 {"pull", "up", "bar"}

5. **扩展 PRODUCT_TYPE_WORDS**
   - 加入 fitness equipment 相关词：pull, up, bar, dip, station, tower, machine, equipment, trainer

### 📊 测试结果

**ASIN: B09PV32NNK (Pull Up Bar)**

| 项目 | v2.3 | v2.4 | v2.6-mimo |
|------|------|------|-----------|
| coreProduct | pull-up bar | pull-up bar | pull up bar ✅ |
| catBoost 正确性 | ❌ 未实现 | ✅ | ✅ |
| 连字符处理 | ❌ | ✅ | ✅ |
| trigram 优先级 | ❌ | ❌ | ✅ |

### 📁 文件结构

```
skills/amazon-listing-doctor-v2.6-mimo/
├── diagnose.js              # 数据层：step1-4 爬虫 + category-weighted coreProduct
├── report_gen.js            # 渲染层：读 checkpoints → 生成 HTML/PDF
├── inject_analysis.js       # JSON 路线：analysis.json → step5-14.json → 报告
├── md_to_checkpoints.js     # md 路线：analysis.md → step5-14.json → 报告
├── SKILL.md                 # 分析层：完整分析逻辑（V1-V18 内联）
├── VERSION.md               # 版本说明
├── README.md                # 使用说明
├── CHANGELOG.md             # 本文件：更新日志
├── ARCHITECTURE.md          # 架构设计
├── references/
│   ├── rufus_test.md        # Rufus 意图问题生成模板
│   ├── cosmo_evaluation.md  # Cosmo 0/3/5 评分框架
│   └── violation_rules.md   # V1-V18 完整规则（待创建）
├── knowledge/
│   └── README.md            # 可选用户知识库（skill 本身自包含）
└── lib/
    └── amazon_scraper.js    # Playwright 爬虫核心
```

### 🔧 核心改进代码

#### 1. category-weighted bigram 打分

```javascript
var catBoost = (catLastWords.has(words[i]) ? 1 : 0) + 
               (catLastWords.has(words[i + 1]) ? 1 : 0);
```

#### 2. 连字符处理

```javascript
var catLast = (catParts[catParts.length - 1] || '')
  .toLowerCase()
  .replace(/-/g, ' ')  // ← 新增：替换连字符为空格
  .replace(/\s+/g, ' ')
  .replace(/s$/, '')
  .trim();
```

#### 3. trigram 优先级（包含最多产品类型词）

```javascript
var bestTrigram = null;
var maxProductTypeCount = 0;
for (var i = 0; i < trigrams.length; i++) {
  var triWords = trigrams[i].split(' ');
  var productTypeCount = triWords.filter(function(w) { 
    return PRODUCT_TYPE_WORDS.has(w); 
  }).length;
  if (productTypeCount > maxProductTypeCount) {
    maxProductTypeCount = productTypeCount;
    bestTrigram = trigrams[i];
  }
}
if (bestTrigram && maxProductTypeCount >= 2) {
  coreProduct = bestTrigram;
}
```

### 📝 待实现

- [ ] Fact-Check（G.5）代码实现（diagnose.js step9）
- [ ] 动态 bullet 排序代码实现（diagnose.js step9）
- [ ] violation_rules.md 创建（V1-V18 完整规则）
- [ ] 测试其他 ASIN（B0F9P84PW8, B0GVRS65WW, B0D2QVJ5S8）

### 🎯 下一步

1. 测试其他 ASIN 验证 coreProduct 提取准确性
2. 实现 Fact-Check 代码
3. 实现动态 bullet 排序
4. 创建 violation_rules.md
5. 发布 v2.6-mimo 正式版
