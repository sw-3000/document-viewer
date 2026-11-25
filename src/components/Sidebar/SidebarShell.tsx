import type { ReactNode } from 'react';
import { ListTree } from 'lucide-react';
import type { OutlineNode } from '../../types/viewer';
import { TocPanel } from './TocPanel';

export interface SidebarPanelDefinition {
  id: string;
  title: string;
  icon: ReactNode;
  render: () => ReactNode;
}

interface SidebarShellProps {
  isOpen: boolean;
  outline: OutlineNode[];
  expandedTocIds?: string[] | null;
  onExpandedTocIdsChange?: (nextIds: string[]) => void;
  activePanelId: string;
  onSelectPanel: (panelId: string) => void;
  onSelectDestination: (pageNumber: number, topPt: number | null) => void;
  extraPanels?: SidebarPanelDefinition[];
}

export function SidebarShell({
  isOpen,
  outline,
  expandedTocIds,
  onExpandedTocIdsChange,
  activePanelId,
  onSelectPanel,
  onSelectDestination,
  extraPanels = [],
}: SidebarShellProps) {
  if (!isOpen) return null;

  const panels: SidebarPanelDefinition[] = [
    {
      id: 'toc',
      title: 'Contents',
      icon: <ListTree className="h-3.5 w-3.5" />,
      render: () => (
        <TocPanel
          outline={outline}
          expandedIds={expandedTocIds}
          onExpandedIdsChange={onExpandedTocIdsChange}
          onSelectDestination={onSelectDestination}
        />
      ),
    },
    ...extraPanels,
  ];

  const activePanel = panels.find((p) => p.id === activePanelId) ?? panels[0]!;

  return (
    <aside
      aria-label="Document Sidebar"
      className="flex h-full w-68 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-white/80 backdrop-blur-md dark:bg-neutral-900/85"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2">
        {panels.map((panel) => {
          const isActive = panel.id === activePanel.id;
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => onSelectPanel(panel.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition ${
                isActive
                  ? 'bg-black/8 text-neutral-900 dark:bg-white/12 dark:text-neutral-100'
                  : 'text-neutral-500 hover:bg-black/5 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/8 dark:hover:text-neutral-200'
              }`}
            >
              {panel.icon}
              <span>{panel.title}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {activePanel.render()}
      </div>
    </aside>
  );
}
