export type RawInteraction = {
  interaction_id: string;
  type: string;
  date: string;
  root_cause: string;
};

export type NormalizedRootCause = {
  canonical_statement: string;
  key_phrase: string;
  entities: string[];
};

export type TaxonomyTag = {
  theme: string;
  l1: string;
  l2: string;
  l3: string | null;
  l4: string | null;
  confidence: number; // 0-1
  rationale: string;
};

export type TaggedInteraction = RawInteraction & {
  normalized: NormalizedRootCause;
  tag: TaxonomyTag;
  needs_review: boolean; // confidence below review floor
};

export const REVIEW_CONFIDENCE_FLOOR = 0.6;
