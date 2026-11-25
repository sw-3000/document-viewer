import { useEffect } from 'react';

export interface KeyboardShortcutHandlers {
  onOpenFile: () => void;
  onNewWindow: () => void;
  onCloseTab: () => void;
  onCycleTab: (direction: 1 | -1) => void;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onSearchStep: (direction: 1 | -1) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomActual: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  onEscape: () => void;
  isContinuousMode: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const inInput = isEditableTarget(e.target);

      if (e.key === 'Escape') {
        e.preventDefault();
        handlers.onEscape();
        return;
      }

      if (e.key === 'F11') {
        e.preventDefault();
        handlers.onToggleFullscreen();
        return;
      }

      if (e.key === 'F3') {
        e.preventDefault();
        handlers.onSearchStep(e.shiftKey ? -1 : 1);
        return;
      }

      if (mod) {
        const lower = e.key.toLowerCase();
        if (lower === 'o') {
          e.preventDefault();
          handlers.onOpenFile();
          return;
        }
        if (lower === 'n' && e.shiftKey) {
          e.preventDefault();
          handlers.onNewWindow();
          return;
        }
        if (lower === 'w') {
          e.preventDefault();
          handlers.onCloseTab();
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          handlers.onCycleTab(e.shiftKey ? -1 : 1);
          return;
        }
        if (lower === 'f') {
          e.preventDefault();
          handlers.onOpenSearch();
          return;
        }
        if (lower === 'b') {
          e.preventDefault();
          handlers.onToggleSidebar();
          return;
        }
        if (e.key === ',' ) {
          e.preventDefault();
          handlers.onOpenSettings();
          return;
        }
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          handlers.onZoomIn();
          return;
        }
        if (e.key === '-') {
          e.preventDefault();
          handlers.onZoomOut();
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          handlers.onZoomActual();
          return;
        }
        if (e.key === '1') {
          e.preventDefault();
          handlers.onFitWidth();
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          handlers.onFitPage();
          return;
        }
      }

      if (inInput) return;

      // Discrete page/spread navigation with arrows or PageUp/PageDown
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlers.onPrevPage();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handlers.onNextPage();
      } else if (!handlers.isContinuousMode && e.key === 'PageUp') {
        e.preventDefault();
        handlers.onPrevPage();
      } else if (!handlers.isContinuousMode && e.key === 'PageDown') {
        e.preventDefault();
        handlers.onNextPage();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
