# Cosmo Content Scoring — Step 11 Procedure

## Purpose

Evaluate whether the listing's current bullet points can effectively answer the Rufus-generated intent questions. Cosmo scores content based on how clearly it connects product attributes to specific consumer intents.

---

## Input

- 3 Rufus Intent Questions from Step 10
- The listing's 5 current bullet points (from Step 2)

---

## Scoring Rubric

For each Rufus question, read all 5 bullet points and assess how well they address the question:

| Score | Label | Criteria |
|-------|-------|----------|
| **5** | Directly Addresses | The bullet explicitly mentions the attribute or benefit relevant to the question. A customer reading this would clearly understand the product satisfies this need. |
| **3** | Implicitly Addresses | The bullet touches on the topic but does not make a clear, direct claim. The connection is there but requires inference. |
| **0** | Missing / Not Addressed | The bullet does not mention the topic at all. A customer with this specific need would get no signal from the listing. |

---

## Output Format

For each question:

```
Q[N]: [Rufus question text]
Score: [5 | 3 | 0] — [Label]

Matching bullets:
- Bullet [#]: "[exact text snippet]" → [how it addresses or fails to address the question]

[If score ≤ 3] Intent Enhancement:
[Write one paragraph showing how a bullet could be rewritten to score 5.
Suggest which bullet to modify or whether a new point should be added.
Write in a natural, informative tone — do not keyword-stuff.]
```

---

## Example

### Question
Q1: Do you share your bed with a partner or child, and how important is motion isolation for not disturbing them during the night?

### Bullets (subject listing)
1. Premium Removable & Washable Cover — hypoallergenic and breathable fabric
2. 6-Layer Protective Support System with high-density memory foam and Individually Wrapped Coils
3. Natural Cooling Dual Technology with Green Tea Extract and Bamboo Charcoal memory foam
4. CertiPUR-US and OEKO-TEX 100 Certified — No Fiberglass, No Harmful Substances
5. Mattress in a Box — easy delivery, setup in any room

### Evaluation

```
Q1: Do you share your bed with a partner or child, and how important is motion isolation for not disturbing them during the night?
Score: 3 — Implicitly Addresses

Matching bullets:
- Bullet 2: "Individually Wrapped Coils" → motion isolation is an inherent property of individually wrapped coils, but the bullet does not explicitly state "motion isolation" or "edge-to-edge support for couples." The customer must infer this.
- Bullet 1: "breathable fabric" → unrelated to motion isolation.

Intent Enhancement:
"Individually wrapped coils in the 6-layer support system work independently to absorb movement — so you and your partner can turn and shift without disturbing each other throughout the night. Full edge-to-edge support also means the full surface stays stable, even right at the borders."

(Addresses the question directly: motion isolation + couple scenario + edge support. Natural language, no keyword stuffing. Would score 5.)
```

---

## General Interpretation Guide

- **Score 5 across all 3 questions**: Listing has strong semantic coverage. Rufus will confidently recommend this product for these intents.

- **Any score of 0**: Critical gap. The listing is effectively invisible to customers with this intent. This becomes a P0 priority action.

- **Score of 3**: Moderate gap. The topic is mentioned but not convincingly. Rewrite to make the claim explicit and scenario-specific.

- **Pattern across questions**: If all 3 questions score ≤ 3, the listing suffers from a systemic semantic completeness problem — not just missing keywords but missing entire product dimensions.

---

## Cosmo Optimization Principles

From the knowledge base, Cosmo evaluates:

1. **Entity-Intent Mapping** — Does the listing clearly connect the product (Entity) to the customer's need (Intent)?
2. **Semantic Completeness** — Are all relevant product attributes and use-case dimensions covered?
3. **Common Sense Associations** — Does the listing use language that reflects how customers actually describe their needs?

Rewrite bullets to score 5 by: leading with the benefit, naming the specific attribute, and grounding it in a real use-case scenario.
