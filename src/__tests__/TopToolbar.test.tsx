import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopToolbar } from '../components/TopToolbar';
import type { TabSession } from '../types/viewer';

function makeReadySession(): TabSession {
  return {
    id: 'tab-1',
    filePath: 'E:\\Docs\\sample.pdf',
    fileName: 'sample.pdf',
    docHash: 'abc123',
    fileSize: 1024,
    status: 'ready',
    passwordError: null,
    errorMessage: null,
    totalPages: 25,
    currentPage: 3,
    scrollOffsetRatio: 0,
    viewMode: 'continuous',
    coverOffset: true,
    zoomMode: 'fit-width',
    zoomScale: 1.0,
    pageDimensions: [{ widthPt: 612, heightPt: 792 }],
    outline: [],
    expandedTocIds: null,
    navigationRequest: null,
  };
}

function renderToolbar(overrides: Partial<React.ComponentProps<typeof TopToolbar>> = {}) {
  const props: React.ComponentProps<typeof TopToolbar> = {
    session: makeReadySession(),
    effectiveScale: 1.25,
    sidebarOpen: false,
    searchOpen: false,
    isFullscreen: false,
    onOpenFile: vi.fn(),
    onToggleSidebar: vi.fn(),
    onJumpToPage: vi.fn(),
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    onChangeViewMode: vi.fn(),
    onToggleCoverOffset: vi.fn(),
    onChangeZoomMode: vi.fn(),
    onZoomStep: vi.fn(),
    onToggleSearch: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(
      <div>
        <TopToolbar {...props} />
        <div data-testid="outside-canvas">PDF Canvas Area</div>
      </div>,
    ),
  };
}

describe('TopToolbar dropdown dismissal and accessibility', () => {
  it('closes View Mode and Zoom dropdowns when clicking outside on the canvas', () => {
    renderToolbar();

    const viewTrigger = screen.getByRole('button', { name: 'View Mode' });
    fireEvent.click(viewTrigger);
    expect(screen.getByRole('menu', { name: 'View Mode Options' })).toBeInTheDocument();

    // Simulate pointerdown on an element outside the toolbar (e.g., PDF viewport)
    fireEvent.pointerDown(screen.getByTestId('outside-canvas'));
    expect(screen.queryByRole('menu', { name: 'View Mode Options' })).not.toBeInTheDocument();

    const zoomTrigger = screen.getByRole('button', { name: 'Zoom Options' });
    fireEvent.click(zoomTrigger);
    expect(screen.getByRole('menu', { name: 'Zoom Presets' })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId('outside-canvas'));
    expect(screen.queryByRole('menu', { name: 'Zoom Presets' })).not.toBeInTheDocument();
  });

  it('closes an open dropdown when opening another dropdown', () => {
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'View Mode' }));
    expect(screen.getByRole('menu', { name: 'View Mode Options' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom Options' }));
    expect(screen.queryByRole('menu', { name: 'View Mode Options' })).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Zoom Presets' })).toBeInTheDocument();
  });

  it('closes open menu on Escape, returns focus to trigger, and stops propagation to window', () => {
    const windowEscSpy = vi.fn();
    window.addEventListener('keydown', windowEscSpy);
    try {
      renderToolbar();

      const viewTrigger = screen.getByRole('button', { name: 'View Mode' });
      fireEvent.click(viewTrigger);
      expect(screen.getByRole('menu', { name: 'View Mode Options' })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu', { name: 'View Mode Options' })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(viewTrigger);
      expect(windowEscSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowEscSpy);
    }
  });

  it('closes dropdown and invokes callback when a menu item is selected', () => {
    const onChangeViewMode = vi.fn();
    const onChangeZoomMode = vi.fn();
    renderToolbar({ onChangeViewMode, onChangeZoomMode });

    fireEvent.click(screen.getByRole('button', { name: 'View Mode' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Two Pages' }));
    expect(onChangeViewMode).toHaveBeenCalledWith('two-page');
    expect(screen.queryByRole('menu', { name: 'View Mode Options' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom Options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fit Page' }));
    expect(onChangeZoomMode).toHaveBeenCalledWith('fit-page');
    expect(screen.queryByRole('menu', { name: 'Zoom Presets' })).not.toBeInTheDocument();
  });

  it('renders merged Windows caption controls and drag regions cleanly', () => {
    const onMinimizeWindow = vi.fn();
    const onToggleMaximizeWindow = vi.fn();
    const onCloseWindow = vi.fn();

    const { rerender } = render(
      <TopToolbar
        session={makeReadySession()}
        effectiveScale={1.0}
        sidebarOpen={false}
        searchOpen={false}
        isFullscreen={false}
        isMaximized={false}
        onOpenFile={vi.fn()}
        onToggleSidebar={vi.fn()}
        onJumpToPage={vi.fn()}
        onPrevPage={vi.fn()}
        onNextPage={vi.fn()}
        onChangeViewMode={vi.fn()}
        onToggleCoverOffset={vi.fn()}
        onChangeZoomMode={vi.fn()}
        onZoomStep={vi.fn()}
        onToggleSearch={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onOpenSettings={vi.fn()}
        onMinimizeWindow={onMinimizeWindow}
        onToggleMaximizeWindow={onToggleMaximizeWindow}
        onCloseWindow={onCloseWindow}
      />,
    );

    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('data-tauri-drag-region');

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(onMinimizeWindow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(onToggleMaximizeWindow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCloseWindow).toHaveBeenCalledTimes(1);

    // When maximized, button switches to Restore label
    rerender(
      <TopToolbar
        session={makeReadySession()}
        effectiveScale={1.0}
        sidebarOpen={false}
        searchOpen={false}
        isFullscreen={false}
        isMaximized={true}
        onOpenFile={vi.fn()}
        onToggleSidebar={vi.fn()}
        onJumpToPage={vi.fn()}
        onPrevPage={vi.fn()}
        onNextPage={vi.fn()}
        onChangeViewMode={vi.fn()}
        onToggleCoverOffset={vi.fn()}
        onChangeZoomMode={vi.fn()}
        onZoomStep={vi.fn()}
        onToggleSearch={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onOpenSettings={vi.fn()}
        onMinimizeWindow={onMinimizeWindow}
        onToggleMaximizeWindow={onToggleMaximizeWindow}
        onCloseWindow={onCloseWindow}
      />,
    );

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });
});
