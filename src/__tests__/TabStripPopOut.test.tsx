import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabStrip } from '../components/TabStrip';
import type { TabSession } from '../types/viewer';

function makeTab(id: string, fileName: string): TabSession {
  return {
    id,
    filePath: `E:\\Docs\\${fileName}`,
    fileName,
    docHash: `hash-${id}`,
    fileSize: 1024,
    status: 'ready',
    passwordError: null,
    errorMessage: null,
    totalPages: 10,
    currentPage: 1,
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

describe('TabStrip Move to New Window action', () => {
  it('invokes onPopOutTab with the target tab when "Move to New Window" is clicked', () => {
    const t1 = makeTab('t1', 'First.pdf');
    const t2 = makeTab('t2', 'Second.pdf');
    const onPopOutTab = vi.fn();

    render(
      <TabStrip
        tabs={[t1, t2]}
        activeTabId="t1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onPopOutTab={onPopOutTab}
      />,
    );

    const popOutBtn = screen.getByRole('button', {
      name: 'Open Second.pdf in new window',
    });
    fireEvent.click(popOutBtn);
    expect(onPopOutTab).toHaveBeenCalledTimes(1);
    expect(onPopOutTab).toHaveBeenCalledWith(t2);
  });
});
