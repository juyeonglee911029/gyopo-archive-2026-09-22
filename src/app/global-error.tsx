'use client';


export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#070b17', color: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ width: 'min(560px, calc(100% - 32px))', padding: '32px', border: '1px solid rgba(148,163,184,.2)', background: '#10182b' }}>
          <p style={{ margin: '0 0 12px', color: '#5eead4', fontSize: 12, fontWeight: 800, letterSpacing: '.16em' }}>GYOPO</p>
          <h1 style={{ margin: '0 0 12px', fontSize: 28 }}>잠시 문제가 발생했습니다.</h1>
          <p style={{ margin: '0 0 24px', color: '#94a3b8', lineHeight: 1.6 }}>페이지를 다시 시도하거나 잠시 후 다시 방문해주세요.</p>
          <button type="button" onClick={() => reset()} style={{ border: 0, background: '#5eead4', padding: '12px 16px', color: '#06111d', fontWeight: 800, cursor: 'pointer' }}>다시 시도</button>
        </main>
      </body>
    </html>
  );
}
