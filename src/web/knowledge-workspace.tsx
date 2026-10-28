import type { ReactNode } from 'react';
import { FolderTree, Plus } from 'lucide-react';
import type { NoteSummary } from '../shared/model.js';
import type { TreeHandlers } from './hierarchy.js';
import { KnowledgeTree as KnowledgeGraph } from './knowledge-tree.js';

export function KnowledgeWorkspace({ nodes, selected, onSelected, onOpen, onChange, onError, busy, inspectorResize, ...actions }: TreeHandlers & { nodes: NoteSummary[]; selected: string | null; onSelected(id: string): void; onOpen(id: string): void; onChange(): void; onError(message: string): void; busy: boolean; inspectorResize: ReactNode }) {
  return <div className="knowledge-shell">
    <header className="knowledge-toolbar"><h1><FolderTree size={19} />知识树</h1><button className="primary" disabled={busy} onClick={() => actions.onCreate(null)}><Plus size={15} aria-hidden="true" /><span>新建节点</span></button></header>
    <KnowledgeGraph inspectorResize={inspectorResize} nodes={nodes} activeId={selected} onSelected={onSelected} onOpen={onOpen} onChange={onChange} onError={onError} onCreate={() => actions.onCreate(null)} onMenu={actions.onMenu} treeActions={actions} treeBusy={busy} />
  </div>;
}
