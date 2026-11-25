import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../components/SettingsDialog';
import { EmptyState } from '../components/EmptyState';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { DEFAULT_APP_SETTINGS } from '../services/tauriBridge';
import type { RecentDocumentItem } from '../types/viewer';

describe('SettingsDialog, EmptyState, and Keyboard Shortcuts', () => {
  it('updates reading, appearance, and Windows default handler action in SettingsDialog', async () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();

    render(
      <SettingsDialog
        isOpen={true}
        settings={DEFAULT_APP_SETTINGS}
        onUpdateSettings={onUpdate}
        onClose={onClose}
      />,
    );

    // Flush the async getFileAssociationStatus() effect cleanly
    await act(async () => {
      await Promise.resolve();
    });

    const resumeCheckbox = screen.getByLabelText(/Resume from last viewed page/i);
    expect(resumeCheckbox).toBeChecked();
    fireEvent.click(resumeCheckbox);
    expect(onUpdate).toHaveBeenCalledWith({
      ...DEFAULT_APP_SETTINGS,
      resumeLastPage: false,
    });

    const viewSelect = screen.getByLabelText(/Default view mode for new documents/i);
    fireEvent.change(viewSelect, { target: { value: 'two-page' } });
    expect(onUpdate).toHaveBeenCalledWith({
      ...DEFAULT_APP_SETTINGS,
      defaultViewMode: 'two-page',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onUpdate).toHaveBeenCalledWith({
      ...DEFAULT_APP_SETTINGS,
      theme: 'dark',
    });

    expect(
      screen.getByRole('button', { name: /Set as Default PDF Viewer/i }),
    ).toBeInTheDocument();
  });

  it('renders recent documents in EmptyState including missing-file indicator and actions', () => {
    const onOpenFile = vi.fn();
    const onOpenRecent = vi.fn();
    const onRemoveRecent = vi.fn();

    const recents: RecentDocumentItem[] = [
      {
        docHash: 'h1',
        filePath: 'E:\\Books\\Guide.pdf',
        fileName: 'Guide.pdf',
        totalPages: 240,
        pageNumber: 37,
        scrollOffsetRatio: 0.15,
        viewMode: 'continuous',
        coverOffset: true,
        zoomMode: 'fit-width',
        zoomScale: 1.1,
        updatedAtMs: 2000,
        exists: true,
      },
      {
        docHash: 'h2',
        filePath: 'E:\\Books\\Deleted.pdf',
        fileName: 'Deleted.pdf',
        totalPages: 12,
        pageNumber: 3,
        scrollOffsetRatio: 0,
        viewMode: 'single',
        coverOffset: true,
        zoomMode: 'fit-page',
        zoomScale: 1.0,
        updatedAtMs: 1000,
        exists: false,
      },
    ];

    render(
      <EmptyState
        recentDocuments={recents}
        onOpenFile={onOpenFile}
        onOpenRecent={onOpenRecent}
        onRemoveRecent={onRemoveRecent}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open PDF\.\.\./i }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);

    // Start screen stays minimal with no keyboard shortcut cheat-sheet
    expect(screen.queryByText('Ctrl+O')).not.toBeInTheDocument();
    expect(screen.queryByText('F11')).not.toBeInTheDocument();

    expect(screen.getByText('Guide.pdf')).toBeInTheDocument();
    expect(screen.getByText('File moved or deleted')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Guide.pdf'));
    expect(onOpenRecent).toHaveBeenCalledWith('E:\\Books\\Guide.pdf');

    fireEvent.click(screen.getByRole('button', { name: /Remove Guide\.pdf from recent list/i }));
    expect(onRemoveRecent).toHaveBeenCalledWith('h1');
  });

  it('dispatches global keyboard shortcuts accurately', () => {
    const handlers = {
      onOpenFile: vi.fn(),
      onNewWindow: vi.fn(),
      onCloseTab: vi.fn(),
      onCycleTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onOpenSearch: vi.fn(),
      onSearchStep: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onZoomActual: vi.fn(),
      onFitWidth: vi.fn(),
      onFitPage: vi.fn(),
      onPrevPage: vi.fn(),
      onNextPage: vi.fn(),
      onScrollStep: vi.fn(),
      onFirstPage: vi.fn(),
      onLastPage: vi.fn(),
      onToggleFullscreen: vi.fn(),
      onOpenSettings: vi.fn(),
      onEscape: vi.fn(),
      isContinuousMode: true,
    };

    renderHook(() => useKeyboardShortcuts(handlers));

    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    fireEvent.keyDown(window, { key: '0', ctrlKey: true });
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    fireEvent.keyDown(window, { key: '2', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'F11' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Home' });
    fireEvent.keyDown(window, { key: 'End' });
    fireEvent.keyDown(window, { key: 'PageDown' });

    expect(handlers.onOpenFile).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSearch).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomActual).toHaveBeenCalledTimes(1);
    expect(handlers.onFitWidth).toHaveBeenCalledTimes(1);
    expect(handlers.onFitPage).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleFullscreen).toHaveBeenCalledTimes(1);
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
    expect(handlers.onFirstPage).toHaveBeenCalledTimes(1);
    expect(handlers.onLastPage).toHaveBeenCalledTimes(1);
    expect(handlers.onScrollStep).toHaveBeenCalledWith(1);
  });
});
