import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SidebarShell,
  clampSidebarWidth,
} from '../components/Sidebar/SidebarShell';

describe('SidebarShell drag-resizing and clamping', () => {
  const originalInnerWidth = window.innerWidth;
  const originalPointerEvent = globalThis.PointerEvent;

  beforeEach(() => {
    // jsdom lacks PointerEvent; subclass MouseEvent so clientX and button propagate accurately
    if (!globalThis.PointerEvent) {
      globalThis.PointerEvent = class MockPointerEvent extends MouseEvent {
        constructor(type: string, init?: PointerEventInit) {
          super(type, init);
        }
      } as unknown as typeof PointerEvent;
    }
  });

  afterEach(() => {
    globalThis.PointerEvent = originalPointerEvent;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.body.classList.remove('select-none');
  });

  it('clamps width to [180, min(480, 45% of window width)]', () => {
    expect(clampSidebarWidth(100, 1280)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(340, 1280)).toBe(340);
    expect(clampSidebarWidth(600, 1400)).toBe(480);
    // Narrow 800px window -> 45% cap is 360px
    expect(clampSidebarWidth(450, 800)).toBe(360);
  });

  it('resizes smoothly on pointer drag, disables body selection while dragging, and commits on pointerup', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });

    const onWidthCommit = vi.fn();
    function Harness() {
      const [w, setW] = useState(DEFAULT_SIDEBAR_WIDTH);
      return (
        <SidebarShell
          isOpen={true}
          outline={[]}
          width={w}
          onWidthChange={setW}
          onWidthCommit={onWidthCommit}
          activePanelId="toc"
          onSelectPanel={vi.fn()}
          onSelectDestination={vi.fn()}
        />
      );
    }

    render(<Harness />);
    const sidebar = screen.getByLabelText('Document Sidebar');
    const separator = screen.getByRole('separator', { name: 'Resize sidebar' });

    expect(sidebar).toHaveStyle({ width: '272px' });

    fireEvent.pointerDown(separator, { button: 0, clientX: 272 });
    expect(document.body.classList.contains('select-none')).toBe(true);
    expect(document.body.style.cursor).toBe('col-resize');

    fireEvent.pointerMove(window, { clientX: 350 });
    expect(sidebar).toHaveStyle({ width: '350px' });

    // Clamps to 480 when dragged beyond max
    fireEvent.pointerMove(window, { clientX: 700 });
    expect(sidebar).toHaveStyle({ width: '480px' });

    // Clamps to 180 when dragged below min
    fireEvent.pointerMove(window, { clientX: 50 });
    expect(sidebar).toHaveStyle({ width: '180px' });

    // Drag back to 312 and release
    fireEvent.pointerMove(window, { clientX: 312 });
    fireEvent.pointerUp(window);
    expect(document.body.classList.contains('select-none')).toBe(false);
    expect(document.body.style.cursor).toBe('');
    expect(onWidthCommit).toHaveBeenCalledWith(312);
  });

  it('resets to default width on double-click and supports keyboard resizing', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 800,
    });

    const onWidthCommit = vi.fn();
    function Harness() {
      const [w, setW] = useState(320);
      return (
        <SidebarShell
          isOpen={true}
          outline={[]}
          width={w}
          onWidthChange={setW}
          onWidthCommit={onWidthCommit}
          activePanelId="toc"
          onSelectPanel={vi.fn()}
          onSelectDestination={vi.fn()}
        />
      );
    }

    render(<Harness />);
    const sidebar = screen.getByLabelText('Document Sidebar');
    const separator = screen.getByRole('separator', { name: 'Resize sidebar' });

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(sidebar).toHaveStyle({ width: '336px' });
    expect(onWidthCommit).toHaveBeenLastCalledWith(336);

    fireEvent.keyDown(separator, { key: 'End' });
    expect(sidebar).toHaveStyle({ width: '360px' }); // 45% of 800px
    expect(onWidthCommit).toHaveBeenLastCalledWith(360);

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(sidebar).toHaveStyle({ width: '180px' });
    expect(onWidthCommit).toHaveBeenLastCalledWith(180);

    fireEvent.doubleClick(separator);
    expect(sidebar).toHaveStyle({ width: '272px' });
    expect(onWidthCommit).toHaveBeenLastCalledWith(272);
  });
});
