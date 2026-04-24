# Rufus Intent Simulation — Step 10 Procedure

## Purpose

Simulate Amazon Rufus's consumer intent questioning to reveal semantic gaps in the listing. Rufus does not ask shallow questions — it asks deep, scenario-based questions that reveal whether your product can genuinely be recommended for specific use cases.

---

## Input

- The product's **primary keyword** (top keyword from Keyword Universe, Step 6)
- The product's **category** and **key specifications** (from the listing audit)
- Any **relevant use contexts** suggested by the product type

---

## Prompt Template

```
You are Amazon Rufus, a generative AI shopping assistant. A customer is browsing in the [CATEGORY] category with a primary interest in: [PRIMARY KEYWORD].

Based on this product context:
- Product: [PRODUCT NAME/TYPE]
- Category: [CATEGORY]
- Key specs: [RELEVANT SPECS from listing]

Generate exactly 3 deep consumer intent questions Rufus would ask this customer.

Requirements:
- Questions must reflect USE-CASE scenarios, PAIN POINTS, or MATERIAL/FEATURE COMPARISONS
- Do NOT ask: price, shipping time, warranty coverage, or return policy questions
- Frame questions as a knowledgeable in-store sales associate would — specific, scenario-driven, uncovering hidden needs
- Questions should be answerable by a well-optimized product listing

Format: plain numbered list, no preamble, no explanation.
```

---

## Examples

### Example: Mattress (Primary keyword: "memory foam mattress 10 inch")

Generated questions:
1. Do you share your bed with a partner or child, and how important is motion isolation for not disturbing them during the night?
2. Do you sleep hot or cool, and what level of airflow and temperature regulation do you need to stay comfortable through the night?
3. Are you buying this for a specific frame type (platform, slatted, or box spring), and does the mattress height work with your sheets and headboard?

### Example: Blender (Primary keyword: "professional blender")

1. Do you primarily blend hard ingredients like nuts, ice, or frozen fruits, and how much power (watts/voltage) do you need for smooth results?
2. Is noise level important to you — will you be blending early morning or late evening when a loud motor would be disruptive?
3. Do you need to process both wet and dry ingredients — would you also use this for making nut butters, flours, or hot soups?

### Example: Running Shoes (Primary keyword: "trail running shoes")

1. What type of terrain do you primarily run on — rocky, muddy, or packed dirt — and do you need aggressive grip for downhill braking?
2. Do you have any foot conditions like plantar fasciitis or overpronation that require specific arch support or cushioning technology?
3. How important is waterproofing versus breathability for your typical running conditions and climate?

---

## Interpretation

These questions reveal **semantic nodes** — specific attributes the knowledge graph must connect to your product. A listing that does not address the topics in these questions will be invisible when Rufus answers them for a real customer.

Use the outputs of this step as the INPUT for the Cosmo Scoring in Step 11.
