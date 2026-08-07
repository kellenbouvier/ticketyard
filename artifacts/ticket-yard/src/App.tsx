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
  getListYearsQueryKey,
  getListJobsQueryKey,
} from '@workspace/api-client-react';
import type {
  Year,
  Job,
  TicketExtraction,
  TicketExtractionInput,
} from '@workspace/api-client-react';
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
  HardHat,
  Home,
  Inbox,
  LoaderCircle,
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
  X,
  ZoomIn,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

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

const samplePreview = () =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="700" height="460" viewBox="0 0 700 460">
      <rect width="700" height="460" fill="#e8e8e8"/>
      <g transform="translate(104 30) rotate(-4 250 195)">
        <rect width="500" height="390" rx="3" fill="#f9f9f9"/>
        <rect x="24" y="24" width="452" height="55" fill="#C32020" opacity=".9"/>
        <path d="M28 111h430M28 145h350M28 179h408M28 240h430M28 274h390M28 308h240" stroke="#252b36" stroke-width="7" opacity=".4"/>
        <text x="28" y="360" font-family="monospace" font-size="13" fill="#888">MANUAL ENTRY</text>
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
        <span className="text-[13px] font-semibold tracking-wide text-white/90">TicketYard</span>
      </div>
      {/* Middle slot (breadcrumbs etc.) */}
      {children && <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">{children}</div>}
      {/* Right slot */}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <ApiStatus />
        {trailing ?? (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--sidebar-primary))] text-[11px] font-bold text-white">MR</div>
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
            className="group grid grid-cols-[40px_180px_1fr_160px_90px_100px] items-center gap-4 border-t border-[hsl(var(--border)/.5)] px-6 py-3.5 transition hover:bg-[hsl(var(--muted)/.25)]"
          >
            <div className="flex items-center justify-center">
              <CalendarDays size={15} className="text-[hsl(var(--muted-foreground)/.45)]" />
            </div>
            <div>
              <span className="font-mono-app text-[11px] font-bold tracking-wider text-[hsl(var(--primary))]">
                {job.jobNumber}
              </span>
            </div>
            <div className="min-w-0 truncate text-[13px] text-[hsl(var(--foreground))]">{job.jobName}</div>
            <div className="text-[12px] text-[hsl(var(--muted-foreground))]">—</div>
            <div className="text-right font-mono-app text-[12px] text-[hsl(var(--muted-foreground))]">—</div>
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={() => setModal({ open: true, mode: 'edit', job, jobNumber: job.jobNumber, jobName: job.jobName, error: '' })}
                title="Edit"
                className="rounded p-1.5 text-[hsl(var(--muted-foreground))] opacity-0 transition hover:text-[hsl(var(--foreground))] group-hover:opacity-100"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => void handleDeleteJob(job)}
                title="Delete"
                className="rounded p-1.5 text-[hsl(var(--muted-foreground))] opacity-0 transition hover:text-[hsl(var(--destructive))] group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
              <button
                onClick={() => onOpen(job)}
                className="rounded border border-[hsl(var(--primary)/.5)] px-3 py-1 text-[11px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary))] hover:text-white"
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
    </>
  );
}

// ─── Home screen ──────────────────────────────────────────────────────────────

function HomeScreen({ onSelect }: { onSelect: (year: Year, job: Job) => void }) {
  const qc = useQueryClient();
  const { data: years = [], isLoading: yearsLoading, isError: yearsError } = useListYears();
  const createYear = useCreateYear();
  const deleteYear = useDeleteYear();

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
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/.15)] border border-[hsl(var(--primary)/.25)] text-[hsl(var(--primary))]">
            <User size={16} strokeWidth={1.75} />
          </div>
        </div>

        {/* Hero */}
        <div className="px-8 pt-4 pb-6 shrink-0">
          <h1 className="text-[1.85rem] font-bold tracking-tight text-[hsl(var(--foreground))]">
            Welcome to{' '}
            <span className="text-[hsl(var(--primary))]">TicketYard</span>
          </h1>
          <p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">
            Select a year to view your jobs
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
  return (
    <aside className="hidden min-h-[100dvh] w-[220px] shrink-0 flex-col bg-[hsl(var(--sidebar))] md:flex">
      {/* Logo + app name */}
      <div className="flex h-[54px] shrink-0 items-center gap-3 border-b border-white/[.07] px-5">
        <img src="/dhg-logo.png" alt="D.H. Griffin Companies" className="h-7 w-auto" />
        <div className="h-4 w-px bg-white/20" />
        <span className="text-[13px] font-semibold tracking-wide text-white/90">TicketYard</span>
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
          </div>
        </div>
      </div>
    </aside>
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
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Changes save locally
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          <div className="grid grid-cols-[170px_1.05fr_1.05fr_.85fr_.8fr_.82fr_1.3fr_1fr_108px] gap-3 bg-[hsl(var(--muted)/.5)] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
            <div>Source</div>{fields.map((f) => <div key={f.key}>{f.short}</div>)}<div className="text-right">Actions</div>
          </div>
          {rows.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
                <Inbox size={22} />
              </div>
              <h3 className="mt-3 text-[14px] font-semibold">Register is empty</h3>
              <p className="mt-1 max-w-xs text-[12px] text-[hsl(var(--muted-foreground))]">Upload ticket photos to the left and TicketYard will populate the rows.</p>
            </div>
          )}
          {rows.map((row) => (
            <div key={row.id} className="ticket-table-row grid grid-cols-[170px_1.05fr_1.05fr_.85fr_.8fr_.82fr_1.3fr_1fr_108px] items-center gap-3 px-5 py-3 transition">
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
              <div className="flex items-center justify-end gap-0.5">
                {row.status === 'Failed' && (
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

// ─── Ticket register page ─────────────────────────────────────────────────────

function Register({ year, job, rows, setRows, onBackToJobs, onBackToYears }: {
  year: Year;
  job: Job;
  rows: TicketRow[];
  setRows: (updater: (rows: TicketRow[]) => TicketRow[]) => void;
  onBackToJobs: () => void;
  onBackToYears: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [previewRow, setPreviewRow] = useState<TicketRow | null>(null);
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractMutation = useExtractTicket();

  const announce = useCallback((message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    setNotice({ message, kind });
    setTimeout(() => setNotice((c) => c?.message === message ? null : c), 3600);
  }, []);

  const processFile = useCallback(async (file: File) => {
    const mediaType = getSupportedMediaType(file);
    if (!mediaType) { announce(`${file.name} isn't supported. Use JPG, PNG, WEBP, or GIF.`, 'error'); return; }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const preview = URL.createObjectURL(file);
    setRows((cur) => [{ id, fileName: file.name, preview, status: 'Reading', extraction: emptyExtraction }, ...cur]);
    announce(`Reading ${file.name}…`, 'info');
    try {
      const imageData = await readFileAsBase64(file);
      const extraction = await extractMutation.mutateAsync({ data: { fileName: file.name, mediaType, imageData } });
      setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction, status: 'Processed' } : r));
      announce(`${file.name} processed. Give the fields a quick look.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction did not complete.';
      setRows((cur) => cur.map((r) => r.id === id ? { ...r, status: 'Failed', error: message } : r));
      announce(`${file.name}: ${message}`, 'error');
    }
  }, [announce, extractMutation, setRows]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((f) => void processFile(f));
  }, [processFile]);

  const retryRow = useCallback((id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setRows((cur) => cur.map((r) => r.id === id ? { ...r, status: 'Reading', error: undefined } : r));
    announce(`Retrying ${row.fileName}…`, 'info');
    void (async () => {
      try {
        const response = await fetch(row.preview);
        if (!response.ok) throw new Error('Source image is no longer available.');
        const blob = await response.blob();
        const imageData = await readFileAsBase64(blob);
        const mediaType = getSupportedMediaType(new File([blob], row.fileName, { type: blob.type })) ?? 'image/jpeg';
        const extraction = await extractMutation.mutateAsync({ data: { fileName: row.fileName, mediaType, imageData } });
        setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction, status: 'Processed', error: undefined } : r));
        announce(`${row.fileName} processed on retry.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Extraction did not complete.';
        setRows((cur) => cur.map((r) => r.id === id ? { ...r, status: 'Failed', error: message } : r));
        announce(`Retry failed for ${row.fileName}: ${message}`, 'error');
      }
    })();
  }, [announce, extractMutation, rows, setRows]);

  const updateField = useCallback((id: string, field: FieldKey, value: string) => {
    setRows((cur) => cur.map((r) => r.id === id ? { ...r, extraction: { ...r.extraction, [field]: value } } : r));
  }, [setRows]);

  const deleteRow = useCallback((id: string) => {
    const row = rows.find((r) => r.id === id);
    setRows((cur) => cur.filter((r) => r.id !== id));
    if (row) announce(`${row.fileName} removed.`, 'info');
  }, [announce, rows, setRows]);

  const addManualRow = useCallback(() => {
    const id = `manual-${Date.now()}`;
    setRows((cur) => [{ id, fileName: 'Manual entry', preview: samplePreview(), status: 'Manual', extraction: emptyExtraction }, ...cur]);
    announce('Blank manual row added.');
  }, [announce, setRows]);

  const newBatch = useCallback(() => {
    if (rows.length && !window.confirm('Start a new batch? This will clear the current register.')) return;
    setRows(() => []);
    announce('New batch started.', 'info');
  }, [announce, rows.length, setRows]);

  const totals = useMemo(() => {
    const withWeight = rows.filter((r) => r.extraction.weight.trim()).length;
    const amount = rows.reduce((s, r) => s + (Number(r.extraction.amount.replace(/[$,\s]/g, '')) || 0), 0);
    return { count: rows.length, withWeight, amount: amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) };
  }, [rows]);

  const exportCsv = useCallback(() => {
    const header = ['Document type', 'Vendor', 'Ticket number', 'Invoice number', 'Purchase Order', 'Job Number', 'Date', 'Weight', 'Amount', 'Description', 'Waste Type', 'Source file', 'Status'];
    const v = (s: string) => `"${s.replaceAll('"', '""')}"`;
    const body = rows.map((r) => [r.extraction.documentType, ...fields.map((f) => r.extraction[f.key]), r.fileName, r.status].map(v).join(','));
    const blob = new Blob([[header.map(v).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ticketyard-${job.jobNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    announce(`${rows.length} rows exported.`);
  }, [announce, job.jobNumber, rows]);

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
            </div>
          </div>

          {/* Stat cards */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <StatCard label="Tickets" value={String(totals.count).padStart(2, '0')} detail="in this batch" tone="ink" />
            <StatCard label="With Weight" value={String(totals.withWeight).padStart(2, '0')} detail={totals.count ? `${Math.round(totals.withWeight / totals.count * 100)}% of register` : 'awaiting upload'} tone="slate" />
            <StatCard label="Total Amount" value={totals.amount} detail="ready for export" tone="red" />
          </div>

          {/* Main content grid */}
          <div className="grid grid-cols-[minmax(280px,.6fr)_minmax(0,1.4fr)] gap-5">
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
              <TicketRegister rows={rows} onChange={updateField} onDelete={deleteRow} onRetry={retryRow} onPreview={setPreviewRow} />
              <div className="mt-3.5 flex items-center justify-between gap-3">
                <button
                  onClick={addManualRow}
                  className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-white px-3.5 py-2 text-[12px] font-semibold transition hover:border-[hsl(var(--primary)/.5)] hover:bg-[hsl(var(--primary)/.04)]"
                >
                  <Plus size={14} /> Add Manual Row
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
          </div>

          {/* Footer */}
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-4 text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
            <div className="flex items-center gap-2">
              <HardHat size={12} /> D.H. Griffin Companies — TicketYard
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
    </div>
  );
}

// ─── Root app — manages navigation state ─────────────────────────────────────

type NavState =
  | { screen: 'home' }
  | { screen: 'register'; year: Year; job: Job };

function App() {
  const [nav, setNav] = useState<NavState>({ screen: 'home' });
  const [rowsByJobId, setRowsByJobId] = useState<Record<number, TicketRow[]>>({});

  const setJobRows = useCallback((jobId: number, updater: (rows: TicketRow[]) => TicketRow[]) => {
    setRowsByJobId((prev) => ({ ...prev, [jobId]: updater(prev[jobId] ?? []) }));
  }, []);

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
      rows={rowsByJobId[nav.job.id] ?? []}
      setRows={(updater) => setJobRows(nav.job.id, updater)}
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
            <Route path="/" component={App} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
