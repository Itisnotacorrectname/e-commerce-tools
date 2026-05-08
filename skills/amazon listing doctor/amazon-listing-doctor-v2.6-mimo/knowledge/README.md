# Knowledge Base — Optional User Supplied

> ⚠️ This directory is for optional user-supplied reference materials. The skill works without it.

## Recommended Files to Add

| Folder | Purpose | Notes |
|--------|---------|-------|
| `references/` | Built-in rules for violation detection & E-GEO scoring | Included in package |
| `knowledge/` | User's own research, competitor analysis, market data | Optional, not synced |

## Built-in Reference Files

- `references/rufus_test.md` — Rufus intent testing framework
- `references/cosmo_evaluation.md` — Cosmo scoring rubric
- `references/violation_rules.md` — V1-V18 complete rules (inlined in SKILL.md)

## User-Supplied Knowledge

Place your own research files in `knowledge/` subdirectories:
- `knowledge/research/` — academic papers, market reports
- `knowledge/violations/` — brand-specific violation rules
- `knowledge/ads/` — ad spend strategies

The skill does NOT require user-supplied files to function.

## Core Principle

**v2.6 is self-contained** — all analysis rules (V1-V18, E-GEO framework, Cosmo scoring) are embedded directly in SKILL.md. The knowledge/ directory is purely optional for users who want to add their own research materials.
