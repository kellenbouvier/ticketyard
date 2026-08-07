import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useExtractTicket, useHealthCheck } from '@workspace/api-client-react';
import type { TicketExtraction, TicketExtractionInput } from '@workspace/api-client-react';
import {
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  Briefcase,
  Check,
  ChevronDown,
  CircleHelp,
  CircleX,
  ClipboardList,
  CloudUpload,
  FileImage,
  FileText,
  FolderOpen,
  HardHat,
  Inbox,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  ZoomIn,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

// ─── Job list ────────────────────────────────────────────────────────────────
// Edit this array to update the jobs shown on the home screen.
// Format: { jobNumber: "##-##-####", jobName: "..." }
// Do NOT include state initials, addresses, or other location data here.

type Job = { jobNumber: string; jobName: string };

const JOBS: Job[] = [
  { jobNumber: '26-25-1325', jobName: 'DH Griffin - Lovett STEM Academy' },
  { jobNumber: '26-25-1040', jobName: 'DHGMJV - H-JAIA Concourse D Widening-South' },
  { jobNumber: '26-25-0982', jobName: 'DH Griffin - Wellstar Kennestone Hospital Expansion' },
  { jobNumber: '26-25-0874', jobName: 'DH Griffin - Atlanta BeltLine Trail Extension' },
  { jobNumber: '26-25-0721', jobName: 'DH Griffin - Hartsfield-Jackson Terminal Renovation' },
  { jobNumber: '25-25-9631', jobName: 'Johnson/Kreis Construction - First Baptist Church of Covington' },
  { jobNumber: '25-25-9445', jobName: 'DH Griffin - Georgia Tech Campus Renewal' },
  { jobNumber: '25-25-9210', jobName: 'DH Griffin - I-285 Bridge Rehabilitation' },
  { jobNumber: '25-25-8876', jobName: 'DH Griffin - Fulton County Courthouse Demo' },
  { jobNumber: '25-25-8542', jobName: 'DH Griffin - Ponce City Market Phase 3' },
];

// ─── Row / extraction types ───────────────────────────────────────────────────

type RowStatus = 'Reading' | 'Processed' | 'Failed' | 'Manual';
type FieldKey = keyof TicketExtraction;
type TicketRow = {
  id: string;
  fileName: string;
  preview: string;
  status: RowStatus;
  extraction: TicketExtraction;
  error?: string;
};

const emptyExtraction: TicketExtraction = {
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
  wasteType: '',
};

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
  { key: 'wasteType', label: 'Waste Type', short: 'Waste Type' },
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function getSupportedMediaType(file: File): TicketExtractionInput['mediaType'] | null {
  if (acceptedTypes.includes(file.type)) {
    return file.type as TicketExtractionInput['mediaType'];
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
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

const samplePreview = (name: string, accent: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="700" height="460" viewBox="0 0 700 460">
      <rect width="700" height="460" fill="#d9d5cb"/>
      <g transform="translate(104 30) rotate(-4 250 195)">
        <rect width="500" height="390" rx="3" fill="#f9f6ee"/>
        <rect x="24" y="24" width="452" height="55" fill="${accent}" opacity=".9"/>
        <text x="43" y="60" font-family="Arial" font-size="22" font-weight="bold" fill="#fff">${name}</text>
        <path d="M28 111h430M28 145h350M28 179h408M28 240h430M28 274h390M28 308h240" stroke="#252b36" stroke-width="7" opacity=".48"/>
        <rect x="330" y="215" width="142" height="90" fill="#e8e2d6"/>
        <path d="M350 258h104M350 278h72" stroke="#252b36" stroke-width="6" opacity=".35"/>
        <text x="28" y="360" font-family="monospace" font-size="13" fill="#62656a">SOURCE / ${name.toUpperCase()}</text>
      </g>
    </svg>
  `)}`;

// ─── Shared small components ─────────────────────────────────────────────────

function StatusPill({ status }: { status: RowStatus }) {
  const styles: Record<RowStatus, string> = {
    Reading: 'bg-[hsl(var(--primary)/.14)] text-[hsl(30_73%_35%)]',
    Processed: 'bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent))]',
    Failed: 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]',
    Manual: 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]',
  };
  return (
    <span data-testid={`status-row-${status.toLowerCase()}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles[status]}`}>
      {status === 'Reading' && <LoaderCircle size={12} className="animate-spin" />}
      {status === 'Processed' && <Check size={12} strokeWidth={2.5} />}
      {status === 'Failed' && <CircleX size={12} />}
      {status === 'Manual' && <PencilMark />}
      {status}
    </span>
  );
}

function PencilMark() {
  return <span className="text-[10px] font-bold">/</span>;
}

function StatCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'amber' | 'teal' | 'ink' }) {
  const toneClass = tone === 'amber' ? 'text-[hsl(var(--primary))]' : tone === 'teal' ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--foreground))]';
  return (
    <div className="stat-card rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.78)] p-4 shadow-[0_3px_0_hsl(var(--foreground)/.025)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span>
        <span className={`h-2 w-2 rounded-full ${tone === 'amber' ? 'bg-[hsl(var(--primary))]' : tone === 'teal' ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--foreground)/.35)]'}`} />
      </div>
      <div data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`} className={`stat-value font-display text-[1.8rem] font-semibold tracking-[-.04em] ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{detail}</div>
    </div>
  );
}

function AppMark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-[10px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[3px_3px_0_hsl(var(--primary)/.25)]">
        <span className="absolute left-[9px] top-[8px] h-[3px] w-5 rounded bg-current" />
        <span className="absolute left-[9px] top-[14px] h-[3px] w-3 rounded bg-current" />
        <span className="absolute left-[9px] top-[20px] h-[3px] w-4 rounded bg-current" />
        <span className="absolute bottom-[7px] right-[7px] h-2 w-2 rounded-full border-2 border-current" />
      </div>
      <span className="font-display text-[1.35rem] font-bold tracking-[-.045em]">TicketYard</span>
    </div>
  );
}

// ─── Job selector page ────────────────────────────────────────────────────────

function JobSelector({ onSelect }: { onSelect: (job: Job) => void }) {
  const [query, setQuery] = useState('');
  const { isLoading: healthLoading, isError: healthError } = useHealthCheck();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return JOBS;
    return JOBS.filter(
      (j) => j.jobNumber.toLowerCase().includes(q) || j.jobName.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="app-noise flex min-h-[100dvh] flex-col bg-[hsl(var(--background))]">
      {/* Header */}
      <header className="flex h-[70px] items-center justify-between border-b border-[hsl(var(--border)/.72)] bg-[hsl(var(--background)/.8)] px-5 backdrop-blur md:px-9">
        <AppMark />
        <div className="flex items-center gap-3">
          <div data-testid="status-api-health" className="hidden items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))] sm:flex">
            <span className={`h-2 w-2 rounded-full ${healthLoading ? 'bg-[hsl(var(--primary))]' : healthError ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--accent))]'}`} />
            {healthLoading ? 'Checking service' : healthError ? 'Service unavailable' : 'Local OCR ready'}
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-[hsl(var(--accent-foreground))]">MR</div>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 md:px-9 md:py-14">
        <div className="mb-10 animate-rise">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> D.H. Griffin Operations
          </div>
          <h1 className="font-display text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[.95] tracking-[-.055em]">
            Select a job<br /><span className="text-[hsl(var(--primary))]">to get started.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            Choose the job you're working on. Tickets and invoices you upload will be kept with that job.
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-6 animate-rise delay-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            data-testid="input-job-search"
            type="search"
            placeholder="Search by job number or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-[hsl(var(--primary)/.6)] focus:bg-[hsl(var(--card))]"
          />
        </div>

        {/* Job cards */}
        <div className="animate-rise delay-2 space-y-2">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] py-16 text-center">
              <Inbox size={26} className="text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">No jobs match "{query}"</p>
            </div>
          )}
          {filtered.map((job) => (
            <button
              key={job.jobNumber}
              data-testid={`button-job-${job.jobNumber}`}
              onClick={() => onSelect(job)}
              className="group flex w-full items-center gap-4 rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.75)] px-5 py-4 text-left shadow-[0_2px_0_hsl(var(--foreground)/.03)] transition hover:border-[hsl(var(--primary)/.45)] hover:bg-[hsl(var(--card))] hover:shadow-[0_3px_0_hsl(var(--primary)/.1)]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] transition group-hover:bg-[hsl(var(--primary)/.18)]">
                <Briefcase size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono-app text-[11px] font-bold tracking-[.06em] text-[hsl(var(--muted-foreground))]">{job.jobNumber}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-[hsl(var(--foreground))]">{job.jobName}</div>
              </div>
              <ChevronDown size={16} className="-rotate-90 text-[hsl(var(--muted-foreground))] transition group-hover:text-[hsl(var(--primary))]" />
            </button>
          ))}
        </div>
      </main>

      <footer className="border-t border-[hsl(var(--border)/.65)] px-5 py-4 text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] md:px-9">
        <div className="flex items-center gap-2"><HardHat size={13} /> Built for the people who keep the site moving.</div>
      </footer>
    </div>
  );
}

// ─── Register sidebar ─────────────────────────────────────────────────────────

function Sidebar({ job, onNewBatch, onBack }: { job: Job; onNewBatch: () => void; onBack: () => void }) {
  return (
    <aside className="hidden min-h-[100dvh] w-[236px] shrink-0 flex-col bg-[hsl(var(--sidebar))] px-4 py-5 text-[hsl(var(--sidebar-foreground))] md:flex">
      <div className="px-2"><AppMark /></div>

      {/* Active job */}
      <div className="mt-6 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.55)] p-3.5">
        <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[hsl(var(--sidebar-foreground)/.45)]">Active job</div>
        <div className="mt-1 font-mono-app text-[11px] font-bold text-[hsl(var(--sidebar-primary))]">{job.jobNumber}</div>
        <div className="mt-0.5 text-xs font-semibold leading-4 text-[hsl(var(--sidebar-foreground))]">{job.jobName}</div>
      </div>

      <div className="mt-6">
        <div className="px-2 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.43)]">Workspace</div>
        <nav className="mt-3 space-y-1">
          <button data-testid="nav-current-workspace" className="flex w-full items-center gap-3 rounded-lg bg-[hsl(var(--sidebar-accent))] px-3 py-2.5 text-sm font-semibold text-[hsl(var(--sidebar-accent-foreground))]">
            <ClipboardList size={16} className="text-[hsl(var(--sidebar-primary))]" /> Ticket register
          </button>
          <button data-testid="nav-archive" onClick={() => window.alert('Archive is ready for your next batch.')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]">
            <Archive size={16} /> Archive
          </button>
        </nav>
      </div>
      <div className="mt-9">
        <div className="px-2 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.43)]">Actions</div>
        <button data-testid="button-sidebar-new-batch" onClick={onNewBatch} className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]">
          <Plus size={16} /> New batch
        </button>
        <button data-testid="button-switch-job" onClick={onBack} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]">
          <ArrowLeft size={16} /> Switch job
        </button>
      </div>
      <div className="mt-auto">
        <div className="mb-4 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.55)] p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-[hsl(var(--sidebar-primary))]" /> Local OCR extraction</div>
          <div className="mt-2 text-[11px] leading-4 text-[hsl(var(--sidebar-foreground)/.55)]">Fields stay reviewable. You stay in control.</div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--sidebar-primary))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" /> Ready</div>
        </div>
        <div className="flex items-center justify-between border-t border-[hsl(var(--sidebar-border))] px-2 pt-4 text-[hsl(var(--sidebar-foreground)/.55)]">
          <button data-testid="button-settings" className="flex items-center gap-2 text-xs transition hover:text-[hsl(var(--sidebar-foreground))]"><Settings2 size={15} /> Settings</button>
          <button data-testid="button-help" className="transition hover:text-[hsl(var(--sidebar-foreground))]"><CircleHelp size={16} /></button>
        </div>
      </div>
    </aside>
  );
}

// ─── Preview modal ────────────────────────────────────────────────────────────

function PreviewModal({ row, onClose }: { row: TicketRow; onClose: () => void }) {
  return (
    <div data-testid="modal-preview" className="fixed inset-0 z-40 flex items-center justify-center bg-[hsl(var(--foreground)/.65)] p-4 backdrop-blur-sm animate-fade" onClick={onClose}>
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-2xl animate-rise" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
          <div><div className="text-sm font-semibold">{row.fileName}</div><div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">Source ticket preview</div></div>
          <button data-testid="button-close-preview" onClick={onClose} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"><X size={18} /></button>
        </div>
        <div className="bg-[hsl(var(--foreground)/.06)] p-5"><img data-testid={`img-preview-${row.id}`} src={row.preview} alt={`Preview of ${row.fileName}`} className="mx-auto max-h-[65vh] w-auto max-w-full rounded-lg object-contain shadow-lg" /></div>
      </div>
    </div>
  );
}

// ─── Ticket register table ────────────────────────────────────────────────────

function TicketRegister({ rows, onChange, onDelete, onRetry, onPreview }: {
  rows: TicketRow[];
  onChange: (id: string, field: FieldKey, value: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onPreview: (row: TicketRow) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.82)] shadow-[0_5px_0_hsl(var(--foreground)/.025)] animate-rise delay-3">
      <div className="ticket-register-head flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <div>
          <div className="flex items-center gap-2"><h2 className="font-display text-lg font-semibold tracking-[-.025em]">Ticket register</h2><span className="rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{rows.length} rows</span></div>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Review the read, then send a clean record downstream.</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><span className="h-2 w-2 rounded-full bg-[hsl(var(--accent))]" /> Changes save locally</div>
      </div>
      <div className="overflow-x-auto">
        <div className="ticket-table min-w-[1100px]">
          <div className="grid grid-cols-[180px_1.05fr_1.05fr_.85fr_.8fr_.82fr_1.3fr_1fr_112px] gap-3 bg-[hsl(var(--muted)/.45)] px-5 py-2.5 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
            <div>Source</div>{fields.map((field) => <div key={field.key}>{field.short}</div>)}<div className="text-right">Actions</div>
          </div>
          {rows.length === 0 && <div className="flex flex-col items-center justify-center px-6 py-20 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]"><Inbox size={26} /></div><h3 className="mt-4 font-display text-lg font-semibold">Your register is clear</h3><p className="mt-1 max-w-xs text-sm text-[hsl(var(--muted-foreground))]">Drop a few ticket photos above and TicketYard will set up the first rows.</p></div>}
          {rows.map((row) => (
            <div data-testid={`row-ticket-${row.id}`} key={row.id} className="ticket-table-row grid grid-cols-[180px_1.05fr_1.05fr_.85fr_.8fr_.82fr_1.3fr_1fr_112px] items-center gap-3 px-5 py-3 transition">
              <div className="flex min-w-0 items-center gap-2.5">
                <button data-testid={`button-preview-${row.id}`} onClick={() => onPreview(row)} className="group relative h-10 w-12 shrink-0 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                  <img src={row.preview} alt="" className="h-full w-full object-cover transition group-hover:scale-105" /><span className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--foreground)/.48)] opacity-0 transition group-hover:opacity-100"><ZoomIn size={14} className="text-[hsl(var(--card))]" /></span>
                </button>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{row.fileName}</div>
                  <div className="mt-1"><StatusPill status={row.status} /></div>
                  {row.error && <div title={row.error} className="mt-1 max-w-[150px] truncate text-[10px] leading-4 text-[hsl(var(--destructive))]">{row.error}</div>}
                </div>
              </div>
              {fields.map((field) => <input data-testid={`input-${field.key}-${row.id}`} key={field.key} aria-label={`${field.label} for ${row.fileName}`} disabled={row.status === 'Reading'} className="ticket-field" value={row.extraction[field.key]} placeholder="—" onChange={(event) => onChange(row.id, field.key, event.target.value)} />)}
              <div className="flex items-center justify-end gap-0.5">
                {row.status === 'Failed' && <button data-testid={`button-retry-${row.id}`} onClick={() => onRetry(row.id)} title="Retry extraction" className="action-icon rounded-md p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.13)]"><RotateCw size={15} /></button>}
                <button data-testid={`button-delete-${row.id}`} onClick={() => onDelete(row.id)} title="Delete row" className="action-icon rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]"><Trash2 size={15} /></button>
                <button data-testid={`button-row-menu-${row.id}`} onClick={() => window.alert(row.error ?? 'This row is ready for review.')} title="Row details" className="action-icon rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><MoreHorizontal size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Register view (formerly Home) ───────────────────────────────────────────

function Register({
  job,
  rows,
  setRows,
  onBack,
}: {
  job: Job;
  rows: TicketRow[];
  setRows: (updater: (rows: TicketRow[]) => TicketRow[]) => void;
  onBack: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [previewRow, setPreviewRow] = useState<TicketRow | null>(null);
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isLoading: healthLoading, isError: healthError } = useHealthCheck();
  const extractMutation = useExtractTicket();

  const announce = useCallback((message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    setNotice({ message, kind });
    window.setTimeout(() => setNotice((current) => current?.message === message ? null : current), 3600);
  }, []);

  const processFile = useCallback(async (file: File) => {
    const mediaType = getSupportedMediaType(file);
    if (!mediaType) {
      announce(`${file.name} can't be added. Use JPG, PNG, WEBP, or GIF files.`, 'error');
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const preview = URL.createObjectURL(file);
    const row: TicketRow = { id, fileName: file.name, preview, status: 'Reading', extraction: emptyExtraction };
    setRows((current) => [row, ...current]);
    announce(`Reading ${file.name}…`, 'info');
    try {
      const imageData = await readFileAsBase64(file);
      const extraction = await extractMutation.mutateAsync({
        data: { fileName: file.name, mediaType, imageData },
      });
      setRows((current) => current.map((item) => item.id === id ? { ...item, extraction, status: 'Processed' } : item));
      announce(`${file.name} processed. Give the fields a quick look.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Extraction did not complete. Check the image and try again.';
      setRows((current) => current.map((item) => item.id === id ? { ...item, status: 'Failed', error: message } : item));
      announce(`${file.name}: ${message}`, 'error');
    }
  }, [announce, extractMutation, setRows]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => void processFile(file));
  }, [processFile]);

  const retryRow = useCallback((id: string) => {
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    setRows((current) => current.map((item) => item.id === id ? { ...item, status: 'Reading', error: undefined } : item));
    announce(`Retrying ${row.fileName}…`, 'info');
    void (async () => {
      try {
        const response = await fetch(row.preview);
        if (!response.ok) throw new Error('The source image is no longer available.');
        const blob = await response.blob();
        const imageData = await readFileAsBase64(blob);
        const extraction = await extractMutation.mutateAsync({
          data: {
            fileName: row.fileName,
            mediaType: getSupportedMediaType(new File([blob], row.fileName, { type: blob.type })) ?? 'image/jpeg',
            imageData,
          },
        });
        setRows((current) => current.map((item) => item.id === id ? { ...item, extraction, status: 'Processed', error: undefined } : item));
        announce(`${row.fileName} processed on retry.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Extraction did not complete. Check the image and try again.';
        setRows((current) => current.map((item) => item.id === id ? { ...item, status: 'Failed', error: message } : item));
        announce(`Retry failed for ${row.fileName}: ${message}`, 'error');
      }
    })();
  }, [announce, extractMutation, rows, setRows]);

  const updateField = useCallback((id: string, field: FieldKey, value: string) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, status: row.status === 'Processed' ? 'Processed' : row.status, extraction: { ...row.extraction, [field]: value } } : row));
  }, [setRows]);

  const deleteRow = useCallback((id: string) => {
    const row = rows.find((item) => item.id === id);
    setRows((current) => current.filter((item) => item.id !== id));
    if (row) announce(`${row.fileName} removed from the register.`, 'info');
  }, [announce, rows, setRows]);

  const addManualRow = useCallback(() => {
    const id = `manual-${Date.now()}`;
    setRows((current) => [{ id, fileName: 'Manual entry', preview: samplePreview('MANUAL', '#ef9f22'), status: 'Manual', extraction: emptyExtraction }, ...current]);
    announce('Blank manual row added. Fill in the fields below.');
  }, [announce, setRows]);

  const newBatch = useCallback(() => {
    if (rows.length && !window.confirm('Start a new batch? This will clear the current register.')) return;
    setRows(() => []);
    announce('New batch started. The register is ready.', 'info');
  }, [announce, rows.length, setRows]);

  const totals = useMemo(() => {
    const ticketCount = rows.length;
    const withWeight = rows.filter((row) => row.extraction.weight.trim()).length;
    const amount = rows.reduce((sum, row) => sum + (Number(row.extraction.amount.replace(/[$,\s]/g, '')) || 0), 0);
    return { ticketCount, withWeight, amount: amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) };
  }, [rows]);

  const exportCsv = useCallback(() => {
    const header = ['Document type', 'Vendor', 'Ticket number', 'Invoice number', 'Purchase Order', 'Job Number', 'Date', 'Weight', 'Amount', 'Description', 'Waste Type', 'Source file', 'Status'];
    const csvValue = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const body = rows.map((row) => [row.extraction.documentType, ...fields.map((field) => row.extraction[field.key]), row.fileName, row.status].map(csvValue).join(','));
    const blob = new Blob([[header.map(csvValue).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ticketyard-${job.jobNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    announce(`${rows.length} rows exported as CSV.`);
  }, [announce, job.jobNumber, rows]);

  const openBrowse = () => fileInputRef.current?.click();

  return (
    <div className="app-noise flex min-h-[100dvh] bg-[hsl(var(--background))]">
      <Sidebar job={job} onNewBatch={newBatch} onBack={onBack} />
      <main className="min-w-0 flex-1">
        <header className="flex h-[70px] items-center justify-between border-b border-[hsl(var(--border)/.72)] bg-[hsl(var(--background)/.8)] px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-3">
            <button data-testid="button-mobile-menu" className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] md:hidden"><Menu size={19} /></button>
            <div className="md:hidden"><AppMark /></div>
            {/* Mobile back button */}
            <button data-testid="button-back-to-jobs" onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] md:flex">
              <ArrowLeft size={14} /><span className="hidden sm:inline">Jobs</span>
            </button>
            <div className="hidden items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] md:flex">
              <ChevronDown size={13} className="-rotate-90" />
              <span className="font-mono-app text-[11px] font-bold tracking-[.06em] text-[hsl(var(--foreground))]">{job.jobNumber}</span>
              <span className="text-[hsl(var(--muted-foreground)/.6)]">·</span>
              <span className="font-semibold text-[hsl(var(--foreground))]">Ticket register</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div data-testid="status-api-health" className="hidden items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))] sm:flex">
              <span className={`h-2 w-2 rounded-full ${healthLoading ? 'bg-[hsl(var(--primary))]' : healthError ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--accent))]'}`} />
              {healthLoading ? 'Checking service' : healthError ? 'Service unavailable' : 'Local OCR ready'}
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-[hsl(var(--accent-foreground))]">MR</div>
          </div>
        </header>
        <div className="mx-auto max-w-[1450px] px-5 py-7 md:px-9 md:py-10">
          <div className="mb-8 flex items-end justify-between gap-5 animate-rise">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> Morning yard run</div>
              <h1 className="font-display text-[clamp(2.3rem,5vw,4.25rem)] font-semibold leading-[.95] tracking-[-.065em]">Make the paper<br /><span className="text-[hsl(var(--primary))]">pull its weight.</span></h1>
              <p className="mt-4 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">Upload the tickets from today's hauls. TicketYard reads the mess, leaves you the final say, and keeps the register moving.</p>
            </div>
            <div className="hidden items-center gap-2 pb-1 lg:flex"><span className="font-mono-app text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Job / <span className="text-[hsl(var(--foreground))]">{job.jobNumber}</span></span><button data-testid="button-batch-menu" onClick={() => window.alert('Batch options are available from this workspace.')} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><MoreHorizontal size={18} /></button></div>
          </div>

          <div className="stats-grid mb-6 grid grid-cols-3 gap-3 md:gap-4">
            <StatCard label="Tickets" value={String(totals.ticketCount).padStart(2, '0')} detail="in this batch" tone="ink" />
            <StatCard label="With weight" value={String(totals.withWeight).padStart(2, '0')} detail={totals.ticketCount ? `${Math.round(totals.withWeight / totals.ticketCount * 100)}% of register` : 'waiting on reads'} tone="teal" />
            <StatCard label="Total amount" value={totals.amount} detail="ready to export" tone="amber" />
          </div>

          <div className="workspace-grid grid grid-cols-[minmax(290px,.65fr)_minmax(0,1.35fr)] gap-5">
            <div className="space-y-5">
              <section className={`drop-zone rounded-2xl p-5 transition duration-200 md:p-6 ${dragging ? 'is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFiles(event.dataTransfer.files); }}>
                <input ref={fileInputRef} data-testid="input-ticket-files" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={(event) => { if (event.target.files) handleFiles(event.target.files); event.target.value = ''; }} />
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.16)] text-[hsl(var(--primary))]"><CloudUpload size={24} /></div>
                <h2 className="mt-5 font-display text-xl font-semibold tracking-[-.03em]">{dragging ? 'Drop tickets here' : 'Bring in the pile'}</h2>
                <p className="mt-2 max-w-xs text-sm leading-5 text-[hsl(var(--muted-foreground))]">Drop photos here or browse your camera roll. We'll keep the original attached to every row.</p>
                <button data-testid="button-browse-tickets" onClick={openBrowse} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--foreground))] px-3.5 py-2.5 text-xs font-bold text-[hsl(var(--background))] shadow-[0_2px_0_hsl(var(--foreground)/.2)] transition hover:-translate-y-px"><UploadCloud size={15} /> Browse tickets</button>
                <div className="mt-5 flex items-center gap-2 border-t border-[hsl(var(--border)/.75)] pt-4 text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]"><FileImage size={13} /> JPG, PNG, WEBP, GIF <span className="ml-auto font-mono-app normal-case tracking-normal">Up to 25 MB</span></div>
              </section>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.42)] p-5">
                <div className="flex items-start gap-3"><div className="mt-0.5 text-[hsl(var(--accent))]"><Sparkles size={17} /></div><div><h3 className="text-sm font-semibold">A fast first read, not a black box.</h3><p className="mt-1.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Local OCR suggests the fields. Your superintendent signs off. Every correction stays visible before the CSV leaves the yard.</p></div></div>
              </div>
            </div>
            <div className="min-w-0">
              <TicketRegister rows={rows} onChange={updateField} onDelete={deleteRow} onRetry={retryRow} onPreview={setPreviewRow} />
              <div className="mobile-stack mt-4 flex items-center justify-between gap-3">
                <button data-testid="button-add-manual-row" onClick={addManualRow} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] px-3.5 py-2.5 text-xs font-semibold text-[hsl(var(--foreground))] transition hover:border-[hsl(var(--primary)/.6)] hover:bg-[hsl(var(--card))]"><Plus size={15} /> Add manual row</button>
                <button data-testid="button-export-csv" onClick={exportCsv} disabled={!rows.length} className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] shadow-[0_2px_0_hsl(var(--primary)/.3)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45"><ArrowDownToLine size={15} /> Export CSV <span className="ml-1 border-l border-[hsl(var(--primary-foreground)/.25)] pl-2 font-mono-app text-[10px]">.csv</span></button>
              </div>
            </div>
          </div>
          <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.65)] pt-5 text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]"><div className="flex items-center gap-2"><HardHat size={14} /> Built for the people who keep the site moving.</div><div className="flex items-center gap-4"><span>TicketYard v1.0</span><span className="font-mono-app">LOCAL WORKSPACE</span></div></footer>
        </div>
      </main>
      {notice && <div data-testid="status-notice" aria-live="polite" className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl animate-rise ${notice.kind === 'error' ? 'border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--card))] text-[hsl(var(--destructive))]' : notice.kind === 'info' ? 'border-[hsl(var(--primary)/.3)] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]' : 'border-[hsl(var(--accent)/.35)] bg-[hsl(var(--card))] text-[hsl(var(--accent))]'}`}>{notice.kind === 'error' ? <AlertTriangle size={15} /> : notice.kind === 'info' ? <LoaderCircle size={15} className={notice.message.includes('…') ? 'animate-spin' : ''} /> : <Check size={15} />}{notice.message}</div>}
      {previewRow && <PreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />}
    </div>
  );
}

// ─── Root app — manages job selection and per-job row storage ─────────────────

function App() {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  // Rows are stored per job so switching jobs doesn't mix records.
  const [rowsByJob, setRowsByJob] = useState<Record<string, TicketRow[]>>({});

  const jobRows = selectedJob ? (rowsByJob[selectedJob.jobNumber] ?? []) : [];

  const setJobRows = useCallback(
    (updater: (rows: TicketRow[]) => TicketRow[]) => {
      if (!selectedJob) return;
      setRowsByJob((prev) => ({
        ...prev,
        [selectedJob.jobNumber]: updater(prev[selectedJob.jobNumber] ?? []),
      }));
    },
    [selectedJob],
  );

  if (!selectedJob) {
    return <JobSelector onSelect={setSelectedJob} />;
  }

  return (
    <Register
      job={selectedJob}
      rows={jobRows}
      setRows={setJobRows}
      onBack={() => setSelectedJob(null)}
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
            <Route path="/" component={App} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
