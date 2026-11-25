import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';

interface PasswordDialogProps {
  fileName: string;
  errorMessage: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordDialog({
  fileName,
  errorMessage,
  onSubmit,
  onCancel,
}: PasswordDialogProps) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [errorMessage]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    onSubmit(password);
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--bg-canvas)] p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-neutral-900"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Lock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Password Required
            </h2>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400" title={fileName}>
              {fileName}
            </p>
          </div>
        </div>

        <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-300">
          This PDF is encrypted. Enter its password to open it.
        </p>

        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Document password"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />

        {errorMessage && (
          <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
            {errorMessage}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Close Tab
          </button>
          <button
            type="submit"
            disabled={!password}
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-45"
          >
            Unlock PDF
          </button>
        </div>
      </form>
    </div>
  );
}
