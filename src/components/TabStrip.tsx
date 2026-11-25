import { ExternalLink, FileText, X } from 'lucide-react';
import type { TabSession } from '../types/viewer';

interface TabStripProps {
  tabs: TabSession[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onPopOutTab: (tab: TabSession) => void;
}

/**
 * Minimal Preview/Evince tab bar. Automatically hidden when 0 or 1 document
 * is open so single-document reading remains strictly distraction-free.
 */
export function TabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onPopOutTab,
}: TabStripProps) {
  if (tabs.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-neutral-100/90 px-2 dark:bg-neutral-900/90"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.id);
              }
            }}
            className={`group flex max-w-[220px] items-center gap-1.5 rounded-md px-2 py-1 text-xs transition ${
              isActive
                ? 'bg-white font-medium text-neutral-900 shadow-xs ring-1 ring-black/8 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-white/10'
                : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/6'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectTab(tab.id)}
              title={tab.filePath}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <FileText className="h-3 w-3 shrink-0 opacity-70" />
              <span className="truncate">{tab.fileName}</span>
            </button>

            <button
              type="button"
              onClick={() => onPopOutTab(tab)}
              title="Move to New Window"
              aria-label={`Open ${tab.fileName} in new window`}
              className="rounded p-0.5 text-neutral-400 opacity-0 transition hover:bg-black/8 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            >
              <ExternalLink className="h-3 w-3" />
            </button>

            <button
              type="button"
              onClick={() => onCloseTab(tab.id)}
              title="Close Tab (Ctrl+W)"
              aria-label={`Close ${tab.fileName}`}
              className="rounded p-0.5 text-neutral-400 hover:bg-black/8 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
