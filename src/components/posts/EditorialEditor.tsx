'use client';

import type { EditorialContent } from '@/lib/editorialContent';
import EditorialBlocks from './EditorialBlocks';

const field = 'w-full min-w-0 rounded border border-current/20 bg-transparent p-2 text-xs';

export default function EditorialEditor({ value, onChange }: { value: EditorialContent; onChange: (value: EditorialContent) => void }) {
  const sourceSelect = (url: string, update: (url: string) => void) => <select aria-label="자료 출처" className={field} value={url} onChange={(event) => update(event.target.value)}><option value="">출처 선택</option>{value.sources.map((source, index) => <option key={index} value={source.url}>{source.title || source.url}</option>)}</select>;
  return <section className="my-4 min-w-0 space-y-4 rounded-xl border border-current/20 p-4">
    <h3 className="text-sm font-bold">사진 · 표 · 수치 · 연락처</h3>
    <p className="text-xs">자동 자료는 원문을 확인한 뒤 편집하세요. 수치는 단위·기준일과 함께 표에 입력하세요. 직접 수정한 자료의 정확성은 게시 전 확인이 필요합니다.</p>
    <details><summary className="cursor-pointer text-xs font-bold">출처 보기 / 직접 자료 추가</summary><div className="mt-2 space-y-2">{value.sources.map((source, index) => <div key={index} className="space-y-1">
      <input aria-label="출처 제목" className={field} value={source.title} onChange={(event) => onChange({ ...value, sources: value.sources.map((row, i) => i === index ? { ...row, title: event.target.value } : row) })} />
      <input aria-label="출처 URL" type="url" className={field} value={source.url} onChange={(event) => onChange({ ...value, sources: value.sources.map((row, i) => i === index ? { ...row, url: event.target.value } : row) })} />
      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs">{source.excerpt}</p>
    </div>)}<button type="button" disabled={value.sources.length >= 6} className="text-xs underline" onClick={() => onChange({ ...value, sources: [...value.sources, { title: '', url: '', publisher: '직접 입력 · 검토 필요', retrievedAt: '', excerpt: '' }] })}>출처 추가 (선택)</button></div></details>
    {value.photos.map((photo, index) => <div key={photo.url} className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words text-xs">{photo.caption} · {photo.creator}</span><button type="button" className="text-xs underline" onClick={() => onChange({ ...value, photos: value.photos.filter((_, i) => i !== index) })}>사진 제외</button></div>)}
    {value.tables.map((table, index) => {
      const update = (patch: Partial<typeof table>) => onChange({ ...value, tables: value.tables.map((row, i) => i === index ? { ...row, ...patch } : row) });
      return <div key={index} className="min-w-0 space-y-2 border-t border-current/20 pt-3">
        <input aria-label="표 제목" className={field} value={table.title} onChange={(event) => update({ title: event.target.value })} />
        {sourceSelect(table.sourceUrl, (sourceUrl) => update({ sourceUrl }))}
        <div className="overflow-x-auto"><table className="w-full"><thead><tr>{table.columns.map((column, col) => <th key={col}><input aria-label={`열 ${col + 1} 제목`} className={field} value={column} onChange={(event) => update({ columns: table.columns.map((cell, i) => i === col ? event.target.value : cell) })} /></th>)}</tr></thead><tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><input aria-label={`행 ${r + 1} 열 ${c + 1}`} className={field} value={cell} onChange={(event) => update({ rows: table.rows.map((cells, i) => i === r ? cells.map((text, j) => j === c ? event.target.value : text) : cells) })} /></td>)}<td><button type="button" aria-label={`행 ${r + 1} 삭제`} onClick={() => update({ rows: table.rows.filter((_, i) => i !== r) })}>×</button></td></tr>)}</tbody></table></div>
        <div className="flex gap-3 text-xs"><button type="button" disabled={table.rows.length >= 20} onClick={() => update({ rows: [...table.rows, table.columns.map(() => '')] })}>행 추가</button><button type="button" disabled={table.columns.length >= 6} onClick={() => update({ columns: [...table.columns, '항목'], rows: table.rows.map((row) => [...row, '']) })}>열 추가</button><button type="button" onClick={() => onChange({ ...value, tables: value.tables.filter((_, i) => i !== index) })}>표 삭제</button></div>
      </div>;
    })}
    <button type="button" className="text-xs underline" disabled={value.tables.length >= 4} onClick={() => onChange({ ...value, tables: [...value.tables, { title: '자료 표', columns: ['항목', '값', '단위 / 기준일'], rows: [['', '', '']], sourceUrl: value.sources[0]?.url || '' }] })}>표 / 수치 추가</button>
    {value.contacts.map((contact, index) => {
      const update = (patch: Partial<typeof contact>) => onChange({ ...value, contacts: value.contacts.map((row, i) => i === index ? { ...row, ...patch } : row) });
      return <div key={index} className="space-y-2 border-t border-current/20 pt-3"><input aria-label="연락처 종류" className={field} value={contact.label} onChange={(event) => update({ label: event.target.value })} /><input aria-label="연락처 값" className={field} value={contact.value} onChange={(event) => update({ value: event.target.value })} />{sourceSelect(contact.sourceUrl, (sourceUrl) => update({ sourceUrl }))}<button type="button" className="text-xs underline" onClick={() => onChange({ ...value, contacts: value.contacts.filter((_, i) => i !== index) })}>연락처 삭제</button></div>;
    })}
    <button type="button" className="ml-3 text-xs underline" disabled={value.contacts.length >= 10} onClick={() => onChange({ ...value, contacts: [...value.contacts, { label: '연락처', value: '', sourceUrl: value.sources[0]?.url || '' }] })}>연락처 추가</button>
    <EditorialBlocks value={value} showGuidance />
  </section>;
}
