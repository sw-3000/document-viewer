import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  TocPanel,
  getDefaultExpandedTocIds,
  resolveExpandedTocIds,
} from '../components/Sidebar/TocPanel';
import type { OutlineNode } from '../types/viewer';

function buildBookOutline(): OutlineNode[] {
  const chapters: OutlineNode[] = Array.from({ length: 11 }, (_, idx) => {
    const chNum = idx + 1;
    const id = `1.${idx}`;
    return {
      id,
      title: `Chapter ${chNum}`,
      destPage: 10 + idx * 12,
      destTopPt: 700,
      children:
        chNum === 11
          ? [
              {
                id: `${id}.0`,
                title: '11.1 Advanced Topics',
                destPage: 132,
                destTopPt: 620,
                children: [],
              },
              {
                id: `${id}.1`,
                title: '11.2 Summary',
                destPage: 138,
                destTopPt: 580,
                children: [],
              },
            ]
          : [],
    };
  });

  return [
    {
      id: '0',
      title: 'Introduction',
      destPage: 1,
      destTopPt: 720,
      children: [],
    },
    {
      id: '1',
      title: 'Part I',
      destPage: 10,
      destTopPt: 720,
      children: chapters,
    },
    {
      id: '2',
      title: 'Part II',
      destPage: 150,
      destTopPt: 720,
      children: [
        {
          id: '2.0',
          title: 'Chapter 12',
          destPage: 151,
          destTopPt: 700,
          children: [],
        },
      ],
    },
  ];
}

describe('TocPanel (deterministic IDs, first-open defaults, and persistence)', () => {
  it('expands only depth-0 nodes on first open and keeps all deeper chapters collapsed', () => {
    const outline = buildBookOutline();
    expect(getDefaultExpandedTocIds(outline)).toEqual(['1', '2']);

    const onSelect = vi.fn();
    render(<TocPanel outline={outline} expandedIds={null} onSelectDestination={onSelect} />);

    // Depth-0 nodes with children are expanded, so immediate children (depth 1) are visible
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 11')).toBeInTheDocument();
    expect(screen.getByText('Chapter 12')).toBeInTheDocument();

    // Depth-2 subsections under Chapter 11 MUST start collapsed
    expect(screen.queryByText('11.1 Advanced Topics')).not.toBeInTheDocument();
    expect(screen.queryByText('11.2 Summary')).not.toBeInTheDocument();

    // No active-section / scroll-sync attribute is applied
    for (const item of screen.getAllByRole('treeitem')) {
      expect(item).not.toHaveAttribute('aria-current');
    }
  });

  it('toggles only the clicked child node without collapsing parent or triggering navigation', () => {
    const outline = buildBookOutline();
    const onSelect = vi.fn();
    render(<TocPanel outline={outline} expandedIds={null} onSelectDestination={onSelect} />);

    // Expand Chapter 11 (last child under Part I)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Chapter 11' }));
    expect(screen.getByText('11.1 Advanced Topics')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    // Collapse Chapter 11 — Part I and its other chapters must remain expanded
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Chapter 11' }));
    expect(screen.queryByText('11.1 Advanced Topics')).not.toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 11')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    // Click-to-jump on Chapter 11 triggers destination navigation
    fireEvent.click(screen.getByText('Chapter 11'));
    expect(onSelect).toHaveBeenCalledWith(130, 700);
  });

  it('makes the entire ToC row rectangle clickable without dead zones while isolating the chevron', () => {
    const outline = buildBookOutline();
    const onSelect = vi.fn();
    const { container } = render(
      <TocPanel outline={outline} expandedIds={null} onSelectDestination={onSelect} />,
    );

    // Clicking the outer padded row container (outside the text button) navigates immediately once
    const introRow = container.querySelector('[data-toc-row="0"]')!;
    expect(introRow).not.toBeNull();
    fireEvent.click(introRow);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith(1, 720);

    const ch11Row = container.querySelector('[data-toc-row="1.10"]')!;
    expect(ch11Row).not.toBeNull();
    fireEvent.click(ch11Row);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(130, 700);

    // Clicking the chevron inside that same row only toggles expansion and never navigates
    fireEvent.click(screen.getByRole('button', { name: 'Expand Chapter 11' }));
    expect(screen.getByText('11.1 Advanced Topics')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('restores saved expanded IDs including an explicit empty array (all collapsed)', () => {
    const outline = buildBookOutline();

    expect(resolveExpandedTocIds(outline, ['1', '1.10', '99.99'])).toEqual(['1', '1.10']);
    expect(resolveExpandedTocIds(outline, [])).toEqual([]);

    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <TocPanel
        outline={outline}
        expandedIds={['1', '1.10']}
        onExpandedIdsChange={onExpandedChange}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByText('11.1 Advanced Topics')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Chapter 11' }));
    expect(onExpandedChange).toHaveBeenCalledWith(['1']);

    // Reopening with explicit [] keeps Part I and Part II collapsed
    rerender(
      <TocPanel
        outline={outline}
        expandedIds={[]}
        onExpandedIdsChange={onExpandedChange}
        onSelectDestination={vi.fn()}
      />,
    );
    expect(screen.getByText('Part I')).toBeInTheDocument();
    expect(screen.queryByText('Chapter 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Chapter 12')).not.toBeInTheDocument();
  });

  it('renders an empty-state message when the PDF has no outline', () => {
    render(<TocPanel outline={[]} onSelectDestination={vi.fn()} />);
    expect(
      screen.getByText('This document does not contain a Table of Contents.'),
    ).toBeInTheDocument();
  });
});
