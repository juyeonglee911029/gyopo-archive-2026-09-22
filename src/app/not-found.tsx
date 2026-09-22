import Link from 'next/link';
import '@/styles/route-experience.css';

export const runtime = 'edge';

export default function NotFound() {
  return <section className="ui-state route-state">
    <p>404</p><h1>페이지를 찾을 수 없습니다</h1>
    <p>주소가 변경되었거나 삭제된 콘텐츠입니다.</p>
    <div className="route-state-actions"><Link href="/">홈으로</Link><Link href="/community">커뮤니티</Link></div>
  </section>;
}
