import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Monitor, Moon, Sun, X } from 'lucide-react';
import type {
  AppSettings,
  FileAssociationStatus,
  ThemePreference,
  ViewMode,
} from '../types/viewer';
import {
  getFileAssociationStatus,
  registerDefaultPdfViewer,
} from '../services/tauriBridge';

interface SettingsDialogProps {
  isOpen: boolean;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onClose: () => void;
}

export function SettingsDialog({
  isOpen,
  settings,
  onUpdateSettings,
  onClose,
}: SettingsDialogProps) {
  const [assocStatus, setAssocStatus] = useState<FileAssociationStatus | null>(null);
  const [assocBusy, setAssocBusy] = useState(false);
  const [assocFeedback, setAssocFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setAssocFeedback(null);
    void getFileAssociationStatus()
      .then(setAssocStatus)
      .catch(() => setAssocStatus(null));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSetDefault = async () => {
    setAssocBusy(true);
    setAssocFeedback(null);
    try {
      const next = await registerDefaultPdfViewer();
      setAssocStatus(next);
      setAssocFeedback(
        next.isDefaultPdfViewer
          ? 'Document Viewer is set as your default PDF viewer.'
          : 'Registered in Windows. Choose Document Viewer for .pdf in Windows Settings.',
      );
    } catch (err: unknown) {
      setAssocFeedback(
        err instanceof Error ? err.message : 'Failed to open Windows Default Apps.',
      );
    } finally {
      setAssocBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="w-full max-w-md rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/12 dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <h2
            id="settings-dialog-title"
            className="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            className="rounded-md p-1 text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5 text-xs">
          {/* Reading */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Reading
            </h3>

            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div>
                <div className="font-medium text-neutral-800 dark:text-neutral-200">
                  Resume from last viewed page
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Restore page, scroll position, view mode, and zoom on reopen
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.resumeLastPage}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, resumeLastPage: e.target.checked })
                }
                className="h-4 w-4 accent-blue-600"
              />
            </label>

            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="default-view-mode"
                className="font-medium text-neutral-800 dark:text-neutral-200"
              >
                Default view mode for new documents
              </label>
              <select
                id="default-view-mode"
                value={settings.defaultViewMode}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    defaultViewMode: e.target.value as ViewMode,
                  })
                }
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="continuous">Continuous Scroll</option>
                <option value="single">Single Page</option>
                <option value="two-page">Two Pages</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="default-zoom-mode"
                className="font-medium text-neutral-800 dark:text-neutral-200"
              >
                Default zoom for new documents
              </label>
              <select
                id="default-zoom-mode"
                value={settings.defaultZoomMode}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    defaultZoomMode: e.target.value as AppSettings['defaultZoomMode'],
                  })
                }
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="fit-width">Fit Width</option>
                <option value="fit-page">Fit Page</option>
                <option value="actual-size">Actual Size (100%)</option>
              </select>
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="font-medium text-neutral-800 dark:text-neutral-200">
                Separate cover page in Two Pages mode
              </span>
              <input
                type="checkbox"
                checked={settings.defaultCoverOffset}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    defaultCoverOffset: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-blue-600"
              />
            </label>
          </section>

          <div className="h-px bg-[var(--border-subtle)]" />

          {/* Appearance */}
          <section className="space-y-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Appearance
            </h3>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
              {(
                [
                  { id: 'system', label: 'System', icon: Monitor },
                  { id: 'light', label: 'Light', icon: Sun },
                  { id: 'dark', label: 'Dark', icon: Moon },
                ] as const
              ).map((opt) => {
                const Icon = opt.icon;
                const active = settings.theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        ...settings,
                        theme: opt.id as ThemePreference,
                      })
                    }
                    className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition ${
                      active
                        ? 'bg-white text-neutral-900 shadow-xs dark:bg-neutral-700 dark:text-neutral-100'
                        : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="h-px bg-[var(--border-subtle)]" />

          {/* Windows Default PDF Viewer */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                Windows Integration
              </h3>
              {assocStatus?.isDefaultPdfViewer ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Default PDF Viewer
                </span>
              ) : assocStatus?.isRegisteredInHkcu ? (
                <span className="rounded-full bg-blue-500/12 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-400">
                  Registered
                </span>
              ) : null}
            </div>

            <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Registers Document Viewer under your Windows account (no admin rights
              required) and opens Windows Default Apps to confirm `.pdf` ownership.
            </p>

            <button
              type="button"
              onClick={() => void handleSetDefault()}
              disabled={assocBusy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-black/10 bg-neutral-900 px-3.5 py-2 font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:border-white/15 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {assocBusy ? 'Opening Windows Settings...' : 'Set as Default PDF Viewer'}
            </button>

            {assocFeedback && (
              <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
                {assocFeedback}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
