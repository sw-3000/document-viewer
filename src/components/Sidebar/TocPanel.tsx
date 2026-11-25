import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { OutlineNode } from '../../types/viewer';

interface TocPanelProps {
  outline: OutlineNode[];
  onSelectDestination: (pageNumber: number, topPt: number | null) => void;
}

function collectParentIds(nodes: OutlineNode[], maxDepth = 1, depth = 0): string[] {
  if (depth >= maxDepth) return [];
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children.length > 0) {
      ids.push(node.id);
      ids.push(...collectParentIds(node.children, maxDepth, depth + 1));
    }
  }
  return ids;
}

/**
 * Strictly manual Table of Contents tree:
 * supports manual expand/collapse and click-to-jump navigation only.
 * Does NOT track active sections, sync with scroll, or auto-expand.
 */
export function TocPanel({ outline, onSelectDestination }: TocPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(collectParentIds(outline, 1)),
  );

  useEffect(() => {
    setExpandedIds(new Set(collectParentIds(outline, 1)));
  }, [outline]);

  if (outline.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
        This document does not contain a Table of Contents.
      </div>
    );
  }

  const toggleExpanded = (nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const renderNodes = (nodes: OutlineNode[], depth: number) => (
    <ul className="space-y-0.5" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedIds.has(node.id);
        return (
          <li key={node.id} role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
            <div
              className="flex items-center gap-0.5 rounded-md py-1 pr-2 text-xs text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/8"
              style={{ paddingLeft: `${depth * 14 + 4}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleExpanded(node.id)}
                  aria-label={isExpanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-black/8 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="h-5 w-5 shrink-0" />
              )}

              <button
                type="button"
                disabled={node.destPage === null}
                onClick={() => {
                  if (node.destPage !== null) {
                    onSelectDestination(node.destPage, node.destTopPt);
                  }
                }}
                title={node.title}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:cursor-default disabled:opacity-50"
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
