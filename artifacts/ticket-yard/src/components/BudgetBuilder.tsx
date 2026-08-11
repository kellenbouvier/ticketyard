import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetJobBudget,
  usePutJobBudget,
  getGetJobBudgetQueryKey,
} from '@workspace/api-client-react';
import { formatCostCode, costCodesBySection } from '@workspace/cost-codes';
import { computeBudgetTotals } from '@workspace/budget';
import {
  ChevronDown,
  ChevronRight,
  Check,
  LayoutTemplate,
  LoaderCircle,
  Plus,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import {
  additionalLabel,
  emptySections,
  hydrateSections,
  nextRowKey,
  sectionSubtotal,
  serializeSections,
  type SectionFormState,
} from '@/lib/budgetForm';

const COST_CODE_SECTIONS = costCodesBySection();
const currency = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// ─── One cost-code SECTION block (lump | codes | hybrid) ────────────────────
function SectionBlock({
  state,
  codes,
  onChange,
}: {
  state: SectionFormState;
  codes: { code: string; name: string }[];
  onChange: (next: SectionFormState) => void;
}) {
  const subtotal = sectionSubtotal(state);
  const usedCodes = new Set(state.codeRows.map((r) => r.code).filter(Boolean));

  const setExpanded = (expanded: boolean) => onChange({ ...state, expanded });
  const addRow = () =>
    onChange({ ...state, expanded: true, codeRows: [...state.codeRows, { key: nextRowKey(), code: '', amount: '' }] });
  const updateRow = (key: string, patch: Partial<{ code: string; amount: string }>) =>
    onChange({ ...state, codeRows: state.codeRows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const removeRow = (key: string) =>
    onChange({ ...state, codeRows: state.codeRows.filter((r) => r.key !== key) });

  return (
    <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(!state.expanded)}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-[hsl(var(--foreground))]"
        >
          {state.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {state.section}
        </button>
        <div className="flex items-center gap-3">
          <span className="font-mono-app text-[12px] font-semibold text-[hsl(var(--primary))]">{currency(subtotal)}</span>
          <button
            type="button"
            onClick={() => setExpanded(!state.expanded)}
            className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary)/.5)] hover:text-[hsl(var(--primary))]"
          >
            {state.expanded ? 'Use Lump Sum' : 'Show Cost Codes'}
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        {!state.expanded ? (
          <label className="flex items-center gap-3 text-[12px]">
            <span className="w-28 shrink-0 text-[hsl(var(--muted-foreground))]">Lump sum</span>
            <input
              className="ticket-field max-w-[200px]"
              inputMode="decimal"
              placeholder="$0.00"
              value={state.lump}
              onChange={(e) => onChange({ ...state, lump: e.target.value })}
            />
          </label>
        ) : (
          <div className="space-y-2">
            {state.codeRows.length === 0 && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">No cost-code lines yet — add one below.</p>
            )}
            {state.codeRows.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <select
                  aria-label={`Cost code for ${state.section}`}
                  className="ticket-field flex-1"
                  value={row.code}
                  onChange={(e) => updateRow(row.key, { code: e.target.value })}
                >
                  <option value="" disabled>
                    Pick a code…
                  </option>
                  {codes.map((c) => (
                    <option key={c.code} value={c.code} disabled={usedCodes.has(c.code) && row.code !== c.code}>
                      {formatCostCode(c.code)}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Amount for ${state.section} ${row.code || 'line'}`}
                  className="ticket-field w-[140px]"
                  inputMode="decimal"
                  placeholder="$0.00"
                  value={row.amount}
                  onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  title="Remove line"
                  className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] transition hover:bg-red-50 hover:text-[hsl(var(--destructive))]"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1.5 rounded-md border border-dashed border-[hsl(var(--primary)/.4)] px-2.5 py-1.5 text-[11px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)/.05)]"
            >
              <Plus size={12} /> Add Cost Code Line
            </button>

            {state.codeRows.length > 0 && (
              <label className="mt-1 flex items-center gap-3 border-t border-[hsl(var(--border)/.6)] pt-2.5 text-[12px]">
                <span className="w-40 shrink-0 text-[hsl(var(--muted-foreground))]">{additionalLabel(state.section)}</span>
                <input
                  className="ticket-field w-[140px]"
                  inputMode="decimal"
                  placeholder="$0.00"
                  value={state.additional}
                  onChange={(e) => onChange({ ...state, additional: e.target.value })}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── The unified budget builder, in a modal ─────────────────────────────────
export function BudgetBuilder({
  jobId,
  jobNumber,
  jobName,
  onClose,
  announce,
}: {
  jobId: number;
  jobNumber: string;
  jobName: string;
  onClose: () => void;
  announce: (msg: string, kind?: 'success' | 'error' | 'info') => void;
}) {
  const qc = useQueryClient();
  const { data: budget, isLoading, isError } = useGetJobBudget(jobId);
  const putBudget = usePutJobBudget();

  const [target, setTarget] = useState('');
  const [sections, setSections] = useState<SectionFormState[]>(() => emptySections());
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (budget && !hydratedRef.current) {
      setTarget(budget.targetAmount && budget.targetAmount !== '0' ? budget.targetAmount : '');
      setSections(hydrateSections(budget.lines));
      hydratedRef.current = true;
    }
  }, [budget]);

  const totals = useMemo(() => computeBudgetTotals(serializeSections(sections), target), [sections, target]);

  const updateSection = useCallback((section: string, next: SectionFormState) => {
    setSections((cur) => cur.map((s) => (s.section === section ? next : s)));
  }, []);

  const loadTemplate = useCallback(() => {
    setSections((cur) => cur.map((s) => ({ ...s, expanded: true })));
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await putBudget.mutateAsync({
        jobId,
        data: { targetAmount: target.trim() || '0', lines: serializeSections(sections) },
      });
      await qc.invalidateQueries({ queryKey: getGetJobBudgetQueryKey(jobId) });
      announce(`Budget saved for ${jobNumber}.`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      announce(msg.includes('400') ? 'Budget rejected: check the cost codes.' : 'Could not save the budget. Try again.', 'error');
    }
  }, [announce, jobId, jobNumber, onClose, putBudget, qc, sections, target]);

  const remainingTone =
    totals.remaining > 0
      ? 'text-[hsl(var(--muted-foreground))]'
      : totals.remaining < 0
        ? 'text-[hsl(var(--destructive))]'
        : 'text-emerald-600';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="my-6 w-full max-w-[720px] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border))] bg-white px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]">
              <Wallet size={18} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold tracking-tight">Job Budget</h2>
              <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="font-mono-app font-semibold text-[hsl(var(--primary))]">{jobNumber}</span> · {jobName}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]">
            <X size={16} />
          </button>
        </div>

        {/* Live target / current / remaining bar */}
        <div className="grid grid-cols-3 gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-6 py-3.5">
          <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
              <Target size={11} /> Target
            </span>
            <input
              className="ticket-field font-mono-app"
              inputMode="decimal"
              placeholder="$0.00"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Current</span>
            <span className="font-mono-app text-[15px] font-bold text-[hsl(var(--foreground))]">{currency(totals.grandTotal)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
              {totals.remaining < 0 ? 'Over Target' : 'Remaining'}
            </span>
            <span className={`font-mono-app text-[15px] font-bold ${remainingTone}`}>{currency(Math.abs(totals.remaining))}</span>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[52vh] space-y-2.5 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div className="flex items-center gap-2 py-6 text-[12px] text-[hsl(var(--muted-foreground))]">
              <LoaderCircle size={14} className="animate-spin" /> Loading budget…
            </div>
          )}
          {isError && (
            <p className="py-2 text-[12px] text-[hsl(var(--destructive))]">Could not load the saved budget. Starting fresh.</p>
          )}
          {!isLoading &&
            sections.map((s) => {
              const codes = COST_CODE_SECTIONS.find((c) => c.section === s.section)?.codes ?? [];
              return <SectionBlock key={s.section} state={s} codes={codes} onChange={(next) => updateSection(s.section, next)} />;
            })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] bg-white px-6 py-3.5">
          <button
            type="button"
            onClick={loadTemplate}
            className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-3 py-2 text-[12px] font-semibold transition hover:border-[hsl(var(--primary)/.5)] hover:bg-[hsl(var(--primary)/.04)]"
          >
            <LayoutTemplate size={13} /> Expand All
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-[12px] font-semibold transition hover:bg-[hsl(var(--muted))]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={putBudget.isPending || isLoading}
              className="flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-50"
            >
              {putBudget.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />} Save Budget
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}