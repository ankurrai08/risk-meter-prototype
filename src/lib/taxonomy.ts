import taxonomyData from "@/data/taxonomy.json";

export type TaxonomyNode = {
  theme: string;
  l1: string;
  l2: string;
  l3: string | null;
  l4: string | null;
  descriptive_risk_statement: string | null;
  why_it_correlates: string | null;
  example_signals: string | null;
  suggested_playbook: string | null;
  default_threshold_pct: number;
};

export const taxonomy: TaxonomyNode[] = taxonomyData as TaxonomyNode[];

export const themes: string[] = Array.from(new Set(taxonomy.map((t) => t.theme)));

export function nodesForTheme(theme: string): TaxonomyNode[] {
  return taxonomy.filter((t) => t.theme === theme);
}

export function nodeKey(n: { theme: string; l1: string; l2?: string | null }): string {
  return `${n.theme}::${n.l1}`;
}

// A compact representation of the taxonomy for LLM prompt context —
// keeps the model constrained to pre-approved nodes only.
export function taxonomyForPrompt(): string {
  return taxonomy
    .map(
      (t, i) =>
        `${i + 1}. [Theme: ${t.theme}] [L1: ${t.l1}] [L2: ${t.l2}]${t.l3 ? ` [L3: ${t.l3}]` : ""}${
          t.l4 ? ` [L4: ${t.l4}]` : ""
        } — ${t.descriptive_risk_statement ?? t.example_signals ?? ""}`
    )
    .join("\n");
}
