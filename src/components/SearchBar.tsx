import { useEffect, useRef, type KeyboardEvent } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';

interface SearchBarProps {
  query: string;
  caseSensitive: boolean;
  totalMatches: number;
  activeMatchIndex: number;
  isIndexing: boolean;
  focusTrigger: number;
  onQueryChange: (query: string) => void;
  onToggleCaseSensitive: () => void;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  onClose: () => void;
}

export function SearchBar({
  query,
  caseSensitive,
  totalMatches,
  activeMatchIndex,
  isIndexing,
  focusTrigger,
  onQueryChange,
  onToggleCaseSensitive,
  onPrevMatch,
  onNextMatch,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTrigger]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrevMatch();
      } else {
        onNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const countLabel = !query
    ? ''
    : totalMatches === 0
      ? isIndexing
        ? 'Searching...'
        : '0 results'
      : `${activeMatchIndex + 1} / ${totalMatches}`;

  return (
    <div
      role="search"
      aria-label="Find in document"
      className="fixed right-5 top-14 z-40 flex items-center gap-1.5 rounded-xl border border-black/10 bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md dark:border-white/12 dark:bg-neutral-900/95"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in PDF..."
        aria-label="Search text"
        className="w-44 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />

      {isIndexing && query && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
      )}

      {countLabel && (
        <span className="min-w-[54px] text-right text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {countLabel}
        </span>
      )}

      <button
        type="button"
        onClick={onToggleCaseSensitive}
        title="Match Case"
        aria-label="Match Case"
        aria-pressed={caseSensitive}
        className={`rounded p-1 transition ${
          caseSensitive
            ? 'bg-blue-600/15 text-blue-600 dark:text-blue-400'
            : 'text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10'
        }`}
      >
        <CaseSensitive className="h-3.5 w-3.5" />
      </button>

      <div className="h-4 w-px bg-black/10 dark:bg-white/10" />

      <button
        type="button"
        onClick={onPrevMatch}
        disabled={totalMatches === 0}
        title="Previous Match (Shift+Enter)"
        aria-label="Previous Match"
        className="rounded p-1 text-neutral-600 hover:bg-black/5 disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-white/10"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={onNextMatch}
        disabled={totalMatches === 0}
        title="Next Match (Enter)"
        aria-label="Next Match"
        className="rounded p-1 text-neutral-600 hover:bg-black/5 disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-white/10"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={onClose}
        title="Close Find Bar (Esc)"
        aria-label="Close Find Bar"
        className="rounded p-1 text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
