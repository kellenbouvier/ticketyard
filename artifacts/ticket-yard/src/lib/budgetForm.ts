import { costCodesBySection, costCodeByCode } from '@workspace/cost-codes';
import { parseBudgetAmount, type BudgetLineInput } from '@workspace/budget';
import type { BudgetLine } from '@workspace/api-client-react';

// ─── Budget-builder form state ─────────────────────────────────────────────
//
// One unified builder — there is NO method_type. Each cost-code SECTION is a
// block that is either collapsed (a single lump-sum input) or expanded (a
// table of cost-code line rows plus an optional "Additional (non-coded)"
// field that appears only once ≥1 code row exists). The section's shape is
// implied entirely by this state; nothing derived is stored.

export type CodeRow = { key: string; code: string; amount: string };
export type SectionFormState = {
  section: string;
  expanded: boolean;
  /** Lump-sum amount, used only while collapsed. */
  lump: string;
  codeRows: CodeRow[];
  /** Hybrid "Additional [Section] (non-coded)" amount, used only while
   * expanded with ≥1 code row. */
  additional: string;
};

let keyCounter = 0;
export const nextRowKey = () => `cr-${Date.now().toString(36)}-${keyCounter++}`;

export function additionalLabel(section: string): string {
  return `Additional ${section} (non-coded)`;
}

/** The full section skeleton (all cost-code sections, empty amounts) so the
 * builder can be filled fast — used both as the initial state and by the
 * "Load template" affordance. */
export function emptySections(): SectionFormState[] {
  return costCodesBySection().map(({ section }) => ({
    section,
    expanded: false,
    lump: '',
    codeRows: [],
    additional: '',
  }));
}

/** Rebuild form state from the server's saved lines. Coded lines put a
 * section into cost-code mode (expanded); a lone non-coded line is a lump
 * sum (collapsed); coded lines + a non-coded line is a hybrid. */
export function hydrateSections(lines: BudgetLine[]): SectionFormState[] {
  const sections = emptySections();
  const bySection = new Map(sections.map((s) => [s.section, s]));
  // Defensively surface any section not in the current taxonomy.
  for (const line of lines) {
    if (!bySection.has(line.section)) {
      const extra: SectionFormState = {
        section: line.section,
        expanded: false,
        lump: '',
        codeRows: [],
        additional: '',
      };
      bySection.set(line.section, extra);
      sections.push(extra);
    }
  }
  for (const s of sections) {
    const mine = lines.filter((l) => l.section === s.section);
    const coded = mine.filter((l) => l.costCode);
    const nonCoded = mine.filter((l) => !l.costCode);
    const sumNonCoded = () =>
      nonCoded.length === 1
        ? nonCoded[0].amount
        : String(nonCoded.reduce((a, l) => a + parseBudgetAmount(l.amount), 0));
    if (coded.length) {
      s.expanded = true;
      s.codeRows = coded.map((l) => ({ key: nextRowKey(), code: l.costCode as string, amount: l.amount }));
      if (nonCoded.length) s.additional = sumNonCoded();
    } else if (nonCoded.length) {
      s.expanded = false;
      s.lump = sumNonCoded();
    }
  }
  return sections;
}

/** Serialize the builder to the PUT body's lines. Blank amounts and
 * code-less rows are dropped; empty sections simply contribute nothing. */
export function serializeSections(sections: SectionFormState[]): BudgetLineInput[] {
  const lines: BudgetLineInput[] = [];
  for (const s of sections) {
    if (s.expanded) {
      for (const row of s.codeRows) {
        if (!row.code) continue;
        const entry = costCodeByCode(row.code);
        lines.push({
          section: s.section,
          costCode: row.code,
          label: entry?.name ?? row.code,
          amount: row.amount || '0',
        });
      }
      if (s.codeRows.length > 0 && (s.additional ?? '').trim() !== '') {
        lines.push({
          section: s.section,
          costCode: null,
          label: additionalLabel(s.section),
          amount: s.additional,
        });
      }
    } else if ((s.lump ?? '').trim() !== '') {
      lines.push({ section: s.section, costCode: null, label: s.section, amount: s.lump });
    }
  }
  return lines;
}

/** Live per-section subtotal, matching serializeSections semantics so the
 * block header and the grand total always agree. */
export function sectionSubtotal(s: SectionFormState): number {
  if (s.expanded) {
    // Only rows with a selected code are saved (see serializeSections); a
    // code-less row is incomplete, so it must NOT inflate the header subtotal
    // — otherwise the block header and "Current"/grand total disagree and the
    // amount silently vanishes on save.
    const codes = s.codeRows.reduce((sum, r) => sum + (r.code ? parseBudgetAmount(r.amount) : 0), 0);
    return codes + (s.codeRows.length > 0 ? parseBudgetAmount(s.additional) : 0);
  }
  return parseBudgetAmount(s.lump);
}
