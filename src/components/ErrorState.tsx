import { AlertTriangle, FolderOpen } from 'lucide-react';

interface ErrorStateProps {
  fileName: string;
  filePath: string;
  message: string;
  onOpenAnother: () => void;
  onCloseTab: () => void;
}

export function ErrorState({
  fileName,
  filePath,
  message,
  onOpenAnother,
  onCloseTab,
}: ErrorStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--bg-canvas)] p-6">
      <div className="w-full max-w-md rounded-xl border border-black/10 bg-white p-6 text-center shadow-lg dark:border-white/10 dark:bg-neutral-900">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Unable to Open {fileName}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
          {message}
        </p>
        <p
          className="mt-2 truncate rounded bg-neutral-100 px-2 py-1 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          title={filePath}
        >
          {filePath}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={onCloseTab}
            className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onOpenAnother}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Another PDF
          </button>
        </div>
      </div>
    </div>
  );
}
