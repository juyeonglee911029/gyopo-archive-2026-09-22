import type { Metadata } from 'next';
import Link from 'next/link';
import { ContentCard, ContentCardBody, ContentCardFooter, PageContainer, PageHeader, SectionHeader } from '@/components/ui/Primitives';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('회원가입', '기존 Google 로그인과 프로필 설정으로 GYOPO에 가입하세요.', '/register');

export default function RegisterPage() {
  return (
    <PageContainer category="register">
      <PageHeader breadcrumb={<Link href="/">GYOPO 홈</Link>} title="GYOPO 회원가입" subtitle="별도 가입 양식 없이 기존 Google 로그인으로 시작합니다." />
      <ContentCard aria-labelledby="register-flow-heading">
        <ContentCardBody>
          <SectionHeader id="register-flow-heading" title="로그인과 가입을 한 번에" />
          <ol className="ui-onboarding-steps"><li>로그인 화면에서 Google 계정을 선택하세요.</li><li>처음 방문하면 안내에 따라 필요한 프로필을 설정하세요.</li><li>이미 가입했다면 같은 계정으로 계속 이용하세요.</li></ol>
          <p className="ui-registration-note">이 페이지는 별도 계정을 만들지 않습니다. 실제 가입과 인증은 기존 로그인 및 프로필 설정 절차에서 진행됩니다.</p>
        </ContentCardBody>
        <ContentCardFooter><Link className="ui-button" href="/login">Google 로그인으로 가입하기</Link><nav className="ui-inline-links" aria-label="가입 관련 안내"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/help">도움센터</Link></nav></ContentCardFooter>
      </ContentCard>
    </PageContainer>
  );
}
