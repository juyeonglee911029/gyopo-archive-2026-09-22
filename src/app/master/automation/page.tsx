import { Suspense } from 'react';
import EditorialAutomationWorkspace from '@/components/master/editorialautomationworkspace';

export default function AutomationPage() {
  return <main className="mx-auto min-w-0 max-w-7xl px-4 py-8 text-slate-100"><Suspense fallback={<p>자동 편집실을 준비합니다.</p>}><EditorialAutomationWorkspace /></Suspense></main>;
}
