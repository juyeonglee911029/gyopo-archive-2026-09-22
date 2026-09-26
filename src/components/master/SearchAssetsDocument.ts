// Standalone reconstruction of the selected public document, not a second React root.
export const searchAssetsDocument = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>GYOPO URL 키워드 자산</title>
  <style>
    :root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;background:#07111f;color:#edf6ff}main{max-width:1500px;margin:auto;padding:28px 20px 60px}
    header{border:1px solid #21425b;border-radius:22px;background:#0b192b;padding:24px;box-shadow:0 20px 70px #0005}
    .eyebrow{color:#70e6d5;font-size:11px;font-weight:900;letter-spacing:.2em}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.top h1{margin:8px 0;font-size:clamp(30px,4vw,52px);line-height:1.05;letter-spacing:-.06em}.muted{color:#9db0c3;line-height:1.6}.actions{display:flex;flex-wrap:wrap;gap:8px}button,input,select{font:inherit}button{border:0;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:800;cursor:pointer;background:#71e7d5;color:#06131e}button.secondary{border:1px solid #3c5267;background:#12243a;color:#d8e7f4}button:disabled{cursor:wait;opacity:.55}
    .notice{margin-top:16px;border:1px solid #44637e;border-radius:12px;padding:11px 13px;font-size:12px;color:#c5d6e5}.notice.warn{border-color:#a66c27;color:#ffdaa0;background:#2a1d0f}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:20px 0;background:#223951;border:1px solid #223951;border-radius:16px;overflow:hidden}.kpi{padding:17px;background:#0d1c2f}.kpi strong{display:block;font-size:27px}.kpi span{color:#9aafc1;font-size:11px}
    .controls{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.controls input{min-width:260px;flex:1}.controls input,.controls select{border:1px solid #314b64;border-radius:10px;background:#0d1c2f;color:#edf6ff;padding:10px 12px;font-size:12px}
    .table-wrap{overflow:auto;border:1px solid #203b55;border-radius:16px;background:#0b192b}.table{width:100%;min-width:900px;border-collapse:collapse;font-size:12px}.table th,.table td{padding:12px;text-align:left;border-bottom:1px solid #1b334b;vertical-align:top}.table th{position:sticky;top:0;background:#102238;color:#9db5ca;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.table tr:hover td{background:#10243a}.path{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f4fbff;font-weight:800}.tag{display:inline-block;border-radius:999px;padding:4px 8px;background:#163b48;color:#9df2df;font-size:10px;font-weight:800}.tag.amber{background:#3b2b16;color:#ffd78c}.slots{color:#bdd0df}.empty{padding:50px;text-align:center;color:#93a9bd}
    .modal{position:fixed;inset:0;z-index:10;display:flex;justify-content:center;align-items:center;padding:16px;background:#000b;width:100%;max-width:none;height:100dvh;max-height:none;margin:0;border:0;color:inherit}.modal:not([open]){display:none}.panel{width:min(1050px,100%);max-height:90vh;overflow:auto;border:1px solid #2c526e;border-radius:20px;background:#091827;padding:20px}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.panel h2{margin:4px 0;font-size:23px;overflow-wrap:anywhere}.slot-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;margin-top:16px;background:#1e394f;border:1px solid #1e394f}.slot{padding:10px;background:#0c1b2d;font-size:12px;overflow-wrap:anywhere}.slot b{display:inline-block;width:38px;color:#73e9d7}.slot small{color:#91a9bc}.close{background:#253c53;color:#e8f2fa}
    @media(max-width:760px){main{padding:15px}.top{display:block}.actions{margin-top:16px}.kpis{grid-template-columns:repeat(2,1fr)}.slot-grid{grid-template-columns:1fr}.controls input{min-width:100%}}
  </style>
</head>
<body>
<main>
  <header>
    <div class="top"><div><div class="eyebrow">GYOPO / SEARCH GROWTH</div><h1>URL별 키워드 자산</h1><p class="muted">후보 K01~K80은 바로 확인하고, Google에서 실제 확인된 검색어·수집 상태는 관리자 동기화로 덧붙입니다.</p></div><div class="actions"><button id="login" disabled>포털 Google 로그인</button><button id="reload" class="secondary">후보 새로고침</button></div></div>
    <div id="provenance" class="notice warn">후보 출처를 확인하는 중입니다. Google 성과와 색인 상태는 별도 동기화가 필요합니다.</div>
    <div id="message" class="notice" role="status" aria-live="polite">후보 키워드를 불러오는 중입니다.</div>
  </header>
  <section class="kpis"><div class="kpi"><strong id="assets">-</strong><span>전체 URL 자산</span></div><div class="kpi"><strong id="slots">-</strong><span>후보 슬롯 (URL × 80)</span></div><div class="kpi"><strong id="verified">-</strong><span>Google 검증 검색어</span></div><div class="kpi"><strong id="unverified">-</strong><span>색인 확인 필요 URL</span></div></section>
  <div class="controls"><input id="filter" aria-label="URL 또는 의도 검색" placeholder="URL 또는 의도 검색"><select id="segment" aria-label="사이트맵 구간"><option value="all">모든 사이트맵 구간</option></select><button id="clear" class="secondary">필터 초기화</button></div>
  <div class="table-wrap"><table class="table"><thead><tr><th>매핑 상태</th><th>목표 URL</th><th>사이트맵</th><th>후보 슬롯</th><th>Google 상태</th><th>확인</th></tr></thead><tbody id="rows"><tr><td colspan="6" class="empty">후보 키워드를 불러오는 중입니다.</td></tr></tbody></table></div>
  <noscript><p class="notice warn">후보 조회와 Google 로그인에는 JavaScript가 필요합니다.</p></noscript>
</main>
<dialog id="modal" class="modal" aria-labelledby="detail-title"></dialog>
<script type="module">
  const MASTER = 'juyeonglee911029@gmail.com';
  const SESSION_KEY = 'gyopo-auth-session';
  const state = { user:null, sessionToken:'', active:true, data:null, live:new Map(), queries:new Map(), source:'not_checked', filter:'', segment:'all', authVersion:0, liveRequest:null, detailVersion:0 };
  let sessionExpiryTimer;
  const $ = (id) => document.getElementById(id);
  const message = (text, warning=false) => { $('message').textContent = text; $('message').className = 'notice' + (warning ? ' warn' : ''); };
  const fmt = (value) => value == null ? '-' : Number(value).toLocaleString('ko-KR');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const isMaster = () => state.user?.email?.toLowerCase() === MASTER;
  const pathKey = (value) => {
    try {
      const url = new URL(value, location.origin);
      if (![location.origin, 'https://gyopo.kr', 'https://www.gyopo.kr'].includes(url.origin)) return '';
      return url.pathname.replace(/\/+$/, '') || '/';
    } catch { return ''; }
  };
  const liveFor = (path) => state.live.get(pathKey(path));
  const rowsFor = (path) => state.queries.get(pathKey(path)) || [];
  const googleLabel = () => ({not_checked:'GSC 동기화 전', not_configured:'GSC 연결 미설정', error:'GSC 확인 실패', connected:'GSC 검색어 없음'}[state.source]);
  const filtered = () => (state.data?.assets || []).filter((asset) => {
    const text = (asset.targetPath + ' ' + asset.primaryIntent).toLocaleLowerCase('ko-KR');
    return (state.segment === 'all' || asset.sitemapSegment === state.segment) && text.includes(state.filter.toLocaleLowerCase('ko-KR'));
  });
  function render() {
    const rows = filtered();
    $('rows').innerHTML = rows.length ? rows.map((asset) => {
      const live = liveFor(asset.targetPath), verified = rowsFor(asset.targetPath);
      const indexStatus = live?.indexStatus || (isMaster() ? '색인 미확인' : '로그인 후 확인');
      return '<tr><td><span class="tag ' + (verified.length ? '' : 'amber') + '">' + (verified.length ? 'GSC URL 매핑' : '후보 매핑') + '</span></td><td><div class="path" title="' + esc(asset.targetPath) + '">' + esc(asset.targetPath) + '</div><small class="muted">' + esc(asset.primaryIntent) + '</small></td><td>' + esc(asset.sitemapSegmentLabel || asset.sitemapSegment) + '</td><td class="slots">80 후보 슬롯<br><small>' + (state.source === 'connected' ? fmt(verified.length) + '개 실제 검색어' : '실제 검색어 미확인') + '</small></td><td><span class="tag ' + (live?.indexStatus ? '' : 'amber') + '">' + esc(indexStatus) + '</span><br><small class="muted">' + (verified.length ? 'GSC 노출 데이터 있음' : googleLabel()) + '</small></td><td><button class="secondary open" data-path="' + esc(encodeURIComponent(asset.targetPath)) + '">K01~K80 열기</button></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">조건에 맞는 자산이 없습니다.</td></tr>';
  }
  function updateKpis() {
    const assets = state.data?.assets;
    $('assets').textContent = fmt(assets?.length);
    $('slots').textContent = fmt(assets ? assets.length * 80 : null);
    $('verified').textContent = fmt(assets && state.source === 'connected' ? assets.reduce((sum, asset) => sum + rowsFor(asset.targetPath).length, 0) : null);
    $('unverified').textContent = fmt(assets ? assets.filter((asset) => !liveFor(asset.targetPath)?.indexStatus).length : null);
  }
  async function loadCandidates() {
    syncPortalSession();
    $('reload').disabled = true;
    try {
      const response = await fetch('/api/keyword-candidates', {cache:'no-store'});
      const payload = await response.json();
      syncPortalSession();
      if (!response.ok || !Array.isArray(payload.assets) || !Array.isArray(payload.segments)) throw new Error(payload.error || '후보 자산을 불러오지 못했습니다.');
      state.data = payload;
      if (!payload.segments.some((item) => item.segment === state.segment)) state.segment = 'all';
      $('segment').innerHTML = '<option value="all">모든 사이트맵 구간</option>' + payload.segments.map((item) => '<option value="' + esc(item.segment) + '">' + esc(item.label) + ' (' + fmt(item.total) + ')</option>').join('');
      $('segment').value = state.segment;
      $('provenance').textContent = (payload.sourceMessage || '후보는 Google 실시간 성과가 아닙니다.') + (payload.referenceIndexGeneratedAt ? ' 목록 대조 기준: ' + payload.referenceIndexGeneratedAt + ' (응답 생성 시각과 별개).' : '');
      updateKpis(); render();
      message(fmt(payload.assets.length * 80) + '개 후보 슬롯을 불러왔습니다. Google 상태는 관리자 인증 후 동기화 버튼으로 확인합니다.');
    } catch (error) {
      syncPortalSession();
      message(error.message || '후보 자산을 불러오지 못했습니다.', true);
      if (!state.data) $('rows').innerHTML = '<tr><td colspan="6" class="empty">후보를 불러오지 못했습니다. 후보 새로고침으로 다시 시도해주세요.</td></tr>';
    }
    finally { $('reload').disabled = false; }
  }
  function groupQueries(rows) {
    const byPath = new Map();
    for (const row of rows) {
      const path = pathKey(row.page), query = String(row.query || '').trim();
      if (!path || !query) continue;
      if (!byPath.has(path)) byPath.set(path, new Map());
      const queries = byPath.get(path), key = query.toLocaleLowerCase('ko-KR');
      const item = queries.get(key) || {query, clicks:0, impressions:0, positionTotal:0, positionWeight:0};
      const impressions = Math.max(0, Number(row.impressions) || 0);
      item.clicks += Math.max(0, Number(row.clicks) || 0); item.impressions += impressions;
      if (Number(row.position) > 0) { item.positionTotal += Number(row.position) * impressions; item.positionWeight += impressions; }
      queries.set(key, item);
    }
    return new Map([...byPath].map(([path, queries]) => [path, [...queries.values()].map((row) => ({...row, position:row.positionWeight ? row.positionTotal / row.positionWeight : null}))]));
  }
  function closeDetail() {
    state.detailVersion++;
    $('modal').close(); $('modal').innerHTML = '';
  }
  async function loadLive() {
    const session = syncPortalSession();
    if (!session || !isMaster() || state.liveRequest) return;
    const version = state.authVersion, controller = new AbortController();
    state.liveRequest = controller; $('login').disabled = true;
    state.live.clear(); state.queries.clear(); state.source = 'not_checked';
    closeDetail(); updateKpis(); render();
    message('Search Console 실제 URL별 검색어를 동기화하는 중입니다.');
    try {
      const options = {cache:'no-store', signal:controller.signal, headers:{authorization:'Bearer ' + session.idToken}};
      const [assetResponse, exposureResponse] = await Promise.all([fetch('/api/master/search-assets?candidateView=1', options), fetch('/api/master/exposure?days=90', options)]);
      const [assetPayload, exposurePayload] = await Promise.all([assetResponse.json(), exposureResponse.json()]);
      syncPortalSession();
      if (version !== state.authVersion) return;
      if (!assetResponse.ok || !Array.isArray(assetPayload.assets)) throw new Error(assetPayload.error || 'URL 자산 상태를 불러오지 못했습니다.');
      if (!exposureResponse.ok) throw new Error(exposurePayload.error || 'Search Console 동기화에 실패했습니다.');
      state.live = new Map(assetPayload.assets.map((asset) => [pathKey(asset.targetPath), asset]));
      const source = exposurePayload.sources?.searchConsole;
      state.source = ['connected', 'not_configured', 'error'].includes(source) ? source : 'error';
      if (state.source === 'connected') {
        if (!Array.isArray(exposurePayload.rows)) throw new Error('Search Console 응답 형식을 확인하지 못했습니다.');
        state.queries = groupQueries(exposurePayload.rows);
      }
      const count = [...state.queries.values()].reduce((sum, rows) => sum + rows.length, 0);
      const status = state.source === 'connected' ? count ? '실제 GSC URL·검색어 ' + fmt(count) + '개를 확인했습니다.' : 'GSC 연결은 확인되었지만 조회 기간의 URL별 검색어가 없습니다.' : exposurePayload.sources?.searchConsoleMessage || googleLabel();
      message(status + ' ' + (assetPayload.sourceMessage || '색인 여부는 별도 확인이 필요합니다.'), state.source !== 'connected' || !count);
    } catch (error) {
      syncPortalSession();
      if (version !== state.authVersion) return;
      state.live.clear(); state.queries.clear(); state.source = 'error';
      message(error.message || 'Google 상태를 동기화하지 못했습니다.', true);
    } finally {
      syncPortalSession();
      if (version === state.authVersion) { state.liveRequest = null; $('login').disabled = false; updateKpis(); render(); }
    }
  }
  async function openAsset(path) {
    syncPortalSession();
    const version = ++state.detailVersion;
    message(path + ' 상세 슬롯을 불러오는 중입니다.');
    try {
      const response = await fetch('/api/keyword-candidates?path=' + encodeURIComponent(path), {cache:'no-store'});
      const payload = await response.json();
      syncPortalSession();
      if (version !== state.detailVersion) return;
      if (!response.ok || !payload.asset || !Array.isArray(payload.asset.keywordSlots)) throw new Error(payload.error || '상세 정보를 불러오지 못했습니다.');
      const detail = payload.asset, verified = rowsFor(path);
      const byQuery = new Map(verified.map((row) => [row.query.toLocaleLowerCase('ko-KR'), row]));
      const verifiedHtml = verified.length ? '<h3>Google이 실제로 확인한 검색어</h3><div class="slot-grid">' + verified.map((row) => '<div class="slot"><b>GSC</b>' + esc(row.query) + '<br><small>' + fmt(row.impressions) + ' 노출 · ' + fmt(row.clicks) + ' 클릭 · 평균순위 ' + esc(row.position == null ? '-' : row.position.toFixed(1)) + '</small></div>').join('') + '</div>' : '<p class="notice warn">' + (state.source === 'connected' ? '조회 기간에 이 URL의 Search Console 검색어가 없습니다.' : '이 URL의 Search Console 검색어는 아직 확인되지 않았습니다.') + ' 아래 목록은 검증 전 후보입니다.</p>';
      $('modal').innerHTML = '<section class="panel"><div class="panel-head"><div><div class="eyebrow">URL KEYWORD MAPPING</div><h2 id="detail-title">' + esc(detail.targetPath) + '</h2><p class="muted">후보 ' + fmt(detail.keywordSlots.length) + '개 슬롯 · GSC 실제 검색어 ' + (state.source === 'connected' ? fmt(verified.length) + '개' : '미확인') + ' · ' + esc(liveFor(path)?.indexStatus || '색인 미확인') + '</p></div><button class="close" id="close" autofocus>닫기</button></div><p class="notice warn">' + esc(payload.sourceMessage || '검증 전 후보입니다.') + '</p><div class="slot-grid">' + detail.keywordSlots.map((slot) => { const row = byQuery.get(String(slot.query || '').toLocaleLowerCase('ko-KR')); return '<div class="slot"><b>' + esc(slot.slot) + '</b>' + esc(slot.query || '(빈 슬롯)') + '<br><small>' + esc(slot.clusterLabel || '후보') + ' · ' + (row ? 'VERIFIED_GSC · ' + fmt(row.impressions) + ' 노출' : 'CANDIDATE') + '</small></div>'; }).join('') + '</div>' + verifiedHtml + '</section>';
      $('close').onclick = closeDetail;
      if (!$('modal').open) $('modal').showModal();
      message('URL별 후보를 열었습니다. 검증 표시는 실제 GSC 응답에만 적용됩니다.');
    } catch (error) { syncPortalSession(); if (version === state.detailVersion) message(error.message || '상세 정보를 불러오지 못했습니다.', true); }
  }
  // The portal REST session is the only credential source. Never restore an SDK session
  // or refresh/write credentials here: a delayed refresh must not resurrect a logout.
  function readPortalSession() {
    if (!state.active) return null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null');
      if (!saved || typeof saved.idToken !== 'string' || saved.idToken.length > 4096 || typeof saved.user?.id !== 'string' || typeof saved.user?.email !== 'string') return null;
      const encoded = saved.idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(encoded.padEnd(encoded.length + (4 - encoded.length % 4) % 4, '=')));
      const expiresAt = claims.exp * 1000;
      if (typeof claims.exp !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || (claims.sub || claims.user_id) !== saved.user.id) return null;
      // Claims only gate the UI; requireMasterUser still verifies the bearer server-side.
      return {idToken:saved.idToken, user:{id:saved.user.id, email:saved.user.email}, expiresAt};
    } catch { return null; }
  }
  function applyPortalSession(session) {
    state.authVersion++; state.liveRequest?.abort(); state.liveRequest = null;
    state.user = session?.user || null; state.sessionToken = session?.idToken || '';
    state.live.clear(); state.queries.clear(); state.source = 'not_checked';
    window.clearTimeout(sessionExpiryTimer);
    if (session) sessionExpiryTimer = window.setTimeout(syncPortalSession, Math.min(session.expiresAt - Date.now() + 1, 2147483647));
    closeDetail(); updateKpis(); render();
    $('login').disabled = false;
    $('login').textContent = isMaster() ? 'Google 상태 동기화' : state.user ? '포털 계정 관리' : '포털 Google 로그인';
    message(isMaster() ? '포털 관리자 세션을 사용합니다. 동기화 시 실제 권한을 서버에서 확인합니다.' : state.user ? '포털에서 관리자 계정으로 로그인해야 Google 상태를 확인할 수 있습니다.' : '포털 로그인 세션이 없거나 만료되었습니다. 공개 후보는 계속 조회할 수 있습니다.', !isMaster());
  }
  function syncPortalSession() {
    const session = readPortalSession();
    if ((session?.idToken || '') !== state.sessionToken || session?.user.id !== state.user?.id || session?.user.email !== state.user?.email) applyPortalSession(session);
    return session;
  }
  $('login').onclick = () => {
    syncPortalSession();
    if (isMaster()) return loadLive();
    window.open('/login', '_blank', 'noopener,noreferrer');
    message('포털 로그인 창에서 로그인하거나 계정을 변경한 뒤 이 화면으로 돌아와 동기화해주세요. 로그인 창이 열리지 않으면 포털의 /login 페이지를 이용해주세요.', true);
  };
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== SESSION_KEY) return;
    try { if (event.storageArea !== window.localStorage) return; }
    catch { applyPortalSession(null); return; }
    if (event.key === null || event.newValue === null) applyPortalSession(null);
    else syncPortalSession();
  });
  window.addEventListener('focus', syncPortalSession);
  window.addEventListener('pagehide', () => { state.active = false; applyPortalSession(null); });
  window.addEventListener('pageshow', () => { state.active = true; syncPortalSession(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncPortalSession(); });
  $('rows').onclick = (event) => { const button = event.target.closest('button[data-path]'); if (button) void openAsset(decodeURIComponent(button.dataset.path)); };
  $('modal').addEventListener('cancel', (event) => { event.preventDefault(); closeDetail(); });
  $('reload').onclick = loadCandidates;
  $('filter').oninput = (event) => { syncPortalSession(); state.filter = event.target.value; render(); };
  $('segment').onchange = (event) => { syncPortalSession(); state.segment = event.target.value; render(); };
  $('clear').onclick = () => { syncPortalSession(); $('filter').value = ''; $('segment').value = 'all'; state.filter = ''; state.segment = 'all'; render(); };
  applyPortalSession(readPortalSession());
  void loadCandidates();
</script>
</body>
</html>`;
