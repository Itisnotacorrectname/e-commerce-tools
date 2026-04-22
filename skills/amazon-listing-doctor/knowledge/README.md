# Knowledge Base — User Supplied

> ⚠️ **此目录的内容需要用户自行填充。** Skill本身只含结构框架和占位文件。

## 目录结构

```
knowledge/
├── rufus_cosmos_kb.md     ← 内嵌基础知识库（Rufus/Cosmo优化规则，skill自带）
├── rufus_links/           ← Rufus/Cosmo/PPC 相关文章（需用户补充）
├── research/              ← 学术研究蒸馏（需用户补充）
├── violations/            ← 违规检测规则（需用户补充）
└── ads/                   ← Amazon广告知识（需用户补充）
```

## 各文件夹说明

### rufus_links/ — Rufus/Cosmo/PPC 知识文章

格式：每个文件一篇文章，markdown格式，文件头包含 `Source:` 和 `Date fetched:`。

来源：爬取自 epinium.com, sellerlabs.com, amazon.science, zonguru.com, prebodigital.co.za 等。

当前已填充：11篇（部分小文件为爬取截断或内容较少）

### research/ — 学术研究蒸馏

| 文件 | 内容 |
|------|------|
| `2511.20867v1.kb.txt` | E-GEO benchmark 论文蒸馏（Bagga et al., 2025） |
| `p15.kb.txt` | Q&A推荐系统规则（Kuzi & Malmasi, Amazon, 2024） |

### violations/ — 违规检测规则

| 文件 | 内容 |
|------|------|
| `listing显性违规识别知识库.txt` | V1-V8 显性违规检测规则 |
| `listing隐性违规识别知识库.txt` | V9-V16 隐性违规检测规则 |

### ads/ — Amazon广告知识

| 文件 | 内容 |
|------|------|
| `2505.18897v1.pdf.txt` | Amazon广告策略 |
| `2508.08325v2.pdf.txt` | Amazon Ads深度内容 |

## 如何补充知识库

1. 将自己的研究报告、论文蒸馏、爬取的文章放入对应文件夹
2. 文件名格式建议：`序号_来源_主题.md`
3. 更新 `references/kb_retrieval_rules.md` 中的调取路径（如有变更）

## 私人知识库（Kane Original）

Kane的原始资料位于：`C:/Users/csbd/.openclaw/workspace/亚马逊分析知识库/knowledge/`

此目录为私人备份，不随skill分发。
