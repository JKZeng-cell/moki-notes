import { describe, it, expect } from 'vitest';
import { NotesStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { knowledgeLayout, knowledgeEdges, separateKnowledgePoints } from '../src/web/knowledge-model.js';
import type { NoteSummary } from '../src/shared/model.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('lazy list and focused graph', () => {
  it('migrates existing notes and keeps projections current across external writes, rollback and purge', () => {
    const dir=mkdtempSync(join(tmpdir(),'moki-lazy-')), path=join(dir,'notes.db');
    const original=new NotesStore(path), n=original.create({title:'existing',content:'original body'}); original.close();
    const old=new DatabaseSync(path);
    old.exec('DROP TRIGGER note_directory_insert; DROP TRIGGER note_directory_update; DROP TRIGGER note_directory_delete; DROP TABLE note_directory;'); old.close();
    const store=new NotesStore(path), external=new DatabaseSync(path);
    try {
      expect(store.card(store.directory()[0]).excerpt).toBe('original body');
      const before=store.feedRevision();
      external.prepare('UPDATE notes SET json=? WHERE id=?').run(JSON.stringify({...n,title:'external',content:'new body',version:2}),n.id);
      expect(store.feedRevision()).not.toBe(before); expect(store.card(store.directory()[0])).toMatchObject({title:'external',excerpt:'new body'});
      external.exec('BEGIN'); external.prepare('DELETE FROM notes WHERE id=?').run(n.id); external.exec('ROLLBACK');
      expect(store.directory()).toHaveLength(1);
      store.clearTrash([{id:n.id,version:2}],true);
      expect(store.db.prepare('SELECT COUNT(*) AS n FROM note_directory').get()!.n).toBe(0);
    } finally {external.close();store.close();rmSync(dir,{recursive:true,force:true});}
  });
  it('returns small disjoint chunks, omits bodies/links, detects updates and searches beyond excerpt', async () => {
    const s = new NotesStore(':memory:'), app = await createApp(s);
    try {
      const made = Array.from({length: 75}, (_, i) => s.create({ title: `note ${i}`, content: 'x'.repeat(8000) + (i === 40 ? '懒加载深处关键词' : ''), source: 'secret-source' }));
      const post = async (body: object) => (await app.inject({method:'POST',url:'/api/list/feed',payload:body})).json();
      const first = await post({ sort:'manual' });
      expect(first.items).toHaveLength(30); expect(first.total).toBe(75);
      expect(JSON.stringify(first).length).toBeLessThan(25000);
      expect(first.items.every((n: any) => !('content' in n) && !n.source && n.excerpt.length <= 141)).toBe(true);
      const second = await post({sort:'manual',offset:30}); expect(second.items).toHaveLength(30);
      expect(new Set([...first.items,...second.items].map(n=>n.id)).size).toBe(60);
      expect((await post({knownRevision:first.revision})).unchanged).toBe(true);
      expect((await post({q:'懒加载深处关键词'})).items[0].id).toBe(made[40].id);
      s.update(made[0].id,{title:'changed'},1);
      expect((await post({knownRevision:first.revision})).unchanged).toBeUndefined();
      const catalog = (await app.inject({method:'POST',url:'/api/catalog',payload:{}})).json();
      expect(catalog.items.every((n: any)=>n.excerpt === '' && n.links.length === 0 && !('content' in n))).toBe(true);
      expect((await app.inject({method:'POST',url:'/api/list/feed',payload:{limit:500}})).statusCode).toBe(400);
    } finally { await app.close(); s.close(); }
  });
  it('loads only direct parent, children, links and backlinks, and bounds high-degree nodes', () => {
    const s = new NotesStore(':memory:');
    try {
      const parent=s.create({title:'parent'}), root=s.create({title:'root',parentId:parent.id});
      const child=s.create({title:'child',parentId:root.id}), grand=s.create({title:'grand',parentId:child.id});
      const reverse=s.create({title:'reverse',links:[root.id]}), unrelated=s.create({title:'unrelated'});
      expect(new Set(s.neighborhood(root.id).items.map(n=>n.id))).toEqual(new Set([root.id,parent.id,child.id,reverse.id]));
      expect(s.neighborhood(child.id).items.map(n=>n.id)).toContain(grand.id);
      expect(s.neighborhood(root.id).items.map(n=>n.id)).not.toContain(unrelated.id);
      for(let i=0;i<55;i++) s.create({title:`child ${i}`,parentId:root.id});
      const first=s.neighborhood(root.id), second=s.neighborhood(root.id,40);
      expect(first.items).toHaveLength(41); expect(first.hasMore).toBe(true);
      expect(new Set([...first.items,...second.items].map(n=>n.id)).size).toBe(first.total);
      expect(s.neighborhood('missing').items).toEqual([]);
    } finally {s.close();}
  });
  it('avoids complete node/title rectangles in dense networks and overlapping saved positions', () => {
    const nodes = Array.from({length:80},(_,i)=>({id:String(i),parentId:i?'0':null,links:[]} as unknown as NoteSummary));
    const assertSeparated=(points:Map<string,{x:number;y:number}>)=>{
      const p=[...points.values()]; for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++) expect(Math.abs(p[i].x-p[j].x)>=189.9 || Math.abs(p[i].y-p[j].y)>=129.9).toBe(true);
    };
    assertSeparated(knowledgeLayout(nodes,knowledgeEdges(nodes)));
    const saved=new Map(nodes.map(n=>[n.id,{x:0,y:0}]));
    const result=separateKnowledgePoints(saved,'2'); assertSeparated(result);
    expect(result.get('2')).toEqual({x:0,y:0}); expect(saved.get('3')).toEqual({x:0,y:0});
  });
});
