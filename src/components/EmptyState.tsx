import { Clock, FileText, FolderOpen, X } from 'lucide-react';
import type { RecentDocumentItem } from '../types/viewer';

interface EmptyStateProps {
  recentDocuments: RecentDocumentItem[];
  onOpenFile: () => void;
  onOpenRecent: (filePath: string) => void;
  onRemoveRecent: (docHash: string) => void;
}

export function EmptyState({
  recentDocuments,
  onOpenFile,
  onOpenRecent,
  onRemoveRecent,
}: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[var(--bg-canvas)] p-8">
      <div className="w-full max-w-lg rounded-2xl border border-black/8 bg-white/85 p-8 text-center shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-neutral-900/85">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
          <FileText className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Document Viewer
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
          Drop a PDF anywhere on this window, or open one from disk.
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onOpenFile}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <FolderOpen className="h-4 w-4" />
            Open PDF...
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-neutral-400 dark:text-neutral-500">
          <span>
            <kbd className="rounded border border-neutral-300 px-1 py-0.5 font-sans dark:border-neutral-700">
              Ctrl+O
            </kbd>{' '}
            Open
          </span>
          <span>
            <kbd className="rounded border border-neutral-300 px-1 py-0.5 font-sans dark:border-neutral-700">
              Ctrl+F
            </kbd>{' '}
            Find
          </span>
          <span>
            <kbd className="rounded border border-neutral-300 px-1 py-0.5 font-sans dark:border-neutral-700">
              Ctrl+B
            </kbd>{' '}
            Sidebar
          </span>
          <span>
            <kbd className="rounded border border-neutral-300 px-1 py-0.5 font-sans dark:border-neutral-700">
              F11
            </kbd>{' '}
            Fullscreen
          </span>
        </div>

        {recentDocuments.length > 0 && (
          <div className="mt-7 border-t border-black/8 pt-5 text-left dark:border-white/10">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
              <Clock className="h-3.5 w-3.5" />
              Recent Documents
            </div>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {recentDocuments.map((doc) => (
                <li
                  key={doc.docHash}
                  className="group flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/80"
                >
                  <button
                    type="button"
                    onClick={() => onOpenRecent(doc.filePath)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                    title={doc.filePath}
                  >
                    <div className="min-w-0">
                      <div
                        className={`truncate text-xs font-medium ${
                          doc.exists
                            ? 'text-neutral-800 dark:text-neutral-200'
                            : 'text-neutral-400 line-through dark:text-neutral-500'
                        }`}
                      >
                        {doc.fileName}
                      </div>
                      <div className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                        {doc.exists ? doc.filePath : 'File moved or deleted'}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
                      p. {doc.pageNumber}/{doc.totalPages}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRecent(doc.docHash)}
                    aria-label={`Remove ${doc.fileName} from recent list`}
                    className="rounded p-1 text-neutral-400 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
