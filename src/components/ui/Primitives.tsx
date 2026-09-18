import Link from 'next/link';
import { ArrowUpRight, Inbox, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

export type CategoryCardProps = {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
  badge?: ReactNode;
  status?: ReactNode;
  count?: number;
  newCount?: number;
};

export function CategoryCard({ icon, title, description, href, badge, status, count, newCount }: CategoryCardProps) {
  const hasCount = typeof count === 'number' && Number.isFinite(count) && count >= 0;
  const hasNewCount = typeof newCount === 'number' && Number.isFinite(newCount) && newCount > 0;
  return (
    <Link href={href} className="ui-category-card">
      <div className="ui-category-card-top">
        <span className="ui-category-card-icon" aria-hidden="true">{icon}</span>
        <span className="ui-category-card-badge">{badge}</span>
        <ArrowUpRight className="ui-category-card-arrow" size={16} aria-hidden="true" />
      </div>
      <div className="ui-category-card-body">
        <h3 className="ui-category-card-title">{title}</h3>
        <p className="ui-category-card-description">{description}</p>
      </div>
      <div className="ui-category-card-meta">
        {status != null && <span className="ui-category-card-status">{status}</span>}
        {hasCount && <span className="ui-category-card-count">{count}개</span>}
        {hasNewCount && <span className="ui-category-card-new">새 글 {newCount}개</span>}
      </div>
    </Link>
  );
}

export type PageHeaderProps = {
  breadcrumb?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  stats?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ breadcrumb, title, subtitle, stats, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header category-header">
      <div className="ui-page-header-copy category-heading">
        {breadcrumb != null && <nav className="ui-breadcrumb" aria-label="현재 위치">{breadcrumb}</nav>}
        <h1 className="ui-page-title">{title}</h1>
        {subtitle != null && <p className="ui-page-subtitle">{subtitle}</p>}
        {stats != null && <div className="ui-page-stats">{stats}</div>}
      </div>
      {actions != null && <div className="ui-page-actions">{actions}</div>}
    </header>
  );
}

export type PageContainerProps = {
  sidebar?: ReactNode;
  rightRail?: ReactNode;
  pageTitle?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  category?: string;
  region?: string;
  children: ReactNode;
  className?: string;
};

export function PageContainer({ sidebar, rightRail, pageTitle, breadcrumb, actions, category, region, children, className = '' }: PageContainerProps) {
  return (
    <div className={`page-container ${className}`.trim()} data-category={category} data-region={region}>
      {pageTitle != null && <PageHeader title={pageTitle} breadcrumb={breadcrumb} actions={actions} />}
      <div className="page-container-grid" data-sidebar={sidebar != null || undefined} data-right-rail={rightRail != null || undefined}>
        {sidebar != null && <aside className="page-container-sidebar" aria-label="페이지 메뉴">{sidebar}</aside>}
        <div className="page-container-content">{children}</div>
        {rightRail != null && <aside className="page-container-right-rail" aria-label="관련 정보">{rightRail}</aside>}
      </div>
    </div>
  );
}

export type SectionHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  id?: string;
};

export function SectionHeader({ title, subtitle, actions, id }: SectionHeaderProps) {
  return (
    <div className="ui-section-header">
      <div><h2 id={id} className="ui-section-title">{title}</h2>{subtitle != null && <p className="ui-section-subtitle">{subtitle}</p>}</div>
      {actions != null && <div className="ui-section-actions">{actions}</div>}
    </div>
  );
}

export function ContentCard({ className = '', children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`ui-content-card ${className}`.trim()}>{children}</section>;
}

export function ContentCardHeader({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-content-card-header ${className}`.trim()}>{children}</div>;
}

export function ContentCardBody({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-content-card-body ${className}`.trim()}>{children}</div>;
}

export function ContentCardFooter({ className = '', children, ...props }: HTMLAttributes<HTMLElement>) {
  return <footer {...props} className={`ui-content-card-footer ${className}`.trim()}>{children}</footer>;
}

export type StateProps = { title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode };

export function EmptyState({ title, description, icon = <Inbox size={24} />, actions }: StateProps) {
  return (
    <div className="ui-state ui-empty-state" role="status">
      <span className="ui-state-icon" aria-hidden="true">{icon}</span>
      <h3 className="ui-state-title">{title}</h3>
      {description != null && <p className="ui-state-description">{description}</p>}
      {actions != null && <div className="ui-state-actions">{actions}</div>}
    </div>
  );
}

export function ErrorState({ title, description, icon = <TriangleAlert size={24} />, actions }: StateProps) {
  return (
    <div className="ui-state ui-error-state" role="alert">
      <span className="ui-state-icon" aria-hidden="true">{icon}</span>
      <h3 className="ui-state-title">{title}</h3>
      {description != null && <p className="ui-state-description">{description}</p>}
      {actions != null && <div className="ui-state-actions">{actions}</div>}
    </div>
  );
}

export function Skeleton({ label = '불러오는 중입니다', lines = 3 }: { label?: string; lines?: number }) {
  const lineCount = Number.isFinite(lines) ? Math.max(1, Math.min(12, Math.floor(lines))) : 3;
  return <div className="ui-skeleton" role="status" aria-busy="true"><span className="sr-only">{label}</span>{Array.from({ length: lineCount }, (_, index) => <div className="ui-skeleton-line" key={index} aria-hidden="true" />)}</div>;
}

export function AdSlot({ children, label = '광고' }: { children: ReactNode; label?: string }) {
  return <aside className="ui-ad-slot" aria-label={label}><span className="ui-ad-label">{label}</span>{children}</aside>;
}
