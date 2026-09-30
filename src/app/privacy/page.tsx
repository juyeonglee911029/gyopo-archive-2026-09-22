export default function PrivacyPage() {
  return <article className="category-page container mx-auto max-w-3xl px-4 py-12 text-slate-100">
    <header className="category-header"><div className="category-heading">
    <p className="text-xs font-black uppercase tracking-[.24em] text-cyan-300">Safety & Privacy</p>
    <h1 className="mt-3 text-3xl font-black">개인정보처리방침</h1>
    <p className="mt-4 text-sm leading-7 text-slate-400">데이트와 랜덤 화상채팅의 18세 이상 여부는 현재 회원 프로필의 자기 신고 정보이며 외부 신분증으로 검증되지 않습니다. 일반 공개 전 관할 지역의 개인정보·아동 안전·통신 관련 법률 검토가 필요합니다.</p>
    </div></header>
    <div className="mt-8 max-w-3xl space-y-6 text-sm leading-7 text-slate-300">
      <section><h2 className="text-lg font-black text-white">1. 수집 정보와 목적</h2><p className="mt-2">Google 로그인 계정의 이름·이메일·프로필 이미지는 계정 식별과 서비스 제공에 사용합니다. 프로필의 성별·나이·국가는 매칭 안전과 연령 필터에 사용하며, 랜덤 화상채팅 화면에는 실명 대신 익명 별칭을 표시합니다.</p></section>
      <section><h2 className="text-lg font-black text-white">2. 영상·음성 처리</h2><p className="mt-2">화상·음성은 WebRTC 연결을 통해 상대방에게 전송됩니다. GYOPO는 영상·음성 녹화를 기본 저장하지 않습니다. 화면 공유를 시작하면 사용자가 공유한 화면과 오디오가 상대방에게 전송될 수 있습니다.</p></section>
      <section><h2 className="text-lg font-black text-white">3. 안전 운영 기록</h2><p className="mt-2">신고·차단·계정 제재·안전 감사 로그는 신고 처리, 재발 방지, 법적 의무 대응을 위해 저장할 수 있습니다. 화상채팅 메시지는 기본 1분 후 자동 삭제하며, 신고 사건과 관련된 최소 정보는 사건 종결 및 법정 보존 의무가 끝날 때까지 보존합니다.</p></section>
      <section><h2 className="text-lg font-black text-white">4. 자동 필터와 제한</h2><p className="mt-2">전화번호·이메일·주소·외부 연락처·외부 링크·도배성 입력은 자동 차단합니다. 악성 링크, 성적·불법 콘텐츠, 괴롭힘, 미성년자 안전 우려는 신고·차단·계정 정지 대상이 될 수 있습니다. IP·세션 기반 요청 제한과 봇 방지 신호를 서비스 운영에 사용할 수 있습니다.</p></section>
      <section><h2 className="text-lg font-black text-white">5. 이용자 권리와 문의</h2><p className="mt-2">이용자는 자신의 신고·차단 기록과 개인정보 처리에 관한 문의, 정정·삭제 요청을 할 수 있습니다. 다만 사기·학대·불법 콘텐츠 대응과 법적 의무를 위해 필요한 최소 기록은 즉시 삭제되지 않을 수 있습니다. 운영 문의는 서비스 고객센터를 이용해주세요.</p></section>
      <section><h2 className="text-lg font-black text-white">6. 데이트 프로필과 관심 요청</h2><p className="mt-2">데이트 프로필은 기존 회원이 공개를 직접 켠 경우에만 검색에 포함됩니다. 다른 공개 참여자에게 표시 이름·사진·회원 프로필 나이와 성별·국가/도시·소개가 표시됩니다. 나이는 자기 신고 정보입니다. 관심 요청과 수락 상태는 요청 당사자만 확인할 수 있으며, 기능은 프로필 공개가 켜진 만 18세 이상 회원에게만 제공됩니다. 차단된 관계는 회원 검색 결과에서 제외됩니다. 프로필 공개를 끄면 신규 검색에서 숨겨집니다.</p></section>
    </div>
  </article>;
}
import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('GYOPO 개인정보처리방침', 'GYOPO가 서비스 제공을 위해 개인정보를 처리하는 기준과 이용자의 권리를 안내합니다.', '/privacy');
