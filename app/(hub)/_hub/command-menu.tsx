"use client";
import { useEffect, useRef, useState } from 'react';
import { Search, ArrowUpRight, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useHub } from './hub-provider';
import type { Asset } from '@/lib/socialtrading/types';

const destinations = [ ['Home', '/'], ['Explore', '/explore'], ['Memory', '/activity'], ['Your thesis', '/thesis'], ['Manage agents', '/agents'], ['Profile & settings', '/profile'], ['Plan & billing', '/plans'] ];
export function CommandMenu({ resolveHref }: { resolveHref: (href: string) => string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState('');
  const { market, chats, selectChat } = useHub();
  const router = useRouter();
  function close() { dialog.current?.close(); setOpen(false); origin.current?.focus(); }
  function show() { origin.current = document.activeElement as HTMLElement; setQuery(''); setAssets([]); setOpen(true); dialog.current?.showModal(); input.current?.focus(); }
  function go(href: string) { close(); router.push(resolveHref(href)); }
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (dialog.current?.open) close(); else show(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!open || query.trim().length < 2) { setAssets([]); setStatus(''); return; }
    let live = true; setStatus('Searching your market…'); setAssets([]);
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled([market({ kind: 'stock', q: query }), market({ kind: 'crypto', q: query })]);
      if (!live) return;
      const found = results.flatMap(r => r.status === 'fulfilled' ? r.value : []).slice(0, 8);
      setAssets(found); setStatus(results.every(r => r.status === 'rejected') ? 'Market search unavailable. Destinations are still accessible.' : found.length ? '' : 'No matching assets. Try another name.');
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [open, query, market]);
  return <><button className="rubicon-command-trigger" onClick={show} aria-label="Search or jump to anything" aria-keyshortcuts="Meta+k Control+k"><Search size={14}/><kbd>⌘ K</kbd></button>
    <dialog className="rubicon-command dashboard-theme" ref={dialog} aria-label="Jump to anything" onPointerDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => {
      e.stopPropagation();
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault(); const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('[data-command]') ?? []);
      if (!nodes.length) return; const at = nodes.indexOf(document.activeElement as HTMLElement); nodes[(at + (e.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
    }}>
      <header><Search size={18}/><input ref={input} aria-label="Search destinations and assets" value={query} onChange={e => setQuery(e.target.value)} placeholder="Where does your mind go?" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>('[data-command]')?.click(); } }}/><button aria-label="Close search" onClick={close}><X size={16}/></button></header>
      <div className="command-results">{destinations.filter(([name]) => name.toLowerCase().includes(query.toLowerCase())).map(([name, href]) => <button data-command key={href} onClick={() => go(href)}><span>{name}</span><ArrowUpRight size={14}/></button>)}
      {query.trim().length >= 2 && chats.filter(chat => chat.title.toLowerCase().includes(query.toLowerCase())).slice(0, 5).map(chat => <button data-command key={chat.id} onClick={() => { selectChat(chat.id); go('/'); }}><span>{chat.title}</span><small>Conversation</small></button>)}
      {assets.map(asset => <button data-command key={`${asset.kind}:${asset.id}`} onClick={() => go(`/explore/${asset.kind}/${encodeURIComponent(asset.id)}`)}><span><strong>{asset.symbol}</strong> {asset.name}</span><small>{asset.kind}</small></button>)}{status && <p role="status">{status}</p>}</div>
      <footer>↑ ↓ to move · Enter to open · Esc to return</footer>
    </dialog></>;
}
