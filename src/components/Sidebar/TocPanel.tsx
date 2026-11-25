import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { OutlineNode } from '../../types/viewer';

interface TocPanelProps {
  outline: OutlineNode[];
  /**
   * Saved expanded node IDs:
   * - `null` / `undefined`: never saved yet -> first-open default (depth-0 nodes expanded only)
   * - `[]`: user explicitly collapsed all nodes -> restore all collapsed
   */
  expandedIds?: string[] | null;
  onExpandedIdsChange?: (nextIds: string[]) => void;
  onSelectDestination: (pageNumber: number, topPt: number | null) => void;
}

/**
 * First-open default: expand ONLY top-level (depth 0) nodes that have children.
 * All child nodes at depth >= 1 start collapsed.
 */
export function getDefaultExpandedTocIds(outline: OutlineNode[]): string[] {
  return outline.filter((node) => node.children.length > 0).map((node) => node.id);
}

function collectAllOutlineIds(nodes: OutlineNode[], acc = new Set<string>()): Set<string> {
  for (const node of nodes) {
    acc.add(node.id);
    if (node.children.length > 0) {
      collectAllOutlineIds(node.children, acc);
    }
  }
  return acc;
}

/**
 * Resolves expanded ToC IDs cleanly while distinguishing "never saved yet" (`null`/`undefined`)
 * from an explicit empty collapse state (`[]`), and pruning stale IDs.
 */
export function resolveExpandedTocIds(
  outline: OutlineNode[],
  savedIds: string[] | null | undefined,
): string[] {
  if (savedIds === null || savedIds === undefined) {
    return getDefaultExpandedTocIds(outline);
  }
  const validIds = collectAllOutlineIds(outline);
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const id of savedIds) {
    if (validIds.has(id) && !seen.has(id)) {
      seen.add(id);
      resolved.push(id);
    }
  }
  return resolved;
}

export function toggleTocNodeId(currentIds: string[], nodeId: string): string[] {
  if (currentIds.includes(nodeId)) {
    return currentIds.filter((id) => id !== nodeId);
  }
  return [...currentIds, nodeId];
}

/**
 * Strictly manual Table of Contents tree:
 * supports manual expand/collapse and click-to-jump navigation only.
 * Does NOT track active sections, sync with scroll, or auto-expand.
 */
export function TocPanel({
  outline,
  expandedIds,
  onExpandedIdsChange,
  onSelectDestination,
}: TocPanelProps) {
  const isControlled = typeof onExpandedIdsChange === 'function';
  const [localExpandedIds, setLocalExpandedIds] = useState<string[]>(() =>
    resolveExpandedTocIds(outline, expandedIds),
  );

  useEffect(() => {
    if (!isControlled) {
      setLocalExpandedIds(resolveExpandedTocIds(outline, expandedIds));
    }
  }, [isControlled, outline, expandedIds]);

  const activeExpandedList = isControlled
    ? resolveExpandedTocIds(outline, expandedIds)
    : localExpandedIds;
  const expandedSet = new Set(activeExpandedList);

  if (outline.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
        This document does not contain a Table of Contents.
      </div>
    );
  }

  const handleToggle = (nodeId: string) => {
    if (isControlled && onExpandedIdsChange) {
      onExpandedIdsChange(toggleTocNodeId(activeExpandedList, nodeId));
    } else {
      setLocalExpandedIds((prev) => toggleTocNodeId(prev, nodeId));
    }
  };

  const renderNodes = (nodes: OutlineNode[], depth: number) => (
    <ul className="space-y-0.5" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = hasChildren && expandedSet.has(node.id);
        const isClickable = node.destPage !== null;
        return (
          <li key={node.id} role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
            <div
              data-toc-row={node.id}
              onClick={() => {
                if (node.destPage !== null) {
                  onSelectDestination(node.destPage, node.destTopPt);
                }
              }}
              title={node.title}
              className={`flex items-stretch rounded-md text-xs text-neutral-700 dark:text-neutral-200 ${
                isClickable
                  ? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/8'
                  : 'cursor-default opacity-50'
              }`}
              style={{ paddingLeft: `${depth * 14 + 2}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleToggle(node.id);
                  }}
                  aria-label={isExpanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
                  className="flex w-6 shrink-0 items-center justify-center self-stretch rounded-l-md text-neutral-400 hover:bg-black/8 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-6 shrink-0 self-stretch" aria-hidden="true" />
              )}

              <button
                type="button"
                disabled={!isClickable}
                onClick={(e) => {
                  e.stopPropagation();
                  if (node.destPage !== null) {
                    onSelectDestination(node.destPage, node.destTopPt);
                  }
                }}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1 pr-2 text-left disabled:cursor-default"
              >
                <span className="truncate leading-snug">{node.title}</span>
                {node.destPage !== null && (
                  <span className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
                    {node.destPage}
                  </span>
                )}
              </button>
            </div>

            {hasChildren && isExpanded && renderNodes(node.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return renderNodes(outline, 0);
}
