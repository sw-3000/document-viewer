import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TocPanel } from '../components/Sidebar/TocPanel';
import type { OutlineNode } from '../types/viewer';

describe('TocPanel (strictly manual outline)', () => {
  const sampleOutline: OutlineNode[] = [
    {
      id: 'toc-1',
      title: 'Chapter 1: Getting Started',
      destPage: 1,
      destTopPt: 720,
      children: [
        {
          id: 'toc-2',
          title: '1.1 Installation',
          destPage: 3,
          destTopPt: 500,
          children: [],
        },
      ],
    },
    {
      id: 'toc-3',
      title: 'Chapter 2: Architecture',
      destPage: 12,
      destTopPt: null,
      children: [
        {
          id: 'toc-4',
          title: '2.1 Virtualization',
          destPage: 14,
          destTopPt: 600,
          children: [],
        },
      ],
    },
  ];

  it('supports manual expand/collapse and click-to-jump without any scroll-sync or active highlight', () => {
    const onSelect = vi.fn();
    render(<TocPanel outline={sampleOutline} onSelectDestination={onSelect} />);

    // Top-level parents start expanded so their immediate children are visible
    expect(screen.getByText('1.1 Installation')).toBeInTheDocument();

    // Collapse Chapter 1 manually
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Chapter 1: Getting Started' }));
    expect(screen.queryByText('1.1 Installation')).not.toBeInTheDocument();

    // Expand Chapter 1 manually again
    fireEvent.click(screen.getByRole('button', { name: 'Expand Chapter 1: Getting Started' }));
    expect(screen.getByText('1.1 Installation')).toBeInTheDocument();

    // Click-to-jump fires destination page & topPt
    fireEvent.click(screen.getByText('1.1 Installation'));
    expect(onSelect).toHaveBeenCalledWith(3, 500);

    // Verify no aria-current / active-section attribute is applied anywhere
    const treeItems = screen.getAllByRole('treeitem');
    for (const item of treeItems) {
      expect(item).not.toHaveAttribute('aria-current');
    }
  });

  it('renders an empty-state message when the PDF has no outline', () => {
    render(<TocPanel outline={[]} onSelectDestination={vi.fn()} />);
    expect(
      screen.getByText('This document does not contain a Table of Contents.'),
    ).toBeInTheDocument();
  });
});
