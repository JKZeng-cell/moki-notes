import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, Settings2, Sparkles, X } from 'lucide-react';
import { connectionJson, connectionPrompt, type McpConnection } from '../shared/mcp-connection.js';
import { api } from './api.js';

export function AgentConnection({ onClose, onSelect }: { onClose(): void; onSelect(id: string): void }) {
  const [config, setConfig] = useState<McpConnection | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [tab, setTab] = useState<'agent' | 'manual'>('agent'), [copied, setCopied] = useState(''), [copyError, setCopyError] = useState('');
  const [query, setQuery] = useState(''), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState('');
  const [context, setContext] = useState<{ sources: Array<{ id: string; title: string; text: string; version: number }> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(''); setConfig(null);
    void api<McpConnection>('/config').then(c => {
      if (disposed) return;
      const service = c.mcp?.mcpServers?.['moki-notes'];
      if (!service?.command || !Array.isArray(service.args) || !service.env?.MOKI_NOTES_DATA) throw new Error('连接参数不完整，请重试。');
      setConfig(c);
    }).catch(e => { if (!disposed) setError((e as Error).message); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [attempt]);
  async function copy(label: string, text: string) {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(text);
      if (!alive.current) return;
      setCopied(label); if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(''), 2400);
    } catch { if (alive.current) setCopyError('复制失败，请选中下方文本后按 Ctrl+C / ⌘C 复制。'); }
  }
  const copyButton = (label: string, text: string, primary = false) => <button type="button" className={primary ? 'primary' : 'mcp-copy'} aria-label={label} title={label} onClick={() => void copy(label, text)}>{copied === label ? <Check size={15} /> : <Copy size={15} />}{copied === label ? '已复制' : label}</button>;
  const field = (label: string, value: string, help?: string) => <div className="mcp-field"><div className="mcp-field-heading"><label htmlFor={`mcp-${label}`}>{label}</label>{copyButton(`复制${label}`, value)}</div><input id={`mcp-${label}`} aria-label={label} readOnly value={value} onFocus={e => e.target.select()} />{help && <small>{help}</small>}</div>;
  const service = config?.mcp.mcpServers['moki-notes'];
  return <div className="modal-backdrop" onClick={onClose}><section className="dialog wide mcp-dialog" role="dialog" aria-modal="true" aria-label="连接 Agent" onClick={e => e.stopPropagation()}>
    <header><div><h2><Bot size={21} />连接 Agent</h2><p>让 Agent 使用你的便签与知识树</p></div><button autoFocus aria-label="关闭 Agent 设置" onClick={onClose}><X size={18} /></button></header>
    <div className="mcp-tabs" role="tablist" aria-label="连接方式" onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?'agent':e.key==='End'?'manual':tab==='agent'?'manual':'agent';setTab(next);document.getElementById(`mcp-tab-${next}`)?.focus();}}><button id="mcp-tab-agent" role="tab" tabIndex={tab==='agent'?0:-1} aria-selected={tab==='agent'} aria-controls="mcp-panel-agent" onClick={()=>setTab('agent')}><Sparkles size={16}/>交给 Agent</button><button id="mcp-tab-manual" role="tab" tabIndex={tab==='manual'?0:-1} aria-selected={tab==='manual'} aria-controls="mcp-panel-manual" onClick={()=>setTab('manual')}><Settings2 size={16}/>手动添加</button></div>
    <div className="dialog-body mcp-body">
      {loading && <p role="status">正在读取本机连接参数…</p>}
      {error && <div className="mcp-error" role="alert"><span>无法读取连接参数：{error}</span><button onClick={()=>setAttempt(v=>v+1)}>重新加载</button></div>}
      {config && service && <>
        {tab==='agent' ? <section id="mcp-panel-agent" role="tabpanel" aria-labelledby="mcp-tab-agent">
          <div className="mcp-intro"><span className="mcp-step">1</span><div><h3>复制提示词，发给你的 Agent</h3><p>已包含本机连接参数，可直接发送。</p></div></div>
          <div className="mcp-primary-action">{copyButton('复制 Agent 连接提示词', connectionPrompt(config), true)}<span>适用于支持本地 MCP 的客户端</span></div>
          <details className="mcp-prompt-details"><summary>查看连接提示词</summary><textarea className="mcp-prompt" aria-label="Agent 连接提示词" readOnly value={connectionPrompt(config)} spellCheck={false} /></details>
          <div className="mcp-next"><span className="mcp-step">2</span><div><h3>按 Agent 的反馈完成连接</h3><p>发送后按 Agent 提示启用 MCP 并验证工具。无法自动配置时，请切换“手动添加”。</p></div></div>
        </section> : <section id="mcp-panel-manual" role="tabpanel" aria-labelledby="mcp-tab-manual">
          <div className="mcp-intro"><span className="mcp-step">1</span><div><h3>打开客户端的 MCP 设置，添加本地服务</h3><p>选择 stdio / 本地命令模式，将下面的值粘贴到对应输入框。</p></div></div>
          <div className="mcp-field-pair">{field('服务名称','moki-notes')}{field('传输方式','stdio')}</div>
          {field('启动命令',service.command,'命令框只填程序路径，不拼接参数；按字段粘贴时无需自行添加引号。')}
          <div className="mcp-field"><div className="mcp-field-heading"><strong>启动参数</strong>{copyButton('复制参数数组',JSON.stringify(service.args))}</div>{service.args.map((arg,i)=><div key={i}>{field(`参数 ${i+1}`,arg)}</div>)}<small>逐项参数框使用“复制参数”；要求 JSON 数组的参数框使用“复制参数数组”。</small></div>
          <div className="mcp-field"><strong>环境变量</strong><p className="mcp-field-help">逐行添加名称和值，以下项目都需要填写。</p>{Object.entries(service.env).map(([key,value])=><div className="mcp-env-row" key={key}>{field(`变量名 ${key}`,key)}{field(`变量值 ${key}`,value)}</div>)}</div>
          <details className="mcp-json"><summary>客户端支持 JSON？直接复制配置</summary><p>已有配置时，将 moki-notes 合并到 mcpServers 中，保留其他服务。</p><div className="mcp-json-actions">{copyButton('复制完整 MCP JSON',connectionJson(config))}{copyButton('复制单服务 JSON',JSON.stringify(service,null,2))}</div><textarea aria-label="完整 MCP JSON" readOnly value={connectionJson(config)} spellCheck={false}/><small>“完整 MCP JSON”包含 mcpServers；仅编辑一个服务时使用“单服务 JSON”。</small></details>
          <div className="mcp-next"><span className="mcp-step">2</span><div><h3>保存并启用服务</h3><p>按客户端要求重新加载 MCP 或重启，然后让 Agent 列出 MOKI便签工具，调用 notes_list 验证。</p></div></div>
        </section>}
        <div className="mcp-copy-status" role="status" aria-live="polite">{copied ? `${copied.replace(/^复制/,'')}已复制` : ''}</div>{copyError&&<p className="mcp-error" role="alert">{copyError}</p>}
        <details className="mcp-extra"><summary>数据位置与访问范围</summary><p className="data-path">{config.dataPath}</p><p>连接后可读写本地便签，删除进入回收站。知识树的检索开关决定搜索范围；Agent 仍可按 ID 读取便签。配置中的路径属于当前电脑，移动应用后请重新复制。</p></details>
      </>}
      <details className="mcp-extra"><summary>在便签内试搜知识树</summary><p>这是应用内的检索预览，不代表 Agent 已连接。</p><form className="context-search" onSubmit={e=>{e.preventDefault();setSearching(true);setSearchError('');void api<NonNullable<typeof context>>('/context','POST',{query,maxChars:5000}).then(c=>{if(alive.current)setContext(c);}).catch(e=>{if(alive.current)setSearchError((e as Error).message);}).finally(()=>{if(alive.current)setSearching(false);});}}><input aria-label="知识库检索" placeholder="输入关键词，例如：项目 计划" value={query} onChange={e=>setQuery(e.target.value)}/><button className="primary" disabled={searching}>{searching?'检索中…':'检索知识'}</button></form>{searchError&&<p role="alert">{searchError}</p>}{context&&(context.sources.length?context.sources.map(s=><button key={s.id} className="context-result" onClick={()=>{onSelect(s.id);onClose();}}><strong>{s.title}<small> · v{s.version}</small></strong><p>{s.text.slice(0,240)}</p></button>):<p>没有匹配的知识便签。</p>)}</details>
    </div>
  </section></div>;
}
