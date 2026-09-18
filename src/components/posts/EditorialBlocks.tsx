import { normalizeEditorial } from '@/lib/editorialContent';

export default function EditorialBlocks({ value, showGuidance = false }: { value?: unknown; showGuidance?: boolean }) {
  const data = normalizeEditorial(value);
  return <div className="my-6 min-w-0 space-y-6 text-sm leading-6">
    {data.photos.map((photo) => <figure key={photo.url} className="editorial-tile min-w-0">
      <img src={photo.url} alt={photo.caption} loading="lazy" referrerPolicy="no-referrer" className="max-h-96 w-full rounded-xl object-contain" />
      <figcaption className="mt-2 break-words text-xs">{photo.caption} · {photo.creator} · <a className="underline" href={photo.sourceUrl} target="_blank" rel="noreferrer">사진 원문</a> · <a className="underline" href={photo.license} target="_blank" rel="noreferrer">{photo.license.includes('/zero/') ? 'CC0 1.0' : photo.license.includes('/by-sa/') ? 'CC BY-SA 4.0' : 'CC BY 4.0'}</a></figcaption>
    </figure>)}
    {data.tables.map((table, index) => <div key={index} className="min-w-0">
      <div className="editorial-tile overflow-x-auto rounded-lg border border-current/20"><table className="w-full border-collapse text-left">
        <caption className="p-3 text-left font-bold">{table.title}</caption>
        <thead><tr>{table.columns.map((column, i) => <th scope="col" key={i} className="border border-current/20 p-2">{column}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="min-w-24 max-w-xs break-words border border-current/20 p-2">{cell}</td>)}</tr>)}</tbody>
      </table></div><a className="text-xs underline" href={table.sourceUrl} target="_blank" rel="noreferrer">표 출처</a>
    </div>)}
    {data.contacts.length > 0 && <section className="editorial-tile"><h2 className="font-bold">연락처</h2><dl>{data.contacts.map((contact, index) => <div key={index} className="mt-2 break-words"><dt className="font-bold">{contact.label}</dt><dd>{contact.value} · <a href={contact.sourceUrl} target="_blank" rel="noreferrer" className="text-xs underline">원문 확인</a></dd></div>)}</dl></section>}
    {data.sources.length > 0 && <section className="editorial-tile"><h2 className="font-bold">참고 출처</h2><ul>{data.sources.map((source) => <li key={source.url} className="mt-2 break-words"><a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title}</a><p className="text-xs">{source.publisher}{source.retrievedAt && ` · 조회 ${source.retrievedAt.slice(0, 10)}`}</p></li>)}</ul></section>}
    {showGuidance && data.guidance.length > 0 && <aside className="rounded-xl border border-amber-400/30 p-3"><h2 className="font-bold">AI 편집 안내 · 게시 전 확인</h2><ul className="list-inside list-disc">{data.guidance.map((item, index) => <li key={index}>{item}</li>)}</ul></aside>}
  </div>;
}
