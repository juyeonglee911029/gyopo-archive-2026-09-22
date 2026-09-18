'use client';
import { useRef, useState } from 'react';
import { getFreshSessionToken } from '@/lib/firebase';
import { parseGoogleMapsUrl } from '@/lib/directoryMaps';

export type LinkedPlace = { placeId: string; name: string; address: string; tel: string; mapsUrl: string; businessStatus: string };
export default function PlaceLinker({ onSelect }: { onSelect: (place: LinkedPlace | null) => void }) {
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('Google Maps 링크 또는 업체명·주소를 입력하고 검색해주세요.');
  const [suggestions, setSuggestions] = useState<Array<{ placeId: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const maps = parseGoogleMapsUrl(input);
  async function lookup(placeId?: string) {
    const version = ++revision.current;
    onSelect(null); setBusy(true); setSuggestions([]);
    try {
      if (!placeId && /^https?:/i.test(input)) {
        if (!maps) throw new Error('Google Maps HTTPS 링크만 허용됩니다.');
        onSelect({ placeId: '', name: '', address: '', tel: '', mapsUrl: maps.url, businessStatus: 'UNVERIFIED' });
        setMessage('Maps 링크 연결됨 · Google 미검증. 영업 중인 실제 업체의 이름·주소·전화번호를 직접 입력해주세요. Google 평점·리뷰는 생성되지 않습니다.');
        return;
      }
      const token = await getFreshSessionToken();
      if (!token) throw new Error('장소 검색·등록은 로그인 후 가능합니다.');
      const response = await fetch(`/api/directory/place?${placeId ? `placeId=${encodeURIComponent(placeId)}` : `input=${encodeURIComponent(input.trim())}`}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '장소를 확인하지 못했습니다.');
      if (version !== revision.current) return;
      if (placeId) {
        if (data.businessStatus !== 'OPERATIONAL') throw new Error('영업 중인 실제 업체만 등록할 수 있습니다.');
        onSelect(data); setMessage(`Google 확인: ${data.name} · ${data.address}`);
      } else { setSuggestions(data.suggestions); setMessage(data.suggestions.length ? '정확한 업체를 선택해주세요. Powered by Google' : '검색 결과가 없습니다. 주소를 더 구체적으로 입력해주세요.'); }
    } catch (error) { if (version === revision.current) setMessage(error instanceof Error ? error.message : '조회 실패'); }
    finally { if (version === revision.current) setBusy(false); }
  }
  return <section className="space-y-2 border border-cyan-300/30 p-3 text-sm">
    <label htmlFor="directory-place">Google Maps 링크 또는 업체 주소</label>
    <input id="directory-place" maxLength={2048} value={input} onChange={e => { revision.current++; setBusy(false); setInput(e.target.value); onSelect(null); setSuggestions([]); }} className="w-full" />
    <button type="button" disabled={busy || input.trim().length < 3} onClick={() => void lookup()} className="border px-3 py-2 disabled:opacity-50">{busy ? '확인 중...' : 'Google 장소 검색 / 링크 확인'}</button>
    {maps && <a href={maps.url} target="_blank" rel="noopener noreferrer" className="block text-cyan-200 underline">Google Maps에서 직접 확인</a>}
    <p role="status" className="text-xs text-slate-300">{message}</p>
    {suggestions.map(s => <button type="button" key={s.placeId} onClick={() => void lookup(s.placeId)} className="block w-full border border-white/20 p-2 text-left">{s.label}</button>)}
  </section>;
}
