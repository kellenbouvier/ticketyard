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
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleX,
  ClipboardList,
  CloudUpload,
  FileImage,
  HardHat,
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
      <rect width="700" height="460" fill="#d9d5cb"/>
      <g transform="translate(104 30) rotate(-4 250 195)">
        <rect width="500" height="390" rx="3" fill="#f9f6ee"/>
        <rect x="24" y="24" width="452" height="55" fill="#ef9f22" opacity=".9"/>
        <path d="M28 111h430M28 145h350M28 179h408M28 240h430M28 274h390M28 308h240" stroke="#252b36" stroke-width="7" opacity=".48"/>
        <text x="28" y="360" font-family="monospace" font-size="13" fill="#62656a">MANUAL ENTRY</text>
      </g>
    </svg>
  `)}`;

// ─── Shared UI components ─────────────────────────────────────────────────────

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

function ApiStatus() {
  const { isLoading, isError } = useHealthCheck();
  return (
    <div className="hidden items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))] sm:flex">
      <span className={`h-2 w-2 rounded-full ${isLoading ? 'bg-[hsl(var(--primary))]' : isError ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--accent))]'}`} />
      {isLoading ? 'Checking service' : isError ? 'Service unavailable' : 'Local OCR ready'}
    </div>
  );
}

function StatusPill({ status }: { status: RowStatus }) {
  const styles: Record<RowStatus, string> = {
    Reading: 'bg-[hsl(var(--primary)/.14)] text-[hsl(30_73%_35%)]',
    Processed: 'bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent))]',
    Failed: 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]',
    Manual: 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles[status]}`}>
      {status === 'Reading' && <LoaderCircle size={12} className="animate-spin" />}
      {status === 'Processed' && <Check size={12} strokeWidth={2.5} />}
      {status === 'Failed' && <CircleX size={12} />}
      {status === 'Manual' && <span className="text-[10px] font-bold">/</span>}
      {status}
    </span>
  );
}

function StatCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'amber' | 'teal' | 'ink' }) {
  const toneClass = tone === 'amber' ? 'text-[hsl(var(--primary))]' : tone === 'teal' ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--foreground))]';
  return (
    <div className="rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.78)] p-4 shadow-[0_3px_0_hsl(var(--foreground)/.025)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span>
        <span className={`h-2 w-2 rounded-full ${tone === 'amber' ? 'bg-[hsl(var(--primary))]' : tone === 'teal' ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--foreground)/.35)]'}`} />
      </div>
      <div className={`font-display text-[1.8rem] font-semibold tracking-[-.04em] ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{detail}</div>
    </div>
  );
}

// ─── Simple modal wrapper ─────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--foreground)/.6)] p-4 backdrop-blur-sm animate-fade" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-2xl animate-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
          <h2 className="font-display text-lg font-semibold tracking-[-.025em]">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Image preview modal ──────────────────────────────────────────────────────

function PreviewModal({ row, onClose }: { row: TicketRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[hsl(var(--foreground)/.65)] p-4 backdrop-blur-sm animate-fade" onClick={onClose}>
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-2xl animate-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
          <div><div className="text-sm font-semibold">{row.fileName}</div><div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">Source ticket preview</div></div>
          <button onClick={onClose} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"><X size={18} /></button>
        </div>
        <div className="bg-[hsl(var(--foreground)/.06)] p-5">
          <img src={row.preview} alt={`Preview of ${row.fileName}`} className="mx-auto max-h-[65vh] w-auto max-w-full rounded-lg object-contain shadow-lg" />
        </div>
      </div>
    </div>
  );
}

// ─── Notice banner ────────────────────────────────────────────────────────────

function Notice({ notice }: { notice: { message: string; kind: 'success' | 'error' | 'info' } }) {
  return (
    <div aria-live="polite" className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl animate-rise ${notice.kind === 'error' ? 'border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--card))] text-[hsl(var(--destructive))]' : notice.kind === 'info' ? 'border-[hsl(var(--primary)/.3)] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]' : 'border-[hsl(var(--accent)/.35)] bg-[hsl(var(--card))] text-[hsl(var(--accent))]'}`}>
      {notice.kind === 'error' ? <AlertTriangle size={15} /> : notice.kind === 'info' ? <LoaderCircle size={15} className={notice.message.includes('…') ? 'animate-spin' : ''} /> : <Check size={15} />}
      {notice.message}
    </div>
  );
}

// ─── Year selector page ───────────────────────────────────────────────────────

type AddYearModal = { open: true; value: string; error: string } | { open: false };

function YearSelector({ onSelect }: { onSelect: (year: Year) => void }) {
  const qc = useQueryClient();
  const { data: years = [], isLoading, isError } = useListYears();
  const createYear = useCreateYear();
  const deleteYear = useDeleteYear();

  const [modal, setModal] = useState<AddYearModal>({ open: false });
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' | 'info' } | null>(null);

  const announce = (message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    setNotice({ message, kind });
    setTimeout(() => setNotice((c) => c?.message === message ? null : c), 3600);
  };

  const handleAddYear = async () => {
    if (modal.open === false) return;
    const y = parseInt(modal.value, 10);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      setModal({ ...modal, error: 'Enter a valid year (e.g. 2026).' });
      return;
    }
    try {
      await createYear.mutateAsync({ data: { year: y } });
      await qc.invalidateQueries({ queryKey: getListYearsQueryKey() });
      setModal({ open: false });
      announce(`${y} added.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not add year.';
      setModal({ ...modal, error: msg.includes('409') || msg.includes('already') ? `${y} already exists.` : 'Could not add year. Try again.' });
    }
  };

  const handleDeleteYear = async (year: Year) => {
    if (!window.confirm(`Remove ${year.year} and all its jobs? This cannot be undone.\n\nTicket records (images) are session-only and will not be affected.`)) return;
    try {
      await deleteYear.mutateAsync({ yearId: year.id });
      await qc.invalidateQueries({ queryKey: getListYearsQueryKey() });
      announce(`${year.year} removed.`, 'info');
    } catch {
      announce('Could not remove year. Try again.', 'error');
    }
  };

  // Sort years descending so the newest is on top
  const sorted = [...years].sort((a, b) => b.year - a.year);

  return (
    <div className="app-noise flex min-h-[100dvh] flex-col bg-[hsl(var(--background))]">
      <header className="flex h-[70px] items-center justify-between border-b border-[hsl(var(--border)/.72)] bg-[hsl(var(--background)/.8)] px-5 backdrop-blur md:px-9">
        <AppMark />
        <div className="flex items-center gap-3">
          <ApiStatus />
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-[hsl(var(--accent-foreground))]">MR</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 md:px-9 md:py-14">
        <div className="mb-10 animate-rise">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> D.H. Griffin Operations
          </div>
          <h1 className="font-display text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[.95] tracking-[-.055em]">
            Select a year<br /><span className="text-[hsl(var(--primary))]">to get started.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            Jobs are organized by year. Choose the year you're working in, then pick a job.
          </p>
        </div>

        <div className="animate-rise delay-1 space-y-2">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <LoaderCircle size={24} className="animate-spin text-[hsl(var(--primary))]" />
            </div>
          )}
          {isError && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--card)/.5)] py-12 text-center">
              <AlertTriangle size={24} className="text-[hsl(var(--destructive))]" />
              <p className="mt-3 text-sm text-[hsl(var(--destructive))]">Could not load years. Check that the API server is running.</p>
            </div>
          )}

          {!isLoading && !isError && sorted.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.4)] py-16 text-center">
              <CalendarDays size={26} className="text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-semibold">No years yet</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Add a year to start organizing your jobs.</p>
            </div>
          )}

          {sorted.map((year) => (
            <div key={year.id} className="group flex w-full items-center gap-4 rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.75)] px-5 py-4 shadow-[0_2px_0_hsl(var(--foreground)/.03)] transition hover:border-[hsl(var(--primary)/.35)] hover:bg-[hsl(var(--card))]">
              <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => onSelect(year)}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] transition group-hover:bg-[hsl(var(--primary)/.18)]">
                  <CalendarDays size={20} />
                </div>
                <div>
                  <div className="text-xl font-bold tracking-[-.03em] text-[hsl(var(--foreground))]">{year.year}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">Tap to see jobs →</div>
                </div>
              </button>
              <button onClick={() => handleDeleteYear(year)} title={`Remove ${year.year}`} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] opacity-0 transition hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))] group-hover:opacity-100">
                <Trash2 size={16} />
              </button>
              <ChevronRight size={16} className="text-[hsl(var(--muted-foreground))] transition group-hover:text-[hsl(var(--primary))]" />
            </div>
          ))}

          {/* Add Year */}
          <button
            onClick={() => setModal({ open: true, value: String(new Date().getFullYear()), error: '' })}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-[hsl(var(--border))] bg-transparent px-5 py-4 text-sm text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary)/.5)] hover:bg-[hsl(var(--primary)/.04)] hover:text-[hsl(var(--foreground))]"
          >
            <Plus size={18} className="text-[hsl(var(--primary))]" /> Add year
          </button>
        </div>
      </main>

      <footer className="border-t border-[hsl(var(--border)/.65)] px-5 py-4 text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] md:px-9">
        <div className="flex items-center gap-2"><HardHat size={13} /> Built for the people who keep the site moving.</div>
      </footer>

      {/* Add Year modal */}
      {modal.open && (
        <Modal title="Add a year" onClose={() => setModal({ open: false })}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Year</label>
              <input
                type="number"
                autoFocus
                min={2000}
                max={2100}
                value={modal.value}
                onChange={(e) => setModal({ ...modal, value: e.target.value, error: '' })}
                onKeyDown={(e) => e.key === 'Enter' && void handleAddYear()}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-4 py-2.5 text-sm outline-none transition focus:border-[hsl(var(--primary)/.6)] focus:bg-[hsl(var(--card))]"
                placeholder="e.g. 2026"
              />
              {modal.error && <p className="mt-2 text-xs text-[hsl(var(--destructive))]">{modal.error}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal({ open: false })} className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-xs font-semibold transition hover:bg-[hsl(var(--muted))]">Cancel</button>
              <button onClick={() => void handleAddYear()} disabled={createYear.isPending} className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:opacity-50">
                {createYear.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />} Add year
              </button>
            </div>
          </div>
        </Modal>
      )}

      {notice && <Notice notice={notice} />}
    </div>
  );
}

// ─── Job selector page ────────────────────────────────────────────────────────

type JobModal =
  | { open: false }
  | { open: true; mode: 'add'; jobNumber: string; jobName: string; error: string }
  | { open: true; mode: 'edit'; job: Job; jobNumber: string; jobName: string; error: string };

function JobSelector({ year, onSelect, onBack }: { year: Year; onSelect: (job: Job) => void; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: jobs = [], isLoading, isError } = useListJobs(year.id);
  const createJob = useCreateJob();
  const updateJob = useUpdateJob();
  const deleteJob = useDeleteJob();

  const [modal, setModal] = useState<JobModal>({ open: false });
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' | 'info' } | null>(null);

  const announce = (message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    setNotice({ message, kind });
    setTimeout(() => setNotice((c) => c?.message === message ? null : c), 3600);
  };

  const invalidateJobs = () => qc.invalidateQueries({ queryKey: getListJobsQueryKey(year.id) });

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
      await invalidateJobs();
      setModal({ open: false });
    } catch {
      setModal({ ...modal, error: 'Could not save job. Try again.' });
    }
  };

  const handleDeleteJob = async (job: Job) => {
    if (!window.confirm(`Remove job ${job.jobNumber} – ${job.jobName}?\n\nThis cannot be undone.`)) return;
    try {
      await deleteJob.mutateAsync({ yearId: year.id, jobId: job.id });
      await invalidateJobs();
      announce(`${job.jobNumber} removed.`, 'info');
    } catch {
      announce('Could not remove job. Try again.', 'error');
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = jobs.filter((j) => !q || j.jobNumber.toLowerCase().includes(q) || j.jobName.toLowerCase().includes(q));

  return (
    <div className="app-noise flex min-h-[100dvh] flex-col bg-[hsl(var(--background))]">
      <header className="flex h-[70px] items-center justify-between border-b border-[hsl(var(--border)/.72)] bg-[hsl(var(--background)/.8)] px-5 backdrop-blur md:px-9">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]">
            <ArrowLeft size={14} /> Years
          </button>
          <span className="text-[hsl(var(--muted-foreground)/.4)]">/</span>
          <span className="text-sm font-semibold">{year.year}</span>
        </div>
        <div className="flex items-center gap-3"><ApiStatus /><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-[hsl(var(--accent-foreground))]">MR</div></div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 md:px-9 md:py-14">
        <div className="mb-8 animate-rise">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> {year.year} jobs
          </div>
          <h1 className="font-display text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[.95] tracking-[-.055em]">
            Select a job<br /><span className="text-[hsl(var(--primary))]">to open the register.</span>
          </h1>
        </div>

        {/* Search */}
        <div className="relative mb-4 animate-rise delay-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input type="search" placeholder="Search by job number or name…" value={query} onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-[hsl(var(--primary)/.6)] focus:bg-[hsl(var(--card))]" />
        </div>

        <div className="animate-rise delay-2 space-y-2">
          {isLoading && <div className="flex items-center justify-center py-16"><LoaderCircle size={24} className="animate-spin text-[hsl(var(--primary))]" /></div>}
          {isError && <div className="flex flex-col items-center justify-center rounded-2xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--card)/.5)] py-12 text-center"><AlertTriangle size={24} className="text-[hsl(var(--destructive))]" /><p className="mt-3 text-sm text-[hsl(var(--destructive))]">Could not load jobs.</p></div>}

          {!isLoading && !isError && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.4)] py-14 text-center">
              <Inbox size={26} className="text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-semibold">{q ? `No jobs match "${query}"` : `No jobs yet for ${year.year}`}</p>
              {!q && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Add a job below to get started.</p>}
            </div>
          )}

          {filtered.map((job) => (
            <div key={job.id} className="group flex w-full items-center gap-3 rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.75)] px-5 py-4 shadow-[0_2px_0_hsl(var(--foreground)/.03)] transition hover:border-[hsl(var(--primary)/.35)] hover:bg-[hsl(var(--card))]">
              <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => onSelect(job)}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] transition group-hover:bg-[hsl(var(--primary)/.18)]">
                  <Briefcase size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-mono-app text-[11px] font-bold tracking-[.06em] text-[hsl(var(--muted-foreground))]">{job.jobNumber}</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-[hsl(var(--foreground))]">{job.jobName}</div>
                </div>
              </button>
              {/* Edit */}
              <button onClick={() => setModal({ open: true, mode: 'edit', job, jobNumber: job.jobNumber, jobName: job.jobName, error: '' })}
                title="Edit job" className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] opacity-0 transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] group-hover:opacity-100">
                <Pencil size={15} />
              </button>
              {/* Delete */}
              <button onClick={() => void handleDeleteJob(job)} title="Remove job"
                className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] opacity-0 transition hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))] group-hover:opacity-100">
                <Trash2 size={15} />
              </button>
              <ChevronRight size={16} className="text-[hsl(var(--muted-foreground))] transition group-hover:text-[hsl(var(--primary))]" />
            </div>
          ))}

          {/* Add Job */}
          <button onClick={() => setModal({ open: true, mode: 'add', jobNumber: '', jobName: '', error: '' })}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-[hsl(var(--border))] bg-transparent px-5 py-4 text-sm text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary)/.5)] hover:bg-[hsl(var(--primary)/.04)] hover:text-[hsl(var(--foreground))]">
            <Plus size={18} className="text-[hsl(var(--primary))]" /> Add job
          </button>
        </div>
      </main>

      {/* Add / Edit modal */}
      {modal.open && (
        <Modal title={modal.mode === 'add' ? 'Add a job' : 'Edit job'} onClose={() => setModal({ open: false })}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Job Number <span className="font-normal opacity-60">(##-##-####)</span></label>
              <input type="text" autoFocus value={modal.jobNumber} onChange={(e) => setModal({ ...modal, jobNumber: e.target.value, error: '' })}
                onKeyDown={(e) => e.key === 'Enter' && void handleSaveJob()}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-4 py-2.5 text-sm outline-none transition focus:border-[hsl(var(--primary)/.6)] focus:bg-[hsl(var(--card))]"
                placeholder="e.g. 26-25-1325" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Job Name</label>
              <input type="text" value={modal.jobName} onChange={(e) => setModal({ ...modal, jobName: e.target.value, error: '' })}
                onKeyDown={(e) => e.key === 'Enter' && void handleSaveJob()}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-4 py-2.5 text-sm outline-none transition focus:border-[hsl(var(--primary)/.6)] focus:bg-[hsl(var(--card))]"
                placeholder="e.g. DH Griffin - Lovett STEM Academy" />
            </div>
            {modal.error && <p className="text-xs text-[hsl(var(--destructive))]">{modal.error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal({ open: false })} className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-xs font-semibold transition hover:bg-[hsl(var(--muted))]">Cancel</button>
              <button onClick={() => void handleSaveJob()} disabled={createJob.isPending || updateJob.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:opacity-50">
                {(createJob.isPending || updateJob.isPending) ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
                {modal.mode === 'add' ? 'Add job' : 'Save changes'}
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
    <aside className="hidden min-h-[100dvh] w-[236px] shrink-0 flex-col bg-[hsl(var(--sidebar))] px-4 py-5 text-[hsl(var(--sidebar-foreground))] md:flex">
      <div className="px-2"><AppMark /></div>

      {/* Active job */}
      <div className="mt-6 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.55)] p-3.5">
        <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[hsl(var(--sidebar-foreground)/.45)]">{year.year} · Active job</div>
        <div className="mt-1 font-mono-app text-[11px] font-bold text-[hsl(var(--sidebar-primary))]">{job.jobNumber}</div>
        <div className="mt-0.5 text-xs font-semibold leading-4 text-[hsl(var(--sidebar-foreground))]">{job.jobName}</div>
      </div>

      <div className="mt-6">
        <div className="px-2 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.43)]">Workspace</div>
        <nav className="mt-3 space-y-1">
          <button className="flex w-full items-center gap-3 rounded-lg bg-[hsl(var(--sidebar-accent))] px-3 py-2.5 text-sm font-semibold text-[hsl(var(--sidebar-accent-foreground))]">
            <ClipboardList size={16} className="text-[hsl(var(--sidebar-primary))]" /> Ticket register
          </button>
          <button onClick={() => window.alert('Archive is ready for your next batch.')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]">
            <Archive size={16} /> Archive
          </button>
        </nav>
      </div>

      <div className="mt-9">
        <div className="px-2 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.43)]">Navigate</div>
        <button onClick={onNewBatch} className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]">
          <Plus size={16} /> New batch
        </button>
        <button onClick={onBackToJobs} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]">
          <ArrowLeft size={16} /> Switch job
        </button>
        <button onClick={onBackToYears} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]">
          <CalendarDays size={16} /> Switch year
        </button>
      </div>

      <div className="mt-auto">
        <div className="mb-4 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.55)] p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-[hsl(var(--sidebar-primary))]" /> Local OCR extraction</div>
          <div className="mt-2 text-[11px] leading-4 text-[hsl(var(--sidebar-foreground)/.55)]">Fields stay reviewable. You stay in control.</div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--sidebar-primary))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" /> Ready</div>
        </div>
        <div className="flex items-center justify-between border-t border-[hsl(var(--sidebar-border))] px-2 pt-4 text-[hsl(var(--sidebar-foreground)/.55)]">
          <button className="flex items-center gap-2 text-xs transition hover:text-[hsl(var(--sidebar-foreground))]"><Settings2 size={15} /> Settings</button>
          <button className="transition hover:text-[hsl(var(--sidebar-foreground))]"><CircleHelp size={16} /></button>
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
    <section className="overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.82)] shadow-[0_5px_0_hsl(var(--foreground)/.025)] animate-rise delay-3">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <div>
          <div className="flex items-center gap-2"><h2 className="font-display text-lg font-semibold tracking-[-.025em]">Ticket register</h2><span className="rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{rows.length} rows</span></div>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Review the read, then send a clean record downstream.</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><span className="h-2 w-2 rounded-full bg-[hsl(var(--accent))]" /> Changes save locally</div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          <div className="grid grid-cols-[180px_1.05fr_1.05fr_.85fr_.8fr_.82fr_1.3fr_1fr_112px] gap-3 bg-[hsl(var(--muted)/.45)] px-5 py-2.5 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
            <div>Source</div>{fields.map((f) => <div key={f.key}>{f.short}</div>)}<div className="text-right">Actions</div>
          </div>
          {rows.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]"><Inbox size={26} /></div>
              <h3 className="mt-4 font-display text-lg font-semibold">Your register is clear</h3>
              <p className="mt-1 max-w-xs text-sm text-[hsl(var(--muted-foreground))]">Drop a few ticket photos above and TicketYard will set up the first rows.</p>
            </div>
          )}
          {rows.map((row) => (
            <div key={row.id} className="ticket-table-row grid grid-cols-[180px_1.05fr_1.05fr_.85fr_.8fr_.82fr_1.3fr_1fr_112px] items-center gap-3 px-5 py-3 transition">
              <div className="flex min-w-0 items-center gap-2.5">
                <button onClick={() => onPreview(row)} className="group relative h-10 w-12 shrink-0 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                  <img src={row.preview} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                  <span className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--foreground)/.48)] opacity-0 transition group-hover:opacity-100"><ZoomIn size={14} className="text-[hsl(var(--card))]" /></span>
                </button>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{row.fileName}</div>
                  <div className="mt-1"><StatusPill status={row.status} /></div>
                  {row.error && <div title={row.error} className="mt-1 max-w-[150px] truncate text-[10px] leading-4 text-[hsl(var(--destructive))]">{row.error}</div>}
                </div>
              </div>
              {fields.map((f) => (
                <input key={f.key} aria-label={`${f.label} for ${row.fileName}`} disabled={row.status === 'Reading'}
                  className="ticket-field" value={row.extraction[f.key]} placeholder="—"
                  onChange={(e) => onChange(row.id, f.key, e.target.value)} />
              ))}
              <div className="flex items-center justify-end gap-0.5">
                {row.status === 'Failed' && <button onClick={() => onRetry(row.id)} title="Retry extraction" className="action-icon rounded-md p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.13)]"><RotateCw size={15} /></button>}
                <button onClick={() => onDelete(row.id)} title="Delete row" className="action-icon rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]"><Trash2 size={15} /></button>
                <button onClick={() => window.alert(row.error ?? 'This row is ready for review.')} title="Row details" className="action-icon rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><MoreHorizontal size={15} /></button>
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
    <div className="app-noise flex min-h-[100dvh] bg-[hsl(var(--background))]">
      <Sidebar year={year} job={job} onNewBatch={newBatch} onBackToJobs={onBackToJobs} onBackToYears={onBackToYears} />

      <main className="min-w-0 flex-1">
        <header className="flex h-[70px] items-center justify-between border-b border-[hsl(var(--border)/.72)] bg-[hsl(var(--background)/.8)] px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-2">
            <button className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] md:hidden"><Menu size={19} /></button>
            {/* Mobile breadcrumb */}
            <div className="flex items-center gap-1.5 text-xs md:hidden">
              <button onClick={onBackToYears} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">{year.year}</button>
              <ChevronRight size={12} className="text-[hsl(var(--muted-foreground)/.5)]" />
              <button onClick={onBackToJobs} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">Jobs</button>
              <ChevronRight size={12} className="text-[hsl(var(--muted-foreground)/.5)]" />
              <span className="font-semibold">{job.jobNumber}</span>
            </div>
            {/* Desktop breadcrumb */}
            <div className="hidden items-center gap-1.5 text-xs md:flex">
              <button onClick={onBackToYears} className="text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]">{year.year}</button>
              <ChevronRight size={12} className="text-[hsl(var(--muted-foreground)/.5)]" />
              <button onClick={onBackToJobs} className="text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]">Jobs</button>
              <ChevronRight size={12} className="text-[hsl(var(--muted-foreground)/.5)]" />
              <span className="font-mono-app text-[11px] font-bold tracking-[.06em] text-[hsl(var(--foreground))]">{job.jobNumber}</span>
              <span className="text-[hsl(var(--muted-foreground)/.6)]">·</span>
              <span className="font-semibold text-[hsl(var(--foreground))]">Ticket register</span>
            </div>
          </div>
          <div className="flex items-center gap-3"><ApiStatus /><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-[hsl(var(--accent-foreground))]">MR</div></div>
        </header>

        <div className="mx-auto max-w-[1450px] px-5 py-7 md:px-9 md:py-10">
          <div className="mb-8 flex items-end justify-between gap-5 animate-rise">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> Morning yard run</div>
              <h1 className="font-display text-[clamp(2.3rem,5vw,4.25rem)] font-semibold leading-[.95] tracking-[-.065em]">Make the paper<br /><span className="text-[hsl(var(--primary))]">pull its weight.</span></h1>
              <p className="mt-4 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">Upload the tickets from today's hauls. TicketYard reads the mess, leaves you the final say, and keeps the register moving.</p>
            </div>
            <div className="hidden items-center gap-2 pb-1 lg:flex">
              <span className="font-mono-app text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Job / <span className="text-[hsl(var(--foreground))]">{job.jobNumber}</span></span>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-3 gap-3 md:gap-4">
            <StatCard label="Tickets" value={String(totals.count).padStart(2, '0')} detail="in this batch" tone="ink" />
            <StatCard label="With weight" value={String(totals.withWeight).padStart(2, '0')} detail={totals.count ? `${Math.round(totals.withWeight / totals.count * 100)}% of register` : 'waiting on reads'} tone="teal" />
            <StatCard label="Total amount" value={totals.amount} detail="ready to export" tone="amber" />
          </div>

          <div className="grid grid-cols-[minmax(290px,.65fr)_minmax(0,1.35fr)] gap-5">
            <div className="space-y-5">
              <section
                className={`drop-zone rounded-2xl p-5 transition duration-200 md:p-6 ${dragging ? 'is-dragging' : ''}`}
                onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
              >
                <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif" multiple className="hidden"
                  onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.16)] text-[hsl(var(--primary))]"><CloudUpload size={24} /></div>
                <h2 className="mt-5 font-display text-xl font-semibold tracking-[-.03em]">{dragging ? 'Drop tickets here' : 'Bring in the pile'}</h2>
                <p className="mt-2 max-w-xs text-sm leading-5 text-[hsl(var(--muted-foreground))]">Drop photos here or browse your camera roll. We'll keep the original attached to every row.</p>
                <button onClick={() => fileInputRef.current?.click()} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--foreground))] px-3.5 py-2.5 text-xs font-bold text-[hsl(var(--background))] shadow-[0_2px_0_hsl(var(--foreground)/.2)] transition hover:-translate-y-px">
                  <UploadCloud size={15} /> Browse tickets
                </button>
                <div className="mt-5 flex items-center gap-2 border-t border-[hsl(var(--border)/.75)] pt-4 text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
                  <FileImage size={13} /> JPG, PNG, WEBP, GIF <span className="ml-auto font-mono-app normal-case tracking-normal">Up to 25 MB</span>
                </div>
              </section>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.42)] p-5">
                <div className="flex items-start gap-3"><div className="mt-0.5 text-[hsl(var(--accent))]"><Sparkles size={17} /></div><div><h3 className="text-sm font-semibold">A fast first read, not a black box.</h3><p className="mt-1.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Local OCR suggests the fields. Your superintendent signs off. Every correction stays visible before the CSV leaves the yard.</p></div></div>
              </div>
            </div>

            <div className="min-w-0">
              <TicketRegister rows={rows} onChange={updateField} onDelete={deleteRow} onRetry={retryRow} onPreview={setPreviewRow} />
              <div className="mt-4 flex items-center justify-between gap-3">
                <button onClick={addManualRow} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] px-3.5 py-2.5 text-xs font-semibold transition hover:border-[hsl(var(--primary)/.6)] hover:bg-[hsl(var(--card))]">
                  <Plus size={15} /> Add manual row
                </button>
                <button onClick={exportCsv} disabled={!rows.length} className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] shadow-[0_2px_0_hsl(var(--primary)/.3)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45">
                  <ArrowDownToLine size={15} /> Export CSV <span className="ml-1 border-l border-[hsl(var(--primary-foreground)/.25)] pl-2 font-mono-app text-[10px]">.csv</span>
                </button>
              </div>
            </div>
          </div>

          <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.65)] pt-5 text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
            <div className="flex items-center gap-2"><HardHat size={14} /> Built for the people who keep the site moving.</div>
            <div className="flex items-center gap-4"><span>TicketYard v1.0</span><span className="font-mono-app">LOCAL WORKSPACE</span></div>
          </footer>
        </div>
      </main>

      {notice && <Notice notice={notice} />}
      {previewRow && <PreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />}
    </div>
  );
}

// ─── Root app — manages navigation state ─────────────────────────────────────

type NavState =
  | { screen: 'years' }
  | { screen: 'jobs'; year: Year }
  | { screen: 'register'; year: Year; job: Job };

function App() {
  const [nav, setNav] = useState<NavState>({ screen: 'years' });
  // Rows stored per job DB id — in memory (session-only, image object URLs can't persist).
  const [rowsByJobId, setRowsByJobId] = useState<Record<number, TicketRow[]>>({});

  const setJobRows = useCallback((jobId: number, updater: (rows: TicketRow[]) => TicketRow[]) => {
    setRowsByJobId((prev) => ({ ...prev, [jobId]: updater(prev[jobId] ?? []) }));
  }, []);

  if (nav.screen === 'years') {
    return <YearSelector onSelect={(year) => setNav({ screen: 'jobs', year })} />;
  }
  if (nav.screen === 'jobs') {
    return (
      <JobSelector
        year={nav.year}
        onSelect={(job) => setNav({ screen: 'register', year: nav.year, job })}
        onBack={() => setNav({ screen: 'years' })}
      />
    );
  }
  // screen === 'register'
  return (
    <Register
      year={nav.year}
      job={nav.job}
      rows={rowsByJobId[nav.job.id] ?? []}
      setRows={(updater) => setJobRows(nav.job.id, updater)}
      onBackToJobs={() => setNav({ screen: 'jobs', year: nav.year })}
      onBackToYears={() => setNav({ screen: 'years' })}
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
