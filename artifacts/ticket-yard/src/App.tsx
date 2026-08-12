import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  useHealthCheck,
  useExtractTicket,
  useListYears,
  useCreateYear,
  useDeleteYear,
  useListJobs,
  useCreateJob,
  useUpdateJob,
  useDeleteJob,
  useListTickets,
  useCreateTicketRecord,
  useUpdateTicketRecord,
  useDeleteTicketRecord,
  useLogin,
  useLogout,
  useGetCurrentUser,
  getListYearsQueryKey,
  getListJobsQueryKey,
  getGetCurrentUserQueryKey,
} from '@workspace/api-client-react';
import type {
  Year,
  Job,
  TicketExtraction,
  TicketExtractionInput,
  TicketRecord,
  WasteCategory,
} from '@workspace/api-client-react';
import { costCodesBySection, formatCostCode, isLandfillCostCode } from '@workspace/cost-codes';
import {
  DIVERSION_MATERIALS,
  DIVERTED_MATERIALS,
  computeDiversion,
  buildLeedWorkbookModel,
  type DiversionMaterial,
} from '@workspace/diversion';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  CalendarDays,
  Check,
  ChevronRight,
  CircleX,
  ClipboardList,
  CloudUpload,
  ExternalLink,
  FileImage,
  FileSpreadsheet,
  Filter,
  Recycle,
  HardHat,
  Home,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UploadCloud,
  User,
  Wallet,
  X,
  ZoomIn,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { parseTonnage, formatTons } from '@/lib/tonnage';
import { computeCostCodeTotals } from '@/lib/costCodeTotals';
import { BudgetBuilder } from '@/components/BudgetBuilder';
import {
  COST_CODE_FILTER_ALL,
  COST_CODE_FILTER_UNASSIGNED,
  filterRowsByCostCode,
  filterCostCodeTotals,
  type CostCodeFilter,
} from '@/lib/costCodeFilter';

const queryClient = new QueryClient();

// ─── Row / extraction types ───────────────────────────────────────────────────

type RowStatus = 'Reading' | 'Processed' | 'Failed' | 'Manual';
// Waste category and cost code are each edited through their own dedicated
// selector (never a free-text input — see WASTE_CATEGORY_OPTIONS and
// COST_CODE_SECTIONS below), so they're handled by separate onCategoryChange
// / onCostCodeChange callbacks rather than the generic string-field
// FieldKey/onChange path the other fields share.
type RowExtraction = Omit<TicketExtraction, 'wasteCategory' | 'costCode' | 'diversionMaterial'> & {
  // Null only for rows restored from a legacy record that no vendor rule
  // could confidently classify — "needs review", never guessed.
  wasteCategory: WasteCategory | null;
  // The PRIMARY classification for the ticket (DHG's accounting "Cat"
  // column). Null means "needs review" — never a guessed value, even for a
  // freshly-created row (unlike wasteCategory, there is no safe default).
  costCode: string | null;
  // LEED Waste & Scrap Diversion material — independent of wasteCategory and
  // the budget module. Its own dedicated selector; null = "needs review".
  // Kept as string|null (mirroring costCode) so the raw server extraction
  // assigns cleanly; validated against the known list server-side.
  diversionMaterial: string | null;
};
type FieldKey = keyof Omit<TicketExtraction, 'wasteCategory' | 'costCode' | 'diversionMaterial'>;
type TicketRow = {
  id: string;
  /** DB id once this row has been persisted; undefined while a fresh
   * upload is still being read (Reading) or if persisting it failed. */
  serverId?: number;
  /** True only for a row created from a just-uploaded file in this
   * session — the source image itself is not persisted, so a row
   * restored after reload has no real image to retry OCR against. */
  hasSourceImage: boolean;
  fileName: string;
  preview: string;
  status: RowStatus;
  extraction: RowExtraction;
  error?: string;
};

// D.H. Griffin tracks disposal cost, hauling cost, billing, and
// profitability separately for these two categories — they must never be
// summed or displayed as one blended "waste" figure anywhere in the app.
const WASTE_CATEGORY_LABELS: Record<WasteCategory, string> = {
  'C&D': 'C&D Landfill',
  Inert: 'Inert / Concrete Recycling',
};
const WASTE_CATEGORY_OPTIONS: WasteCategory[] = ['C&D', 'Inert'];

// The waste C&D/Inert category is only meaningful for landfill /
// inert-landfill tickets. A ticket is treated as a landfill ticket when it
// carries a landfill (05-xxx) cost code, already has a category set (protects
// existing categorized rows), or its vendor is a known landfill / disposal /
// inert-recycling vendor. Mirrors the server-side classifyWasteCategory()
// vendor rules so the UI and API agree on which tickets need a category.
const LANDFILL_VENDOR_RE =
  /landfill|disposal|waste\s+management|\bwm\b|metro\s+green|vulcan\s+materials|willow\s+oak/i;
function isLandfillTicket(ex: Pick<RowExtraction, 'costCode' | 'wasteCategory' | 'vendor'>): boolean {
  if (isLandfillCostCode(ex.costCode)) return true;
  if (ex.wasteCategory != null) return true;
  const vendor = (ex.vendor ?? '').trim();
  return vendor ? LANDFILL_VENDOR_RE.test(vendor) : false;
}

function ticketRecordToRow(record: TicketRecord): TicketRow {
  return {
    id: `saved-${record.id}`,
    serverId: record.id,
    hasSourceImage: false,
    fileName: record.fileName,
    preview: samplePreview(record.status === 'Manual' ? 'MANUAL ENTRY' : 'SAVED RECORD'),
    status: record.status,
    error: record.error ?? undefined,
    extraction: {
      documentType: record.documentType as TicketExtraction['documentType'],
      vendor: record.vendor,
      ticketNumber: record.ticketNumber,
      invoiceNumber: record.invoiceNumber,
      purchaseOrder: record.purchaseOrder,
      jobNumber: record.jobNumber,
      date: record.date,
      weight: record.weight,
      amount: record.amount,
      description: record.description,
      wasteCategory: record.wasteCategory,
      costCode: record.costCode,
      diversionMaterial: record.diversionMaterial,
    },
  };
}

const emptyExtraction: RowExtraction = {
  documentType: 'ticket',
  vendor: '',
  ticketNumber: '',
  invoiceNumber: '',
  purchaseOrder: '',
  jobNumber: '',
  date: '',
  weight: '',
  amount: '',
  description: '',
  // No auto-default: the C&D/Inert category only applies to landfill /
  // inert-landfill tickets, so a fresh manual row starts null (shown as
  // "N/A" for a non-landfill ticket, "Needs review" once it looks like a
  // landfill ticket). Always user-overridable.
  wasteCategory: null,
  // Unlike wasteCategory there is no safe default cost code — a fresh
  // manual row always starts "needs review" until a vendor rule fires (see
  // suggestCostCode() server-side) or the user picks one.
  costCode: null,
  // No safe default — a fresh row starts "needs review" until a vendor rule
  // fires (suggestDiversionMaterial() server-side) or the user picks one.
  diversionMaterial: null,
};

// Static — computed once from the shared taxonomy, not per-render.
const COST_CODE_SECTIONS = costCodesBySection();

const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const fields: { key: FieldKey; label: string; short: string }[] = [
  { key: 'vendor', label: 'Vendor', short: 'Vendor' },
  { key: 'ticketNumber', label: 'Ticket no.', short: 'Ticket no.' },
  { key: 'invoiceNumber', label: 'Invoice no.', short: 'Invoice no.' },
  { key: 'purchaseOrder', label: 'Purchase Order', short: 'PO' },
  { key: 'jobNumber', label: 'Job Number', short: 'Job no.' },
  { key: 'date', label: 'Date', short: 'Date' },
  { key: 'weight', label: 'Weight', short: 'Weight' },
  { key: 'amount', label: 'Amount', short: 'Amount' },
  { key: 'description', label: 'Description', short: 'Description' },
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function getSupportedMediaType(file: File): TicketExtractionInput['mediaType'] | null {
  if (acceptedTypes.includes(file.type)) return file.type as TicketExtractionInput['mediaType'];
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return null;
}

function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('Could not read this image file.'));
    reader.readAsDataURL(file);
  });
}

const samplePreview = (label: string = 'MANUAL ENTRY') =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="700" height="460" viewBox="0 0 700 460">
      <rect width="700" height="460" fill="#e8e8e8"/>
      <g transform="translate(104 30) rotate(-4 250 195)">
        <rect width="500" height="390" rx="3" fill="#f9f9f9"/>
        <rect x="24" y="24" width="452" height="55" fill="#C32020" opacity=".9"/>
        <path d="M28 111h430M28 145h350M28 179h408M28 240h430M28 274h390M28 308h240" stroke="#252b36" stroke-width="7" opacity=".4"/>
        <text x="28" y="360" font-family="monospace" font-size="13" fill="#888">${label}</text>
      </g>
    </svg>
  `)}`;

// ─── Shared header ────────────────────────────────────────────────────────────

function ApiStatus({ theme = 'dark' }: { theme?: 'dark' | 'light' }) {
  const { isLoading, isError } = useHealthCheck();
  return (
    <div className={`hidden items-center gap-2 text-[11px] sm:flex ${theme === 'dark' ? 'text-white/50' : 'text-[hsl(var(--muted-foreground))]'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isLoading ? 'bg-yellow-400' : isError ? 'bg-red-400' : 'bg-emerald-400'}`} />
      {isLoading ? 'Checking…' : isError ? 'Service unavailable' : 'Local OCR ready'}
    </div>
  );
}

function AppHeader({ children, trailing }: { children?: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <header className="flex h-[54px] shrink-0 items-center gap-4 border-b border-white/[.07] bg-[hsl(var(--sidebar))] px-5 md:px-7">
      {/* Logo + app name */}
      <div className="flex items-center gap-3 shrink-0">
        <img src="/dhg-logo.png" alt="D.H. Griffin Companies" className="h-7 w-auto" />
        <div className="h-4 w-px bg-white/20" />
        <span className="text-[13px] font-semibold tracking-wide text-white/90">DHG Register</span>
      </div>
      {/* Middle slot (breadcrumbs etc.) */}
      {children && <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">{children}</div>}
      {/* Right slot */}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <ApiStatus />
        {trailing ?? (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--sidebar-primary)/.2)] border border-[hsl(var(--sidebar-primary)/.35)] text-[hsl(var(--sidebar-primary))]">
            <User size={15} strokeWidth={1.75} />
          </div>
        )}
      </div>
    </header>
  );
}

// ─── Shared UI primitives ──────────────────────────────────────────────────────

function StatusPill({ status }: { status: RowStatus }) {
  const styles: Record<RowStatus, string> = {
    Reading: 'bg-amber-50 text-amber-700 border border-amber-200',
    Processed: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    Failed: 'bg-red-50 text-red-700 border border-red-200',
    Manual: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[status]}`}>
      {status === 'Reading' && <LoaderCircle size={10} className="animate-spin" />}
      {status === 'Processed' && <Check size={10} strokeWidth={2.5} />}
      {status === 'Failed' && <CircleX size={10} />}
      {status}
    </span>
  );
}

function StatCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'red' | 'slate' | 'ink' }) {
  const toneClass =
    tone === 'red' ? 'text-[hsl(var(--primary))]' :
    tone === 'slate' ? 'text-[hsl(var(--accent))]' :
    'text-[hsl(var(--foreground))]';
  const dotClass =
    tone === 'red' ? 'bg-[hsl(var(--primary))]' :
    tone === 'slate' ? 'bg-[hsl(var(--accent))]' :
    'bg-[hsl(var(--foreground)/.4)]';
  return (
    <div className="rounded-lg border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-4 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      </div>
      <div className={`text-[1.75rem] font-bold tracking-tight ${toneClass}`}>{value}</div>
      <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{detail}</div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-2xl animate-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function PreviewModal({ row, onClose }: { row: TicketRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade" onClick={onClose}>
      <div className="relative w-full max-w-3xl overflow-hidden rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-2xl animate-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-3.5">
          <div>
            <div className="text-[13px] font-semibold">{row.fileName}</div>
            <div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Source ticket preview</div>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={16} /></button>
        </div>
        <div className="bg-[hsl(var(--muted)/.5)] p-5">
          <img src={row.preview} alt={`Preview of ${row.fileName}`} className="mx-auto max-h-[65vh] w-auto max-w-full rounded-lg object-contain shadow-lg" />
        </div>
      </div>
    </div>
  );
}

function Notice({ notice }: { notice: { message: string; kind: 'success' | 'error' | 'info' } }) {
  const styles = {
    error: 'border-red-200 bg-white text-red-700',
    info: 'border-[hsl(var(--border))] bg-white text-[hsl(var(--foreground))]',
    success: 'border-emerald-200 bg-white text-emerald-700',
  };
  return (
    <div aria-live="polite" className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-4 py-2.5 text-[12px] font-semibold shadow-xl animate-rise ${styles[notice.kind]}`}>
      {notice.kind === 'error' ? <AlertTriangle size={14} /> : notice.kind === 'info' ? <LoaderCircle size={14} className={notice.message.includes('…') ? 'animate-spin' : ''} /> : <Check size={14} />}
      {notice.message}
    </div>
  );
}

// ─── Shared form input ────────────────────────────────────────────────────────

function FormInput({ label, sublabel, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; sublabel?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
        {label}{sublabel && <span className="ml-1 font-normal normal-case opacity-60">{sublabel}</span>}
      </label>
      <input {...props} className="w-full rounded-md border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[hsl(var(--primary)/.6)] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]" />
    </div>
  );
}

// ─── Login / auth gate ─────────────────────────────────────────────────────────

function LoginPage() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const login = useLogin();
  // Already-authenticated users who land on /login directly (e.g. via
  // back/forward navigation) go straight back to the app.
  const { data: currentUser } = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login.mutateAsync({ data: { username, password } });
      await qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      setLocation('/');
    } catch {
      // Deliberately generic — never hint whether the username or the
      // password was the one that didn't match.
      setError('Invalid username or password.');
    }
  }, [login, password, qc, setLocation, username]);

  if (currentUser) {
    return <Redirect to="/" />;
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/dhg-logo.png" alt="D.H. Griffin Companies" className="h-12 w-auto" />
          <h1 className="mt-4 text-[1.2rem] font-bold tracking-tight text-[hsl(var(--foreground))]">DHG Register</h1>
          <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">Sign in to continue.</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <FormInput
            label="Username"
            autoFocus
            autoComplete="username"
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(''); }}
          />
          <FormInput
            label="Password"
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
          />
          {error && <p className="text-[12px] text-[hsl(var(--destructive))]">{error}</p>}
          <button
            type="submit"
            disabled={login.isPending || !username || !password}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[hsl(var(--primary)/.9)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {login.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
            Sign In
          </button>
        </form>
        <p className="mt-5 text-center text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">D.H. Griffin Companies — DHG Register</p>
      </div>
    </div>
  );
}

/** Gates app content behind a valid session. Mounted around every real
 * route except /login itself; an unauthenticated visitor is redirected to
 * an actual /login URL (not just a swapped-in component) so browser
 * navigation, bookmarking, and back/forward behave normally. The API
 * independently verifies the session cookie on every request regardless
 * of what the client renders. */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))]">
        <LoaderCircle size={22} className="animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  if (isError || !data) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

// ─── Home screen — year tabs + job list ───────────────────────────────────────

type AddYearModal = { open: true; value: string; error: string } | { open: false };
type JobModal =
  | { open: false }
  | { open: true; mode: 'add'; jobNumber: string; jobName: string; error: string }
  | { open: true; mode: 'edit'; job: Job; jobNumber: string; jobName: string; error: string };

// Sub-component — mounted only when a year is selected, so useListJobs is called safely
function JobPanel({
  year,
  onSelectJob,
  announce,
}: {
  year: Year;
  onSelectJob: (job: Job) => void;
  announce: (msg: string, kind?: 'success' | 'error' | 'info') => void;
}) {
  const qc = useQueryClient();
  const { data: jobs = [], isLoading, isError } = useListJobs(year.id);
  const createJob = useCreateJob();
  const updateJob = useUpdateJob();
  const deleteJob = useDeleteJob();

  const [modal, setModal] = useState<JobModal>({ open: false });
  const [query, setQuery] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: getListJobsQueryKey(year.id) });

  const handleSaveJob = async () => {
    if (!modal.open) return;
    const num = modal.jobNumber.trim();
    const name = modal.jobName.trim();
    if (!num) { setModal({ ...modal, error: 'Job Number is required.' }); return; }
    if (!name) { setModal({ ...modal, error: 'Job Name is required.' }); return; }
    try {
      if (modal.mode === 'add') {
        await createJob.mutateAsync({ yearId: year.id, data: { jobNumber: num, jobName: name } });
        announce(`Job ${num} added.`);
      } else {
        await updateJob.mutateAsync({ yearId: year.id, jobId: modal.job.id, data: { jobNumber: num, jobName: name } });
        announce(`Job ${num} updated.`);
      }
      await invalidate();
      setModal({ open: false });
    } catch {
      setModal({ ...modal, error: 'Could not save job. Try again.' });
    }
  };

  const handleDeleteJob = async (job: Job) => {
    if (!window.confirm(`Remove job ${job.jobNumber} – ${job.jobName}?\n\nThis cannot be undone.`)) return;
    try {
      await deleteJob.mutateAsync({ yearId: year.id, jobId: job.id });
      await invalidate();
      announce(`${job.jobNumber} removed.`, 'info');
    } catch {
      announce('Could not remove job. Try again.', 'error');
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = jobs.filter((j) => !q || j.jobNumber.toLowerCase().includes(q) || j.jobName.toLowerCase().includes(q));

  return (
    <>
      {/* Search + Add Job bar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            type="search"
            placeholder="Search by job number or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-[hsl(var(--border))] bg-white py-2 pl-9 pr-4 text-sm outline-none transition focus:border-[hsl(var(--primary)/.5)] focus:ring-2 focus:ring-[hsl(var(--primary)/.1)]"
          />
        </div>
        <button
          onClick={() => setModal({ open: true, mode: 'add', jobNumber: '', jobName: '', error: '' })}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[hsl(var(--primary)/.9)] active:scale-95"
        >
          <Plus size={14} /> Add Job
        </button>
      </div>

      {/* Job table */}
      <div className="overflow-hidden rounded-lg border border-[hsl(var(--card-border))] bg-white shadow-sm">
        {/* Table head */}
        <div className="grid grid-cols-[1fr_3fr_90px] border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.6)] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
          <div>Job Number</div>
          <div>Job Name</div>
          <div className="text-right">Actions</div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-14">
            <LoaderCircle size={20} className="animate-spin text-[hsl(var(--primary))]" />
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center py-12 text-center">
            <AlertTriangle size={20} className="text-[hsl(var(--destructive))]" />
            <p className="mt-2 text-sm text-[hsl(var(--destructive))]">Could not load jobs.</p>
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center py-14 text-center">
            <Briefcase size={22} className="text-[hsl(var(--muted-foreground))]" />
            <p className="mt-3 text-[13px] font-semibold text-[hsl(var(--foreground))]">
              {q ? `No jobs match "${query}"` : `No jobs for ${year.year} yet`}
            </p>
            {!q && (
              <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">Add your first job to get started.</p>
            )}
          </div>
        )}

        {filtered.map((job) => (
          <div
            key={job.id}
            className="job-row group grid grid-cols-[1fr_3fr_90px] items-center border-t border-[hsl(var(--border)/.7)] px-5 py-3.5 transition hover:bg-[hsl(var(--muted)/.35)]"
          >
            <button className="flex min-w-0 items-center text-left" onClick={() => onSelectJob(job)}>
              <span className="font-mono-app text-[11px] font-bold tracking-wider text-[hsl(var(--primary))]">{job.jobNumber}</span>
            </button>
            <button className="flex min-w-0 items-center gap-3 pr-4 text-left" onClick={() => onSelectJob(job)}>
              <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">{job.jobName}</span>
              <ChevronRight size={14} className="ml-auto shrink-0 text-[hsl(var(--muted-foreground))] opacity-0 transition group-hover:opacity-100" />
            </button>
            <div className="flex items-center justify-end gap-0.5">
              <button
                onClick={() => setModal({ open: true, mode: 'edit', job, jobNumber: job.jobNumber, jobName: job.jobName, error: '' })}
                title="Edit"
                className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] opacity-0 transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] group-hover:opacity-100"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => void handleDeleteJob(job)}
                title="Remove"
                className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] opacity-0 transition hover:bg-red-50 hover:text-[hsl(var(--destructive))] group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit job modal */}
      {modal.open && (
        <Modal title={modal.mode === 'add' ? 'Add Job' : 'Edit Job'} onClose={() => setModal({ open: false })}>
          <div className="space-y-4">
            <FormInput
              label="Job Number"
              sublabel="(##-##-####)"
              autoFocus
              type="text"
              value={modal.jobNumber}
              placeholder="e.g. 26-25-1325"
              onChange={(e) => setModal({ ...modal, jobNumber: e.target.value, error: '' })}
              onKeyDown={(e) => e.key === 'Enter' && void handleSaveJob()}
            />
            <FormInput
              label="Job Name"
              type="text"
              value={modal.jobName}
              placeholder="e.g. DH Griffin – Lovett STEM Academy"
              onChange={(e) => setModal({ ...modal, jobName: e.target.value, error: '' })}
              onKeyDown={(e) => e.key === 'Enter' && void handleSaveJob()}
            />
            {modal.error && <p className="text-[12px] text-[hsl(var(--destructive))]">{modal.error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setModal({ open: false })} className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-[12px] font-semibold transition hover:bg-[hsl(var(--muted))]">Cancel</button>
              <button
                onClick={() => void handleSaveJob()}
                disabled={createJob.isPending || updateJob.isPending}
                className="flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-50"
              >
                {(createJob.isPending || updateJob.isPending) ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}
                {modal.mode === 'add' ? 'Add Job' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── Year card with live job count ───────────────────────────────────────────

function YearCardWidget({ year, isSelected, onSelect, onDelete }: {
  year: Year; isSelected: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const { data: jobs = [], isLoading: countLoading } = useListJobs(year.id);
  return (
    <div className="group relative shrink-0">
      <button
        onClick={onSelect}
        className={`relative flex w-[158px] flex-col rounded-xl border bg-white px-6 py-5 text-left shadow-sm transition hover:shadow-md ${
          isSelected
            ? 'border-[hsl(var(--primary)/.4)] shadow-md'
            : 'border-[hsl(var(--card-border))] hover:border-[hsl(var(--primary)/.3)]'
        }`}
      >
        {/* Active: red bottom accent bar */}
        {isSelected && (
          <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-xl bg-[hsl(var(--primary))]" />
        )}
        {/* Calendar icon */}
        <CalendarDays
          size={26}
          strokeWidth={1.5}
          className={isSelected ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground)/.6)]'}
        />
        {/* Year number */}
        <div className={`mt-3 text-[2.6rem] font-bold leading-none tracking-tight ${
          isSelected ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'
        }`}>
          {year.year}
        </div>
        {/* Job count */}
        <div className="mt-2 text-[12px] text-[hsl(var(--muted-foreground))]">
          {countLoading ? '…' : `${jobs.length} ${jobs.length === 1 ? 'Job' : 'Jobs'}`}
        </div>
        {/* Arrow */}
        <div className="mt-5">
          <ArrowRight
            size={18}
            className={isSelected ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground)/.5)]'}
          />
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title={`Remove ${year.year}`}
        className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--destructive))] text-white shadow group-hover:flex"
      >
        <X size={9} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// ─── Sidebar recent jobs ──────────────────────────────────────────────────────

function SidebarRecentJobs({ yearId, onOpen }: { yearId: number; onOpen: (job: Job) => void }) {
  const { data: jobs = [] } = useListJobs(yearId);
  const recent = jobs.slice(0, 3);
  if (!recent.length) return null;
  return (
    <div className="px-3 mt-5">
      <div className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[.14em] text-white/30">Recent Jobs</div>
      <div className="space-y-0.5">
        {recent.map((job) => (
          <button
            key={job.id}
            onClick={() => onOpen(job)}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-[hsl(var(--sidebar-accent))]"
          >
            <CalendarDays size={13} className="mt-0.5 shrink-0 text-white/30" />
            <div className="min-w-0">
              <div className="font-mono-app text-[10px] font-bold text-[hsl(var(--sidebar-primary))]">{job.jobNumber}</div>
              <div className="truncate text-[10px] leading-4 text-white/40">{job.jobName}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Recent Activity Panel (dashboard job table with full CRUD) ───────────────

function RecentActivityPanel({ year, onOpen, announce }: {
  year: Year;
  onOpen: (job: Job) => void;
  announce: (msg: string, kind?: 'success' | 'error' | 'info') => void;
}) {
  const qc = useQueryClient();
  const { data: jobs = [], isLoading, isError } = useListJobs(year.id);
  const createJob = useCreateJob();
  const updateJob = useUpdateJob();
  const deleteJob = useDeleteJob();
  const [modal, setModal] = useState<JobModal>({ open: false });
  // After a job is created, immediately open its budget builder — building a
  // budget is part of the create-a-job flow (one unified interface).
  const [budgetJob, setBudgetJob] = useState<Job | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListJobsQueryKey(year.id) });

  const handleSaveJob = async () => {
    if (!modal.open) return;
    const num = modal.jobNumber.trim();
    const name = modal.jobName.trim();
    if (!num) { setModal({ ...modal, error: 'Job Number is required.' }); return; }
    if (!name) { setModal({ ...modal, error: 'Job Name is required.' }); return; }
    try {
      if (modal.mode === 'add') {
        const created = await createJob.mutateAsync({ yearId: year.id, data: { jobNumber: num, jobName: name } });
        announce(`Job ${num} added.`);
        await invalidate();
        setModal({ open: false });
        setBudgetJob(created as unknown as Job);
        return;
      } else {
        await updateJob.mutateAsync({ yearId: year.id, jobId: modal.job.id, data: { jobNumber: num, jobName: name } });
        announce(`Job ${num} updated.`);
      }
      await invalidate();
      setModal({ open: false });
    } catch {
      setModal({ ...modal, error: 'Could not save job. Try again.' });
    }
  };

  const handleDeleteJob = async (job: Job) => {
    if (!window.confirm(`Remove job ${job.jobNumber} – ${job.jobName}?\n\nThis cannot be undone.`)) return;
    try {
      await deleteJob.mutateAsync({ yearId: year.id, jobId: job.id });
      await invalidate();
      announce(`${job.jobNumber} removed.`, 'info');
    } catch {
      announce('Could not remove job. Try again.', 'error');
    }
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-[hsl(var(--card-border))] bg-white shadow-sm">
        {/* Panel action bar */}
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-6 py-3">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} in {year.year}
          </span>
          <button
            onClick={() => setModal({ open: true, mode: 'add', jobNumber: '', jobName: '', error: '' })}
            className="flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[hsl(var(--primary)/.9)] active:scale-95"
          >
            <Plus size={13} /> Add Job
          </button>
        </div>

        {/* Table column headers */}
        <div className="grid grid-cols-[40px_180px_1fr_160px_90px_100px] items-center gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)] px-6 py-2.5 text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
          <div />
          <div>Job Number</div>
          <div>Job Name</div>
          <div>Created</div>
          <div className="text-right">Records</div>
          <div />
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-14">
            <LoaderCircle size={20} className="animate-spin text-[hsl(var(--primary))]" />
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-[hsl(var(--destructive))]">
            <AlertTriangle size={16} /> Could not load jobs.
          </div>
        )}
        {!isLoading && !isError && jobs.length === 0 && (
          <div className="flex flex-col items-center py-14 text-center">
            <Briefcase size={24} className="text-[hsl(var(--muted-foreground)/.5)]" />
            <p className="mt-3 text-[13px] font-semibold">No jobs for {year.year}</p>
            <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">Add your first job to get started.</p>
          </div>
        )}

        {jobs.map((job) => (
          <div
            key={job.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(job)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(job); } }}
            className="group grid cursor-pointer grid-cols-[1fr_auto] items-center gap-3 border-t border-[hsl(var(--border)/.5)] px-4 py-3.5 transition hover:bg-[hsl(var(--muted)/.25)] md:grid-cols-[40px_180px_1fr_160px_90px_100px] md:gap-4 md:px-6"
          >
            <div className="hidden items-center justify-center md:flex">
              <CalendarDays size={15} className="text-[hsl(var(--muted-foreground)/.45)]" />
            </div>
            {/* Mobile: job number + name stacked in one tap cell; desktop: separate columns */}
            <div className="min-w-0 md:contents">
              <div className="md:flex md:items-center">
                <span className="font-mono-app text-[11px] font-bold tracking-wider text-[hsl(var(--primary))]">
                  {job.jobNumber}
                </span>
              </div>
              <div className="min-w-0 truncate text-[13px] text-[hsl(var(--foreground))]">{job.jobName}</div>
            </div>
            <div className="hidden text-[12px] text-[hsl(var(--muted-foreground))] md:block">—</div>
            <div className="hidden text-right font-mono-app text-[12px] text-[hsl(var(--muted-foreground))] md:block">—</div>
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); setModal({ open: true, mode: 'edit', job, jobNumber: job.jobNumber, jobName: job.jobName, error: '' }); }}
                title="Edit"
                className="rounded p-1.5 text-[hsl(var(--muted-foreground))] opacity-100 transition hover:text-[hsl(var(--foreground))] md:opacity-0 md:group-hover:opacity-100"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void handleDeleteJob(job); }}
                title="Delete"
                className="rounded p-1.5 text-[hsl(var(--muted-foreground))] opacity-100 transition hover:text-[hsl(var(--destructive))] md:opacity-0 md:group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setBudgetJob(job); }}
                title="Budget"
                className="rounded p-1.5 text-[hsl(var(--muted-foreground))] opacity-100 transition hover:text-[hsl(var(--primary))] md:opacity-0 md:group-hover:opacity-100"
              >
                <Wallet size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onOpen(job); }}
                className="shrink-0 rounded border border-[hsl(var(--primary)/.5)] px-3 py-1 text-[11px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary))] hover:text-white"
              >
                Open
              </button>
            </div>
          </div>
        ))}

        {/* View All Jobs footer */}
        {jobs.length > 0 && (
          <div className="flex justify-center border-t border-[hsl(var(--border))] py-4">
            <button className="flex items-center gap-2 rounded-md border border-[hsl(var(--primary)/.4)] px-5 py-1.5 text-[12px] font-semibold text-[hsl(var(--primary))] transition hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.05)]">
              <ExternalLink size={13} /> View All Jobs
            </button>
          </div>
        )}
      </div>

      {/* Add / Edit job modal */}
      {modal.open && (
        <Modal title={modal.mode === 'add' ? 'Add Job' : 'Edit Job'} onClose={() => setModal({ open: false })}>
          <div className="space-y-4">
            <FormInput
              label="Job Number" sublabel="(##-##-####)" autoFocus type="text"
              value={modal.jobNumber} placeholder="e.g. 26-25-1325"
              onChange={(e) => setModal({ ...modal, jobNumber: e.target.value, error: '' })}
              onKeyDown={(e) => e.key === 'Enter' && void handleSaveJob()}
            />
            <FormInput
              label="Job Name" type="text"
              value={modal.jobName} placeholder="e.g. DH Griffin – Lovett STEM Academy"
              onChange={(e) => setModal({ ...modal, jobName: e.target.value, error: '' })}
              onKeyDown={(e) => e.key === 'Enter' && void handleSaveJob()}
            />
            {modal.error && <p className="text-[12px] text-[hsl(var(--destructive))]">{modal.error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setModal({ open: false })} className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-[12px] font-semibold transition hover:bg-[hsl(var(--muted))]">Cancel</button>
              <button
                onClick={() => void handleSaveJob()}
                disabled={createJob.isPending || updateJob.isPending}
                className="flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-50"
              >
                {(createJob.isPending || updateJob.isPending) ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}
                {modal.mode === 'add' ? 'Add Job' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {budgetJob && (
        <BudgetBuilder
          jobId={budgetJob.id}
          jobNumber={budgetJob.jobNumber}
          jobName={budgetJob.jobName}
          announce={announce}
          onClose={() => setBudgetJob(null)}
        />
      )}
    </>
  );
}

// ─── Home screen ──────────────────────────────────────────────────────────────

function HomeScreen({ onSelect }: { onSelect: (year: Year, job: Job) => void }) {
  const qc = useQueryClient();
  const { data: years = [], isLoading: yearsLoading, isError: yearsError } = useListYears();
  const createYear = useCreateYear();
  const deleteYear = useDeleteYear();
  const logout = useLogout();
  const handleLogout = useCallback(() => {
    void logout.mutateAsync().finally(() => qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }));
  }, [logout, qc]);

  const [selectedYear, setSelectedYear] = useState<Year | null>(null);
  const [yearModal, setYearModal] = useState<AddYearModal>({ open: false });
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' | 'info' } | null>(null);

  const announce = useCallback((message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    setNotice({ message, kind });
    setTimeout(() => setNotice((c) => c?.message === message ? null : c), 3600);
  }, []);

  // Auto-select most recent year; keep selected year in sync when list changes
  useEffect(() => {
    if (!years.length) return;
    const sorted = [...years].sort((a, b) => b.year - a.year);
    setSelectedYear((prev) => {
      if (!prev) return sorted[0];
      return years.find((y) => y.id === prev.id) ?? sorted[0];
    });
  }, [years]);

  const sortedYears = useMemo(() => [...years].sort((a, b) => b.year - a.year), [years]);

  const handleAddYear = async () => {
    if (!yearModal.open) return;
    const y = parseInt(yearModal.value, 10);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      setYearModal({ ...yearModal, error: 'Enter a valid year (e.g. 2026).' });
      return;
    }
    try {
      const created = await createYear.mutateAsync({ data: { year: y } });
      await qc.invalidateQueries({ queryKey: getListYearsQueryKey() });
      setYearModal({ open: false });
      // Select the newly created year
      setSelectedYear(created as unknown as Year);
      announce(`${y} added.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setYearModal({ ...yearModal, error: msg.includes('409') || msg.includes('already') ? `${y} already exists.` : 'Could not add year. Try again.' });
    }
  };

  const handleDeleteYear = async (year: Year) => {
    if (!window.confirm(`Remove ${year.year} and all its jobs? This cannot be undone.`)) return;
    try {
      await deleteYear.mutateAsync({ yearId: year.id });
      await qc.invalidateQueries({ queryKey: getListYearsQueryKey() });
      announce(`${year.year} removed.`, 'info');
    } catch {
      announce('Could not remove year. Try again.', 'error');
    }
  };

  return (
    <div className="flex min-h-[100dvh]">

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col bg-[hsl(var(--sidebar))]">

        {/* Logo — large, prominent, centered */}
        <div className="flex items-center justify-center border-b border-white/[.07] px-6 py-6">
          <img src="/dhg-logo.png" alt="D.H. Griffin Companies" className="h-[72px] w-auto" />
        </div>

        {/* Navigation */}
        <nav className="px-3 pt-5 space-y-1">
          {[
            { icon: <Home size={15} />, label: 'Select Year', active: true },
            { icon: <ClipboardList size={15} />, label: 'Ticket Register', active: false },
            { icon: <UploadCloud size={15} />, label: 'Upload History', active: false },
            { icon: <ArrowDownToLine size={15} />, label: 'Export History', active: false },
            { icon: <Settings2 size={15} />, label: 'Settings', active: false },
          ].map(({ icon, label, active }) => (
            <div
              key={label}
              className={`flex cursor-default items-center gap-3 rounded-md px-3 py-2.5 text-[12px] transition select-none ${
                active
                  ? 'bg-[hsl(var(--primary))] font-semibold text-white'
                  : 'font-medium text-white/35 hover:bg-[hsl(var(--sidebar-accent))] hover:text-white/70'
              }`}
            >
              {icon} {label}
            </div>
          ))}
        </nav>

        {/* Recent Jobs — served from react-query cache, free */}
        {selectedYear && (
          <SidebarRecentJobs
            yearId={selectedYear.id}
            onOpen={(job) => onSelect(selectedYear, job)}
          />
        )}

        {/* Spacer — keeps sidebar clean and minimal */}
        <div className="flex-1" />
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[hsl(var(--background))]">

        {/* Status + avatar — inline top-right, no separate header bar */}
        <div className="flex justify-end items-center gap-3 px-8 pt-5 pb-0 shrink-0">
          <ApiStatus theme="light" />
          <button
            onClick={handleLogout}
            title="Log out"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            <LogOut size={13} /> Log out
          </button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/.15)] border border-[hsl(var(--primary)/.25)] text-[hsl(var(--primary))]">
            <User size={16} strokeWidth={1.75} />
          </div>
        </div>

        {/* Hero */}
        <div className="px-8 pt-4 pb-6 shrink-0">
          <h1 className="text-[1.85rem] font-bold tracking-tight text-[hsl(var(--foreground))]">
            Welcome to{' '}
            <span className="text-[hsl(var(--primary))]">DHG Register</span>
          </h1>
          <p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">
            OCR-Powered Ticket &amp; Invoice Management
          </p>
        </div>

        {/* ── SELECT A YEAR ─────────────────────────────────────── */}
        <div className="px-8 pb-7 shrink-0">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[.13em] text-[hsl(var(--primary))]">
              Select a Year
            </h2>
            <div className="flex-1 h-px bg-[hsl(var(--primary)/.2)]" />
          </div>

          {yearsError && (
            <p className="mb-4 text-sm text-[hsl(var(--destructive))]">
              <AlertTriangle size={14} className="mr-1 inline" /> Could not load years. Check that the API server is running.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {yearsLoading && (
              <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <LoaderCircle size={16} className="animate-spin" /> Loading…
              </div>
            )}

            {sortedYears.map((year) => (
              <YearCardWidget
                key={year.id}
                year={year}
                isSelected={selectedYear?.id === year.id}
                onSelect={() => setSelectedYear(year)}
                onDelete={() => void handleDeleteYear(year)}
              />
            ))}

            {/* Add Year — dashed card, matches year card height */}
            <button
              onClick={() => setYearModal({ open: true, value: String(new Date().getFullYear()), error: '' })}
              className="flex w-[158px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[hsl(var(--primary)/.3)] bg-white/60 py-5 px-6 transition hover:border-[hsl(var(--primary)/.6)] hover:bg-white"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-white shadow-sm">
                <Plus size={20} />
              </div>
              <span className="text-[13px] font-semibold text-[hsl(var(--primary))]">Add Year</span>
            </button>
          </div>
        </div>

        {/* ── RECENT ACTIVITY ───────────────────────────────────── */}
        {selectedYear ? (
          <div className="flex-1 px-8 pb-8 animate-rise">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-[11px] font-bold uppercase tracking-[.13em] text-[hsl(var(--primary))]">
                Recent Activity
              </h2>
              <div className="flex-1 h-px bg-[hsl(var(--primary)/.2)]" />
            </div>
            <RecentActivityPanel
              key={selectedYear.id}
              year={selectedYear}
              onOpen={(job) => onSelect(selectedYear, job)}
              announce={announce}
            />
          </div>
        ) : (
          !yearsLoading && years.length > 0 && (
            <div className="flex flex-1 items-center justify-center pb-16">
              <div className="text-center">
                <CalendarDays size={32} className="mx-auto text-[hsl(var(--muted-foreground)/.35)]" />
                <p className="mt-3 text-[14px] font-semibold">Select a year above</p>
                <p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">Click a year card to view its jobs.</p>
              </div>
            </div>
          )
        )}

        {/* Red footer — full width across bottom of main area */}
        <footer className="mt-auto shrink-0 bg-[hsl(var(--primary))] px-8 py-3 flex items-center justify-between">
          <span className="text-[11px] font-medium text-white/90">Safety · Integrity · Performance · People</span>
          <span className="text-[11px] text-white/70">© {new Date().getFullYear()} D.H. Griffin Companies</span>
        </footer>
      </div>

      {/* Add Year modal */}
      {yearModal.open && (
        <Modal title="Add Year" onClose={() => setYearModal({ open: false })}>
          <div className="space-y-4">
            <FormInput
              label="Year"
              autoFocus
              type="number"
              min={2000}
              max={2100}
              value={yearModal.value}
              placeholder="e.g. 2026"
              onChange={(e) => setYearModal({ ...yearModal, value: e.target.value, error: '' })}
              onKeyDown={(e) => e.key === 'Enter' && void handleAddYear()}
            />
            {yearModal.error && <p className="text-[12px] text-[hsl(var(--destructive))]">{yearModal.error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setYearModal({ open: false })} className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-[12px] font-semibold transition hover:bg-[hsl(var(--muted))]">Cancel</button>
              <button
                onClick={() => void handleAddYear()}
                disabled={createYear.isPending}
                className="flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-50"
              >
                {createYear.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Plus size={12} />} Add Year
              </button>
            </div>
          </div>
        </Modal>
      )}

      {notice && <Notice notice={notice} />}
    </div>
  );
}

// ─── Register sidebar ─────────────────────────────────────────────────────────

function Sidebar({ year, job, onNewBatch, onBackToJobs, onBackToYears }: {
  year: Year; job: Job;
  onNewBatch: () => void;
  onBackToJobs: () => void;
  onBackToYears: () => void;
}) {
  const qc = useQueryClient();
  const logout = useLogout();
  const handleLogout = useCallback(() => {
    void logout.mutateAsync().finally(() => qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }));
  }, [logout, qc]);

  return (
    <aside className="hidden min-h-[100dvh] w-[220px] shrink-0 flex-col bg-[hsl(var(--sidebar))] md:flex">
      {/* Logo + app name */}
      <div className="flex h-[54px] shrink-0 items-center gap-3 border-b border-white/[.07] px-5">
        <img src="/dhg-logo.png" alt="D.H. Griffin Companies" className="h-7 w-auto" />
        <div className="h-4 w-px bg-white/20" />
        <span className="text-[13px] font-semibold tracking-wide text-white/90">DHG Register</span>
      </div>

      <div className="flex flex-1 flex-col px-3 py-4">
        {/* Active job card */}
        <div className="rounded-md border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.7)] p-3">
          <div className="text-[9px] font-bold uppercase tracking-[.14em] text-white/35">{year.year} · Active Job</div>
          <div className="mt-1.5 font-mono-app text-[10px] font-bold tracking-wider text-[hsl(var(--sidebar-primary))]">{job.jobNumber}</div>
          <div className="mt-0.5 text-[11px] font-medium leading-4 text-white/75">{job.jobName}</div>
        </div>

        {/* Navigation */}
        <div className="mt-5">
          <div className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[.14em] text-white/30">Workspace</div>
          <nav className="space-y-0.5">
            <div className="flex items-center gap-2.5 rounded-md bg-[hsl(var(--primary)/.18)] px-2.5 py-2 text-[12px] font-semibold text-white">
              <ClipboardList size={14} className="text-[hsl(var(--sidebar-primary))]" /> Ticket Register
            </div>
          </nav>
        </div>

        <div className="mt-5">
          <div className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[.14em] text-white/30">Navigate</div>
          <div className="space-y-0.5">
            <button onClick={onNewBatch} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] text-white/50 transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-white/90">
              <Plus size={14} /> New Batch
            </button>
            <button onClick={onBackToJobs} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] text-white/50 transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-white/90">
              <ArrowLeft size={14} /> Switch Job
            </button>
            <button onClick={onBackToYears} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] text-white/50 transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-white/90">
              <CalendarDays size={14} /> Switch Year
            </button>
          </div>
        </div>

        <div className="mt-auto">
          {/* OCR status card */}
          <div className="rounded-md border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.6)] p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-white/75">
              <ShieldCheck size={13} className="text-[hsl(var(--sidebar-primary))]" /> Local OCR
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[hsl(var(--sidebar-primary))]">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" /> Ready
            </div>
          </div>
          {/* Footer row */}
          <div className="mt-3 flex items-center justify-between px-1">
            <button className="flex items-center gap-1.5 text-[11px] text-white/30 transition hover:text-white/60">
              <Settings2 size={13} /> Settings
            </button>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-[11px] text-white/30 transition hover:text-white/60">
              <LogOut size={13} /> Log out
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Ticket register table ────────────────────────────────────────────────────

// Source(170px) + 9 generic fields + Cost Code selector + Category selector
// + Actions(108px) — must have exactly as many tracks as cells rendered per
// row below.
const REGISTER_GRID_COLS = 'grid-cols-[170px_1fr_.9fr_.9fr_.8fr_.85fr_.95fr_.75fr_.85fr_1.3fr_1.5fr_1.5fr_1.05fr_108px]';

// The C&D/Inert category is only meaningful for landfill / inert-landfill
// tickets. For a non-landfill ticket an unset value shows a neutral "N/A"
// (not a red "Needs review") and is never flagged as needing review; only a
// landfill ticket shows a genuine red "Needs review" when unset. The
// selector stays available in both cases, so any ticket's category remains
// user-overridable.
function WasteCategorySelect({ value, isLandfill, disabled, onChange, ariaLabel }: {
  value: WasteCategory | null;
  isLandfill: boolean;
  disabled: boolean;
  onChange: (value: WasteCategory) => void;
  ariaLabel: string;
}) {
  const needsReview = isLandfill && !value;
  const placeholder = isLandfill ? 'Needs review' : 'N/A';
  const tone = needsReview
    ? 'text-[hsl(var(--destructive))]'
    : value
      ? ''
      : 'text-[hsl(var(--muted-foreground))]';
  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value as WasteCategory)}
      className={`ticket-field ${tone}`}
    >
      {!value && <option value="" disabled>{placeholder}</option>}
      {WASTE_CATEGORY_OPTIONS.map((option) => (
        <option key={option} value={option}>{WASTE_CATEGORY_LABELS[option]}</option>
      ))}
    </select>
  );
}

// The PRIMARY classification for every ticket (DHG's accounting "Cat"
// column — see @workspace/cost-codes). Grouped by section, always manually
// overridable; null renders as "Needs review" rather than a guess.
function CostCodeSelect({ value, disabled, onChange, ariaLabel }: {
  value: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={`ticket-field ${value ? '' : 'text-[hsl(var(--destructive))]'}`}
    >
      {!value && <option value="" disabled>Needs review</option>}
      {COST_CODE_SECTIONS.map(({ section, codes }) => (
        <optgroup key={section} label={section}>
          {codes.map((entry) => (
            <option key={entry.code} value={entry.code}>{formatCostCode(entry)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// LEED Waste & Scrap Diversion material selector (see @workspace/diversion).
// A simple flat select of the seven materials + a "Needs review" empty
// option; independent of the Cost Code and Waste Category selectors.
function MaterialSelect({ value, disabled, onChange, ariaLabel }: {
  value: string | null;
  disabled: boolean;
  onChange: (value: DiversionMaterial) => void;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value as DiversionMaterial)}
      className={`ticket-field ${value ? '' : 'text-[hsl(var(--destructive))]'}`}
    >
      {!value && <option value="" disabled>Needs review</option>}
      {DIVERSION_MATERIALS.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}

function TicketRegister({ rows, onChange, onCategoryChange, onCostCodeChange, onDiversionMaterialChange, onDelete, onRetry, onPreview }: {
  rows: TicketRow[];
  onChange: (id: string, field: FieldKey, value: string) => void;
  onCategoryChange: (id: string, category: WasteCategory) => void;
  onCostCodeChange: (id: string, costCode: string) => void;
  onDiversionMaterialChange: (id: string, material: DiversionMaterial) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onPreview: (row: TicketRow) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[hsl(var(--card-border))] bg-white shadow-sm animate-rise delay-3">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-semibold">Ticket Register</h2>
            <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 font-mono-app text-[9px] text-[hsl(var(--muted-foreground))]">{rows.length}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Review extracted data before export.</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Changes save to this job automatically
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1600px]">
          <div className={`grid ${REGISTER_GRID_COLS} gap-3 bg-[hsl(var(--muted)/.5)] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]`}>
            <div>Source</div>{fields.map((f) => <div key={f.key}>{f.short}</div>)}<div>Cost Code</div><div>Material</div><div>Category</div><div className="text-right">Actions</div>
          </div>
          {rows.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
                <Inbox size={22} />
              </div>
              <h3 className="mt-3 text-[14px] font-semibold">Register is empty</h3>
              <p className="mt-1 max-w-xs text-[12px] text-[hsl(var(--muted-foreground))]">Upload ticket photos to the left and DHG Register will populate the rows.</p>
            </div>
          )}
          {rows.map((row) => (
            <div key={row.id} className={`ticket-table-row grid ${REGISTER_GRID_COLS} items-center gap-3 px-5 py-3 transition`}>
              <div className="flex min-w-0 items-center gap-2">
                <button onClick={() => onPreview(row)} className="group relative h-9 w-11 shrink-0 overflow-hidden rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                  <img src={row.preview} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
                    <ZoomIn size={12} className="text-white" />
                  </span>
                </button>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium">{row.fileName}</div>
                  <div className="mt-1"><StatusPill status={row.status} /></div>
                  {row.error && <div title={row.error} className="mt-1 max-w-[140px] truncate text-[10px] text-[hsl(var(--destructive))]">{row.error}</div>}
                </div>
              </div>
              {fields.map((f) => (
                <input key={f.key} aria-label={`${f.label} for ${row.fileName}`} disabled={row.status === 'Reading'}
                  className="ticket-field" value={row.extraction[f.key]} placeholder="—"
                  onChange={(e) => onChange(row.id, f.key, e.target.value)} />
              ))}
              <CostCodeSelect
                ariaLabel={`Cost code for ${row.fileName}`}
                disabled={row.status === 'Reading'}
                value={row.extraction.costCode}
                onChange={(costCode) => onCostCodeChange(row.id, costCode)}
              />
              <MaterialSelect
                ariaLabel={`Diversion material for ${row.fileName}`}
                disabled={row.status === 'Reading'}
                value={row.extraction.diversionMaterial}
                onChange={(material) => onDiversionMaterialChange(row.id, material)}
              />
              <WasteCategorySelect
                ariaLabel={`Waste category for ${row.fileName}`}
                disabled={row.status === 'Reading'}
                isLandfill={isLandfillTicket(row.extraction)}
                value={row.extraction.wasteCategory}
                onChange={(category) => onCategoryChange(row.id, category)}
              />
              <div className="flex items-center justify-end gap-0.5">
                {row.status === 'Failed' && row.hasSourceImage && (
                  <button onClick={() => onRetry(row.id)} title="Retry" className="action-icon rounded-md p-1.5 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.1)]">
                    <RotateCw size={13} />
                  </button>
                )}
                <button onClick={() => onDelete(row.id)} title="Delete" className="action-icon rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-[hsl(var(--destructive))]">
                  <Trash2 size={13} />
                </button>
                <button onClick={() => window.alert(row.error ?? 'Row ready for review.')} title="Details" className="action-icon rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
                  <MoreHorizontal size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Cost code report — section subtotals, mirroring the DHG "JC Entries
// by Job" report ───────────────────────────────────────────────────────────

// In-page cost-code filter: "All" + every code grouped by section + "Needs
// review". Selecting a value instantly narrows the register rows and the Cost
// Code Totals panel — pure client-side, no report run, no reload.
function CostCodeFilterSelect({ value, onChange }: {
  value: CostCodeFilter;
  onChange: (value: CostCodeFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Filter size={13} className="text-[hsl(var(--muted-foreground))]" />
      <label htmlFor="cost-code-filter" className="text-[11px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Filter</label>
      <select
        id="cost-code-filter"
        aria-label="Filter by cost code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-[hsl(var(--border))] bg-white px-2.5 py-1.5 text-[12px] font-medium outline-none transition focus:border-[hsl(var(--primary)/.6)]"
      >
        <option value={COST_CODE_FILTER_ALL}>All cost codes</option>
        {costCodesBySection().map(({ section, codes }) => (
          <optgroup key={section} label={section}>
            {codes.map((c) => (
              <option key={c.code} value={c.code}>{formatCostCode(c)}</option>
            ))}
          </optgroup>
        ))}
        <option value={COST_CODE_FILTER_UNASSIGNED}>Needs review</option>
      </select>
    </div>
  );
}

function CostCodeReport({ totals }: { totals: ReturnType<typeof computeCostCodeTotals> }) {
  const currency = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  if (!totals.sections.length && !totals.unassignedCount) return null;
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-[hsl(var(--card-border))] bg-white shadow-sm animate-rise delay-3">
      <div className="border-b border-[hsl(var(--border))] px-5 py-3.5">
        <h2 className="text-[14px] font-semibold">Cost Code Totals</h2>
        <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Amount by cost code and section — the PRIMARY classification for every ticket.</p>
      </div>
      <div className="divide-y divide-[hsl(var(--border)/.7)]">
        {totals.sections.map((section) => (
          <div key={section.section} className="px-5 py-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--primary))]">{section.section}</span>
              <span className="font-mono-app text-[12px] font-semibold text-[hsl(var(--foreground))]">{currency(section.amount)}</span>
            </div>
            <div className="space-y-1">
              {section.codes.map((code) => (
                <div key={code.code} className="flex items-center justify-between text-[12px] text-[hsl(var(--muted-foreground))]">
                  <span>{formatCostCode({ section: section.section, code: code.code, name: code.name })} <span className="opacity-60">({code.count})</span></span>
                  <span className="font-mono-app">{currency(code.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {totals.unassignedCount > 0 && (
          <div className="flex items-center justify-between px-5 py-3 text-[12px] text-[hsl(var(--destructive))]">
            <span>Needs review <span className="opacity-60">({totals.unassignedCount})</span></span>
            <span className="font-mono-app">{currency(totals.unassignedAmount)}</span>
          </div>
        )}
        <div className="flex items-center justify-between bg-[hsl(var(--muted)/.4)] px-5 py-3 text-[12px] font-semibold">
          <span>Grand Total</span>
          <span className="font-mono-app">{currency(totals.grandTotal)}</span>
        </div>
      </div>
    </section>
  );
}

// ─── LEED diversion summary panel ───────────────────────────────────────────
// Per-batch/job diversion snapshot: % diverted, total / diverted / residual
// tonnage, and per-material diverted tonnage. Uses the shared
// computeDiversion() so the UI, API, export and tests all agree. Independent
// of the waste-category and cost-code panels.
function DiversionPanel({ rows }: { rows: TicketRow[] }) {
  const totals = useMemo(
    () => computeDiversion(rows.map((r) => ({ weight: r.extraction.weight, diversionMaterial: r.extraction.diversionMaterial }))),
    [rows],
  );
  if (!rows.length) return null;
  const pct = `${(totals.pctDiverted * 100).toFixed(1)}%`;
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-[hsl(var(--card-border))] bg-white shadow-sm animate-rise delay-3">
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-5 py-3.5">
        <Recycle size={15} className="text-[hsl(var(--primary))]" />
        <div>
          <h2 className="text-[14px] font-semibold">Waste &amp; Scrap Diversion</h2>
          <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">LEED diversion for this job — recyclables diverted vs. residual to landfill.</p>
        </div>
        <span className="ml-auto rounded-md bg-[hsl(var(--primary)/.1)] px-3 py-1 font-mono-app text-[15px] font-bold text-[hsl(var(--primary))]">{pct}</span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[hsl(var(--border)/.7)] border-b border-[hsl(var(--border)/.7)]">
        <div className="px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Total Tonnage</div>
          <div className="mt-1 font-mono-app text-[14px] font-semibold">{formatTons(totals.totalTonnage)}</div>
        </div>
        <div className="px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--primary))]">Diverted</div>
          <div className="mt-1 font-mono-app text-[14px] font-semibold">{formatTons(totals.totalDiverted)}</div>
        </div>
        <div className="px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--destructive))]">Residual / Trash</div>
          <div className="mt-1 font-mono-app text-[14px] font-semibold">{formatTons(totals.residual)}</div>
        </div>
      </div>
      <div className="divide-y divide-[hsl(var(--border)/.7)]">
        {DIVERTED_MATERIALS.map((m) => (
          <div key={m} className="flex items-center justify-between px-5 py-2 text-[12px] text-[hsl(var(--muted-foreground))]">
            <span>{m}</span>
            <span className="font-mono-app">{formatTons(totals.perMaterial[m])}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Ticket register page ─────────────────────────────────────────────────────

function Register({ year, job, onBackToJobs, onBackToYears }: {
  year: Year;
  job: Job;
  onBackToJobs: () => void;
  onBackToYears: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [previewRow, setPreviewRow] = useState<TicketRow | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractMutation = useExtractTicket();
  const createTicket = useCreateTicketRecord();
  const updateTicket = useUpdateTicketRecord();
  const deleteTicket = useDeleteTicketRecord();

  // Ticket register rows are persisted server-side (per job) so upload
  // history, statuses, and manual edits survive a refresh — see AUDIT.md
  // C-2. `rows` is seeded from the server once per job and then kept in
  // sync locally as the source of truth for rendering, with every mutation
  // also pushed to the API.
  const { data: savedTickets, isLoading: ticketsLoading, isError: ticketsError } = useListTickets(job.id);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const hydratedJobIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (savedTickets && hydratedJobIdRef.current !== job.id) {
      setRows(savedTickets.map(ticketRecordToRow));
      hydratedJobIdRef.current = job.id;
    }
  }, [savedTickets, job.id]);

  const announce = useCallback((message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    setNotice({ message, kind });
    setTimeout(() => setNotice((c) => c?.message === message ? null : c), 3600);
  }, []);

  const processFile = useCallback(async (file: File) => {
    const mediaType = getSupportedMediaType(file);
    if (!mediaType) { announce(`${file.name} isn't supported. Use JPG, PNG, WEBP, or GIF.`, 'error'); return; }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const preview = URL.createObjectURL(file);
    setRows((cur) => [{ id, hasSourceImage: true, fileName: file.name, preview, status: 'Reading', extraction: emptyExtraction }, ...cur]);
    announce(`Reading ${file.name}…`, 'info');
    let extraction: TicketExtraction | null = null;
    let message = '';
    try {
      const imageData = await readFileAsBase64(file);
      extraction = await extractMutation.mutateAsync({ data: { fileName: file.name, mediaType, imageData } });
    } catch (err) {
      message = err instanceof Error ? err.message : 'Extraction did not complete.';
    }
    const status: RowStatus = extraction ? 'Processed' : 'Failed';
    setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction: extraction ?? r.extraction, status, error: extraction ? undefined : message } : r));
    try {
      const created = await createTicket.mutateAsync({
        jobId: job.id,
        data: { fileName: file.name, status, error: extraction ? null : message, ...(extraction ?? emptyExtraction) },
      });
      setRows((cur) => cur.map((r) => r.id === id ? { ...r, serverId: created.id } : r));
    } catch {
      announce(`${file.name} processed but could not be saved. Refreshing will lose this row.`, 'error');
    }
    if (extraction) announce(`${file.name} processed. Give the fields a quick look.`);
    else announce(`${file.name}: ${message}`, 'error');
  }, [announce, createTicket, extractMutation, job.id]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((f) => void processFile(f));
  }, [processFile]);

  const retryRow = useCallback((id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setRows((cur) => cur.map((r) => r.id === id ? { ...r, status: 'Reading', error: undefined } : r));
    announce(`Retrying ${row.fileName}…`, 'info');
    void (async () => {
      let extraction: TicketExtraction | null = null;
      let message = '';
      try {
        const response = await fetch(row.preview);
        if (!response.ok) throw new Error('Source image is no longer available.');
        const blob = await response.blob();
        const imageData = await readFileAsBase64(blob);
        const mediaType = getSupportedMediaType(new File([blob], row.fileName, { type: blob.type })) ?? 'image/jpeg';
        extraction = await extractMutation.mutateAsync({ data: { fileName: row.fileName, mediaType, imageData } });
      } catch (err) {
        message = err instanceof Error ? err.message : 'Extraction did not complete.';
      }
      const status: RowStatus = extraction ? 'Processed' : 'Failed';
      setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction: extraction ?? r.extraction, status, error: extraction ? undefined : message } : r));
      if (row.serverId) {
        void updateTicket.mutateAsync({
          jobId: job.id,
          ticketId: row.serverId,
          data: { status, error: extraction ? null : message, ...(extraction ?? {}) },
        }).catch(() => announce('Could not save the retry result. Try again.', 'error'));
      }
      if (extraction) announce(`${row.fileName} processed on retry.`);
      else announce(`Retry failed for ${row.fileName}: ${message}`, 'error');
    })();
  }, [announce, extractMutation, job.id, rows, updateTicket]);

  const updateField = useCallback((id: string, field: FieldKey, value: string) => {
    setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction: { ...r.extraction, [field]: value } } : r));
    const row = rows.find((r) => r.id === id);
    if (row?.serverId) {
      void updateTicket.mutateAsync({ jobId: job.id, ticketId: row.serverId, data: { [field]: value } })
        .catch(() => announce('Could not save the change. Try again.', 'error'));
    }
  }, [announce, job.id, rows, updateTicket]);

  const updateCategory = useCallback((id: string, category: WasteCategory) => {
    setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction: { ...r.extraction, wasteCategory: category } } : r));
    const row = rows.find((r) => r.id === id);
    if (row?.serverId) {
      void updateTicket.mutateAsync({ jobId: job.id, ticketId: row.serverId, data: { wasteCategory: category } })
        .catch(() => announce('Could not save the category. Try again.', 'error'));
    }
  }, [announce, job.id, rows, updateTicket]);

  const updateCostCode = useCallback((id: string, costCode: string) => {
    setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction: { ...r.extraction, costCode } } : r));
    const row = rows.find((r) => r.id === id);
    if (row?.serverId) {
      void updateTicket.mutateAsync({ jobId: job.id, ticketId: row.serverId, data: { costCode } })
        .catch(() => announce('Could not save the cost code. Try again.', 'error'));
    }
  }, [announce, job.id, rows, updateTicket]);

  const updateDiversionMaterial = useCallback((id: string, material: DiversionMaterial) => {
    setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction: { ...r.extraction, diversionMaterial: material } } : r));
    const row = rows.find((r) => r.id === id);
    if (row?.serverId) {
      void updateTicket.mutateAsync({ jobId: job.id, ticketId: row.serverId, data: { diversionMaterial: material } })
        .catch(() => announce('Could not save the diversion material. Try again.', 'error'));
    }
  }, [announce, job.id, rows, updateTicket]);

  const deleteRow = useCallback((id: string) => {
    const row = rows.find((r) => r.id === id);
    setRows((cur) => cur.filter((r) => r.id !== id));
    if (row) {
      announce(`${row.fileName} removed.`, 'info');
      if (row.serverId) {
        void deleteTicket.mutateAsync({ jobId: job.id, ticketId: row.serverId })
          .catch(() => announce('Could not delete on the server. Try refreshing.', 'error'));
      }
    }
  }, [announce, deleteTicket, job.id, rows]);

  const addManualRow = useCallback(() => {
    const id = `manual-${Date.now()}`;
    setRows((cur) => [{ id, hasSourceImage: false, fileName: 'Manual entry', preview: samplePreview('MANUAL ENTRY'), status: 'Manual', extraction: emptyExtraction }, ...cur]);
    announce('Blank manual row added.');
    createTicket.mutateAsync({ jobId: job.id, data: { fileName: 'Manual entry', status: 'Manual', ...emptyExtraction } })
      .then((created) => setRows((cur) => cur.map((r) => r.id === id ? { ...r, serverId: created.id } : r)))
      .catch(() => announce('Could not save the manual row. Refreshing will lose it.', 'error'));
  }, [announce, createTicket, job.id]);

  const newBatch = useCallback(() => {
    if (!rows.length) return;
    if (!window.confirm(`Start a new batch? This will permanently delete all ${rows.length} row(s) in this job's register.`)) return;
    const toDelete = rows.filter((r) => r.serverId);
    setRows(() => []);
    announce('New batch started.', 'info');
    void Promise.all(
      toDelete.map((r) => deleteTicket.mutateAsync({ jobId: job.id, ticketId: r.serverId! }).catch(() => {})),
    );
  }, [announce, deleteTicket, job.id, rows]);

  // C&D landfill and inert/concrete recycling are tracked completely
  // separately for cost/billing purposes — each category's amount (and,
  // below, each category's tonnage) is computed independently here and
  // must never be added together into one blended total anywhere in the UI.
  const totals = useMemo(() => {
    const tonnages = rows.map((r) => parseTonnage(r.extraction.weight));
    const withWeight = tonnages.filter((t) => t !== null).length;
    const amountForCategory = (category: WasteCategory) =>
      rows
        .filter((r) => r.extraction.wasteCategory === category)
        .reduce((s, r) => s + (Number(r.extraction.amount.replace(/[$,\s]/g, '')) || 0), 0)
        .toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    // Blank/unparseable weights are excluded from the sum entirely (never
    // guessed as 0 tons) — see parseTonnage().
    const tonsForCategory = (category: WasteCategory) =>
      rows
        .filter((r) => r.extraction.wasteCategory === category)
        .reduce((s, r) => s + (parseTonnage(r.extraction.weight) ?? 0), 0);
    return {
      count: rows.length,
      withWeight,
      withoutWeight: rows.length - withWeight,
      cdAmount: amountForCategory('C&D'),
      inertAmount: amountForCategory('Inert'),
      totalTons: tonnages.reduce<number>((s, t) => s + (t ?? 0), 0),
      cdTons: tonsForCategory('C&D'),
      inertTons: tonsForCategory('Inert'),
      costCodes: computeCostCodeTotals(rows.map((r) => ({ costCode: r.extraction.costCode, amount: r.extraction.amount }))),
    };
  }, [rows]);

  // In-page cost-code filter (client-side only — no report run, no reload).
  const [costFilter, setCostFilter] = useState<CostCodeFilter>(COST_CODE_FILTER_ALL);
  const visibleRows = useMemo(
    () => filterRowsByCostCode(rows.map((r) => ({ ...r, costCode: r.extraction.costCode })), costFilter),
    [rows, costFilter],
  );
  const visibleCostCodeTotals = useMemo(
    () => filterCostCodeTotals(totals.costCodes, costFilter),
    [totals.costCodes, costFilter],
  );

  const exportCsv = useCallback(() => {
    const header = ['Document type', 'Vendor', 'Ticket number', 'Invoice number', 'Purchase Order', 'Job Number', 'Date', 'Weight', 'Amount', 'Description', 'Cost Code', 'Waste Category', 'Source file', 'Status'];
    const v = (s: string) => `"${s.replaceAll('"', '""')}"`;
    const body = rows.map((r) => [
      r.extraction.documentType,
      ...fields.map((f) => r.extraction[f.key]),
      formatCostCode(r.extraction.costCode) || 'Needs review',
      r.extraction.wasteCategory
        ? WASTE_CATEGORY_LABELS[r.extraction.wasteCategory]
        : (isLandfillTicket(r.extraction) ? 'Needs review' : 'N/A'),
      r.fileName,
      r.status,
    ].map(v).join(','));
    // Trailing tonnage summary — C&D and Inert stay on their own rows,
    // never blended into one figure, matching the dashboard stat cards.
    const tonnageSummary = [
      [],
      ['Tonnage Summary'],
      ['Total Net Tons', totals.totalTons.toFixed(2)],
      ['C&D Landfill Tons', totals.cdTons.toFixed(2)],
      ['Inert / Recycling Tons', totals.inertTons.toFixed(2)],
    ];
    // Trailing cost-code section-subtotal summary, mirroring the "JC
    // Entries by Job" report's section subtotals.
    const costCodeSummary: (string | number)[][] = [[], ['Cost Code Summary'], ['Section', 'Code', 'Name', 'Amount']];
    for (const section of totals.costCodes.sections) {
      for (const code of section.codes) {
        costCodeSummary.push([section.section, code.code, code.name, code.amount.toFixed(2)]);
      }
      costCodeSummary.push([`${section.section} Subtotal`, '', '', section.amount.toFixed(2)]);
    }
    costCodeSummary.push(['Needs Review', '', '', totals.costCodes.unassignedAmount.toFixed(2)]);
    costCodeSummary.push(['Grand Total', '', '', totals.costCodes.grandTotal.toFixed(2)]);
    const summary = [...tonnageSummary, ...costCodeSummary].map((row) => row.map((cell) => v(String(cell))).join(','));
    const blob = new Blob([[header.map(v).join(','), ...body, ...summary].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dhg-register-${job.jobNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    announce(`${rows.length} rows exported.`);
  }, [announce, job.jobNumber, rows, totals]);

  // Export LEED Report (.xlsx): ONE workbook with a NEW TAB PER MONTH present
  // in this job's tickets, each mirroring the DHG "Waste & Scrap Diversion"
  // layout. The workbook model is built by the shared, unit-tested
  // buildLeedWorkbookModel(); this handler only turns that pure model into a
  // SheetJS workbook and downloads it. Distinct from Export CSV.
  const exportLeed = useCallback(() => {
    const model = buildLeedWorkbookModel(
      rows.map((r) => ({
        date: r.extraction.date,
        vendor: r.extraction.vendor,
        weight: r.extraction.weight,
        ticketNumber: r.extraction.ticketNumber,
        jobNumber: r.extraction.jobNumber || job.jobNumber,
        diversionMaterial: r.extraction.diversionMaterial,
      })),
      { jobName: job.jobName, location: '' },
    );
    if (!model.sheets.length) {
      announce('No tickets to export.', 'info');
      return;
    }
    const wb = XLSX.utils.book_new();
    for (const sheet of model.sheets) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
      // Sheet names must be <=31 chars and free of : \ / ? * [ ] — the month
      // labels ("Sep-25") already satisfy this.
      XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
    }
    XLSX.writeFile(wb, `dhg-leed-diversion-${job.jobNumber}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    announce(`LEED report exported (${model.sheets.length} month${model.sheets.length === 1 ? '' : 's'}).`);
  }, [announce, job.jobName, job.jobNumber, rows]);

  return (
    <div className="flex min-h-[100dvh] bg-[hsl(var(--background))]">
      <Sidebar year={year} job={job} onNewBatch={newBatch} onBackToJobs={onBackToJobs} onBackToYears={onBackToYears} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <AppHeader>
          {/* Mobile menu button */}
          <button className="rounded-md p-1.5 text-white/50 hover:bg-white/10 md:hidden"><Menu size={17} /></button>
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-[11px] text-white/40">
            <button onClick={onBackToYears} className="transition hover:text-white/80">{year.year}</button>
            <ChevronRight size={11} />
            <button onClick={onBackToJobs} className="transition hover:text-white/80">Jobs</button>
            <ChevronRight size={11} />
            <span className="font-mono-app tracking-wider text-white/70">{job.jobNumber}</span>
            <span className="text-white/25">·</span>
            <span className="font-medium text-white/60">Register</span>
          </div>
        </AppHeader>

        <main className="mx-auto w-full max-w-[1450px] flex-1 px-5 py-6 md:px-8 md:py-8">
          {/* Page header */}
          <div className="mb-6 animate-rise">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.12em] text-[hsl(var(--primary))]">
                  {year.year} · {job.jobNumber}
                </p>
                <h1 className="text-[1.5rem] font-bold tracking-tight text-[hsl(var(--foreground))]">{job.jobName}</h1>
                <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">Upload tickets — review extracted data — export CSV.</p>
              </div>
              <button
                onClick={() => setBudgetOpen(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-[hsl(var(--primary)/.5)] bg-white px-3.5 py-2 text-[12px] font-semibold text-[hsl(var(--primary))] shadow-sm transition hover:bg-[hsl(var(--primary))] hover:text-white active:scale-95"
              >
                <Wallet size={14} /> Budget
              </button>
            </div>
          </div>

          {/* Stat cards — C&D and Inert amounts (and tonnages, below) are
              always shown as separate totals, never merged into one
              blended "waste" figure. */}
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Tickets" value={String(totals.count).padStart(2, '0')} detail="in this batch" tone="ink" />
            <StatCard label="With Weight" value={String(totals.withWeight).padStart(2, '0')} detail={totals.count ? `${totals.withoutWeight} without tonnage` : 'awaiting upload'} tone="slate" />
            <StatCard label="C&D Landfill" value={totals.cdAmount} detail="amount, this batch" tone="red" />
            <StatCard label="Inert / Recycling" value={totals.inertAmount} detail="amount, this batch" tone="slate" />
            <StatCard label="Total Tonnage" value={formatTons(totals.totalTons)} detail="net tons, this batch" tone="ink" />
            <StatCard label="C&D Tonnage" value={formatTons(totals.cdTons)} detail="tons, this batch" tone="red" />
            <StatCard label="Inert Tonnage" value={formatTons(totals.inertTons)} detail="tons, this batch" tone="slate" />
          </div>

          {/* Main content grid — stacks on mobile so the register isn't crushed */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,.6fr)_minmax(0,1.4fr)]">
            {/* Left: upload zone + info */}
            <div className="space-y-4">
              <section
                className={`drop-zone rounded-lg p-5 transition duration-200 ${dragging ? 'is-dragging' : ''}`}
                onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
                />
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]">
                  <CloudUpload size={22} />
                </div>
                <h2 className="mt-4 text-[15px] font-semibold tracking-tight">
                  {dragging ? 'Drop tickets here' : 'Upload Tickets'}
                </h2>
                <p className="mt-1.5 max-w-xs text-[12px] leading-5 text-[hsl(var(--muted-foreground))]">
                  Drop ticket photos here or click to browse. Local OCR reads the fields — you review before exporting.
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[hsl(var(--primary)/.9)] active:scale-95"
                >
                  <UploadCloud size={14} /> Browse Files
                </button>
                <div className="mt-4 flex items-center gap-2 border-t border-[hsl(var(--border))] pt-3.5 text-[10px] font-medium uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
                  <FileImage size={12} /> JPG · PNG · WEBP · GIF
                  <span className="ml-auto font-mono-app normal-case tracking-normal text-[hsl(var(--muted-foreground))]">≤ 25 MB</span>
                </div>
              </section>

              {/* OCR note */}
              <div className="rounded-lg border border-[hsl(var(--border))] bg-white p-4">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />
                  <div>
                    <h3 className="text-[12px] font-semibold">Local extraction, full control</h3>
                    <p className="mt-1 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">
                      All OCR runs on-premise. No data leaves the yard. Every field stays editable before the CSV ships.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: register table + actions */}
            <div className="min-w-0">
              {ticketsLoading && !rows.length && (
                <div className="mb-3 flex items-center gap-2 text-[12px] text-[hsl(var(--muted-foreground))]">
                  <LoaderCircle size={14} className="animate-spin" /> Loading saved register…
                </div>
              )}
              {ticketsError && (
                <div className="mb-3 flex items-center gap-2 text-[12px] text-[hsl(var(--destructive))]">
                  <AlertTriangle size={14} /> Could not load the saved register. Showing this session's data only.
                </div>
              )}
              <div className="mb-3 flex items-center justify-between gap-3">
                <CostCodeFilterSelect value={costFilter} onChange={setCostFilter} />
                {costFilter !== COST_CODE_FILTER_ALL && (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Showing {visibleRows.length} of {rows.length} ticket{rows.length === 1 ? '' : 's'}</span>
                )}
              </div>
              <TicketRegister rows={visibleRows} onChange={updateField} onCategoryChange={updateCategory} onCostCodeChange={updateCostCode} onDiversionMaterialChange={updateDiversionMaterial} onDelete={deleteRow} onRetry={retryRow} onPreview={setPreviewRow} />
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={addManualRow}
                  className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-white px-3.5 py-2 text-[12px] font-semibold transition hover:border-[hsl(var(--primary)/.5)] hover:bg-[hsl(var(--primary)/.04)]"
                >
                  <Plus size={14} /> Add Manual Row
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={exportLeed}
                    disabled={!rows.length}
                    className="flex items-center gap-2 rounded-md border border-[hsl(var(--primary)/.5)] bg-white px-4 py-2 text-[12px] font-semibold text-[hsl(var(--primary))] shadow-sm transition hover:bg-[hsl(var(--primary))] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FileSpreadsheet size={14} /> Export LEED Report
                    <span className="ml-1 border-l border-current/25 pl-2 font-mono-app text-[10px]">.xlsx</span>
                  </button>
                  <button
                    onClick={exportCsv}
                    disabled={!rows.length}
                    className="flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[hsl(var(--primary)/.9)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowDownToLine size={14} /> Export CSV
                    <span className="ml-1 border-l border-white/25 pl-2 font-mono-app text-[10px]">.csv</span>
                  </button>
                </div>
              </div>
              <DiversionPanel rows={rows} />
              <CostCodeReport totals={visibleCostCodeTotals} />
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-4 text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
            <div className="flex items-center gap-2">
              <HardHat size={12} /> D.H. Griffin Companies — DHG Register
            </div>
            <div className="flex items-center gap-4">
              <span>v1.0</span>
              <span className="font-mono-app">Local Workspace</span>
            </div>
          </footer>
        </main>
      </div>

      {notice && <Notice notice={notice} />}
      {previewRow && <PreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />}
      {budgetOpen && (
        <BudgetBuilder
          jobId={job.id}
          jobNumber={job.jobNumber}
          jobName={job.jobName}
          announce={announce}
          onClose={() => setBudgetOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Root app — manages navigation state ─────────────────────────────────────

type NavState =
  | { screen: 'home' }
  | { screen: 'register'; year: Year; job: Job };

function App() {
  const [nav, setNav] = useState<NavState>({ screen: 'home' });

  if (nav.screen === 'home') {
    return (
      <HomeScreen
        onSelect={(year, job) => setNav({ screen: 'register', year, job })}
      />
    );
  }

  return (
    <Register
      year={nav.year}
      job={nav.job}
      onBackToJobs={() => setNav({ screen: 'home' })}
      onBackToYears={() => setNav({ screen: 'home' })}
    />
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter>
          <Switch>
            <Route path="/login" component={LoginPage} />
            <Route path="/">
              <AuthGate>
                <App />
              </AuthGate>
            </Route>
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
