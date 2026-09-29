import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const core = [
  '3m0y9asyu_o2b.css',
  '0obc4wf2u8iey.css',
  '3p_9c1a7v-yp3.css',
  '38nmym_0ssd2g.css',
];
// These are hashes of copied served artifacts, not reconstructed source CSS.
const hashes = {
  '3m0y9asyu_o2b.css': '67d83efb2fe999ff9357bdffa5afc91a3229c99000e1e057abb9a998d6ecec25',
  '0obc4wf2u8iey.css': '20225cb0e50233b510024bbec6c73dc11b14d098a728f77845b426308d044be1',
  '3p_9c1a7v-yp3.css': 'a26da043be880ef166a6fcb3c7e3661bddee3c66aee83affe20dbd4c1821216d',
  '38nmym_0ssd2g.css': 'd5ee9609d0bb4551ead527bade769f0eb38a790681b356248928bf22155e9f37',
  '2a6ljh5jdhtlj.css': '7b8289eef8de73aa5d508f1d31cb13d61df4349abfd2cb7692e3f326fb89c647',
  '2haazg539gb52.css': '872702a3ba8897f038f6a03c6d6963598ecce075a68ef293d611a93c0e7ec759',
};

test('all six served stylesheets remain byte-identical and self-contained', () => {
  for (const [file, expected] of Object.entries(hashes)) {
    const css = readFileSync(join(root, 'public/styles/release-aa09', file));
    assert.equal(createHash('sha256').update(css).digest('hex'), expected, file);
    assert.doesNotMatch(css.toString(), /@import\b|@font-face\b|url\s*\(/i, file);
  }
});

test('root head owns exactly four core links in selected order', () => {
  const layout = read('src/app/layout.tsx');
  const head = layout.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  assert.ok(head, 'explicit root head');
  const links = [...head.matchAll(/<link\s+rel="stylesheet"\s+href="\/styles\/release-aa09\/([^"/]+)"\s*\/>/g)];
  assert.deepEqual(links.map((match) => match[1]), core);
  assert.equal((head.match(/<link\b/g) || []).length, 4);
  assert.match(layout, /@media \(max-width: 767px\)[\s\S]*?\.global-header-wrap[\s\S]*?background: #070e1a !important;/);
  assert.doesNotMatch(layout, /2a6ljh5jdhtlj|2haazg539gb52/);
});

test('page styles are route-owned, not persistent React stylesheet resources', () => {
  const component = read('src/components/layout/ReleaseRouteStyles.tsx');
  assert.match(component, /^'use client';/);
  assert.match(component, /const file = '2haazg539gb52\.css'/);
  assert.match(component, /<link\s+rel="stylesheet"/);
  assert.match(component, /styles\/tetris-refinements\.css/);
  assert.match(component, /onLoad=\{\(\) => \{\}\}/);
  assert.doesNotMatch(component, /\bprecedence=|createPortal|document\.head|useEffect/);
  assert.match(read('src/app/page.tsx'), /import styles from '\.\/home\.module\.css'/);
  assert.doesNotMatch(read('src/app/page.tsx'), /ReleaseRouteStyles|home-refresh/);
  assert.match(read('src/app/games/layout.tsx'), /<ReleaseRouteStyles page="games"\s*\/>/);
  assert.match(read('src/app/apps/tetris/page.tsx'), /<ReleaseRouteStyles page="games"\s*\/>/);
  assert.doesNotMatch(read('src/components/layout/GlobalAppShell.tsx'), /ReleaseRouteStyles/);
});

test('homepage panels use translucent backgrounds', () => {
  const home = read('src/app/home.module.css');
  for (const name of ['intro', 'region', 'quickLinks', 'categories', 'feed', 'connect']) {
    const block = home.match(new RegExp(`\\.${name} \\{([^}]*)\\}`))?.[1];
    assert.ok(block, `${name} panel exists`);
    assert.match(block, /#[\da-f]{8}/i, `${name} panel has an alpha color`);
  }
  assert.match(home, /\.search \{[^}]*background: #[\da-f]{8}/i);
  assert.match(home, /\.regionSelect select \{[^}]*background: #[\da-f]{8}/i);
});

test('superseded global CSS and Tailwind entry imports cannot return', () => {
  const banned = /(?:globals(?:final|fix)?|design-system|music-popover|route-experience|call-ui|home-refresh|game-workspace)\.css$/;
  const files = readdirSync(join(root, 'src'), { recursive: true });
  for (const file of files.filter((path) => /\.(?:tsx?|jsx?|mjs|cjs|css)$/.test(path))) {
    const source = read(join('src', file));
    for (const match of source.matchAll(/(?:\bimport\s+(?:[^;'"\n]*?\s+from\s*)?|\brequire\s*\(|@import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(!banned.test(match[1]), `${file}: competing import ${match[1]}`);
      assert.notEqual(match[1], 'tailwindcss', `${file}: regenerates frozen utilities`);
      assert.ok(!match[1].includes('Header.legacy'), `${file}: obsolete header entry`);
    }
  }
});

test('selected CSS retains the 128px sidebar and 80px flex-header contract', () => {
  const shell = read('public/styles/release-aa09/0obc4wf2u8iey.css');
  const routes = read('public/styles/release-aa09/38nmym_0ssd2g.css');
  assert.match(shell, /--sidebar-width:128px[;}]/);
  assert.match(shell, /\.global-header-wrap \.site-header-inner\{[^}]*display:flex/);
  assert.match(shell, /\.global-header-wrap \.site-header-inner\{[^}]*flex-direction:row[^}]*min-height:80px/);
  assert.match(shell, /\.global-header-secondary\{[^}]*display:flex/);
  assert.match(routes, /@media \(min-width:769px\)/);
  assert.match(routes, /@media \(max-width:768px\)/);
});

test('shared markup delegates geometry to the selected stylesheet', () => {
  const shell = read('src/components/layout/GlobalAppShell.tsx');
  assert.doesNotMatch(shell, /250px|max-w-\[1600px\]|lg:block|lg:grid-cols/);
  assert.match(shell, /className="global-sidebar"/);
  assert.match(shell, /has-right-rail/);
  const header = read('src/components/layout/Header.tsx');
  assert.match(header, /className="global-header-secondary"/);
  assert.match(header, /<MusicPlayer embedded\s*\/>/);
  assert.match(header, /ResizeObserver/);
  assert.doesNotMatch(header, /MessageCircle|PhoneCall|gyopo-friends-open/);
  assert.match(read('src/components/layout/MobileDrawer.tsx'), /min-width: 769px/);
});

test('sidebar friends action keeps guest navigation and opens a left-aligned dock', () => {
  const sidebar = read('src/components/layout/GlobalSidebar.tsx');
  assert.match(sidebar, /className="global-friends-link"/);
  assert.match(sidebar, /style=\{\{ borderRadius: 0 \}\}/);
  assert.match(sidebar, /if \(!user\)\s*\{[\s\S]*?router\.push\('\/users'\)/);
  assert.match(sidebar, /window\.dispatchEvent\(new CustomEvent\('gyopo-friends-open'/);
  assert.match(sidebar, /top: rect\.top/);
  assert.match(sidebar, /bottom: rect\.bottom/);
  assert.match(sidebar, /onNavigate\?\.\(\)/);

  const dock = read('src/components/layout/FriendDock.tsx');
  assert.match(dock, /Link href="\/users"[\s\S]*?친구 찾기/);
  assert.match(dock, /회원 목록에서 친구 찾기/);
  assert.match(dock, /new ResizeObserver\(updatePosition\)/);
  assert.match(dock, /anchor\.top - rect\.height - 8/);
  assert.match(dock, /left: 16,/);
  assert.match(dock, /lg:left-4 lg:right-auto lg:w-\[480px\]/);
  assert.match(dock, /maxHeight: 'calc\(100dvh - 16px\)'/);
  assert.match(dock, /listOnlineUsers/);
  assert.match(dock, /상태 확인 중/);
  assert.match(dock, /온라인/);
  assert.match(dock, /오프라인/);
  assert.match(dock, /friend-list max-h-40/);
  assert.match(dock, /friend-row-action/);
  assert.match(dock, /friend-message-bubble/);
  assert.match(dock, /friend-chat-thread h-48/);
  assert.match(dock, /friend-message-author/);
  assert.match(dock, /formatFriendMessageTime\(message\.createdAt\)/);
  assert.match(sidebar, /<span>\{language === 'ko' \? '친구·통화' : 'Friends & calls'\}<\/span>/);
  assert.doesNotMatch(dock, /friend-dock-launch-control|id="friend-dock-launch"/);
  assert.doesNotMatch(dock, /friends\.length\}명|friends\.length\} friends/);
  assert.doesNotMatch(dock, /<b className="block text-\[9px\] opacity-65">\{message\.user\}<\/b>/);

  const lounge = read('src/components/layout/GlobalChat.tsx');
  assert.match(lounge, /gyopo-open-global-chat/);
  assert.match(lounge, /if \(isCallRoute\) \{\s*setMobileOpen\(false\);\s*return;/);
  assert.match(lounge, /aria-label=\{language === 'ko' \? '라운지 닫기' : 'Close lounge'\}/);
  assert.match(lounge, /onDesktopOpenChange\(false\)/);
  assert.match(lounge, /onDesktopOpenChange\(true\)/);
  assert.match(lounge, /else onDesktopOpenChange\(true\)/);
  assert.match(lounge, /desktopToggleRef\.current\?\.focus\(\)/);
  assert.match(lounge, /<Minus size=\{16\} \/>/);
  assert.match(lounge, /<Plus size=\{18\} \/>/);
  assert.doesNotMatch(lounge, /global-mobile-lounge-launch/);
  assert.match(read('src/components/layout/MobileDrawer.tsx'), /!isCallRoute && <button[^\n]*gyopo-open-global-chat/);
  assert.match(lounge, /global-chat-line/);
  assert.match(lounge, /global-chat-author/);
  assert.match(lounge, /formatTime\(message\.createdAt\)/);
  assert.doesNotMatch(lounge, /memberCount|onlineCount|api\/online-count|global-lounge-launch-control|global-lounge-expand|desktopMaximized|gyopo-lounge-change/);
  const styles = read('src/app/experience-refinements.css');
  assert.match(styles, /\.global-app-shell\.has-lounge-open\s*>\s*\.global-page-body/);
  assert.match(styles, /--global-lounge-reserved-width/);
  assert.match(styles, /--global-lounge-reserved-width: min\(18rem/);
  assert.match(styles, /--category-glass: rgba\(8, 14, 27, 0\.45\)/);
  assert.match(styles, /@media \(min-width: 1024px\)\s*\{[\s\S]*?--global-lounge-reserved-width/);
  assert.match(styles, /\.global-lounge\[data-minimized="true"\][\s\S]*?width: 44px !important;/);
  assert.match(styles, /\.global-lounge\s*\{[^}]*background: rgba\(12, 20, 35, 0\.12\) !important;[^}]*backdrop-filter: none !important;/s);
  assert.match(styles, /\.global-lounge-header,[\s\S]*?background: rgba\(12, 20, 35, 0\.78\) !important;/);
  assert.match(styles, /\.global-public-docks #global-lounge\.global-lounge:not\(\[data-minimized="true"\]\)\s*\{[^}]*background: rgba\(12, 20, 35, 0\.12\) !important;[^}]*background-image: none !important;/s);
  assert.match(styles, /\.global-public-docks #global-lounge\.global-lounge\[data-minimized="true"\]\s*\{[^}]*background: transparent !important;[^}]*background-image: none !important;/s);
  assert.match(styles, /\.global-public-docks #global-lounge\.global-lounge \.global-lounge-header,[\s\S]*?\.global-public-docks #global-lounge\.global-lounge \.global-lounge-composer\s*\{[^}]*background: rgba\(12, 20, 35, 0\.78\) !important;[^}]*background-image: none !important;/s);
  assert.match(styles, /\.global-lounge \.global-chat-message-bubble\s*\{[^}]*background: rgba\(8, 14, 27, 0\.78\) !important;/s);
  assert.match(styles, /\.global-lounge \.global-chat-time\s*\{\s*color: #cbd5e1;/);
  assert.match(styles, /@media \(max-width: 1023px\)\s*\{[\s\S]*?\.global-mobile-lounge-panel\s*\{/);
  assert.match(styles, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.global-mobile-lounge-panel\s*\{[^}]*bottom:\s*calc\(var\(--bottom-nav-height,\s*68px\)\s*\+/);
  assert.match(styles, /\.global-chat-message-bubble\s*\{[^}]*border: 0 !important;[^}]*background: transparent !important;/);
  assert.match(styles, /\.global-sidebar \.global-friends-link:hover\s*\{[^}]*border-color: transparent !important;/);
  assert.match(styles, /\.gyopo-friend-dock\s*\{[^}]*border-radius: 0 !important;/);
  assert.doesNotMatch(styles, /margin-right:\s*58px/);
});

test('friend calls auto-start after acceptance while screen sharing keeps its native action', () => {
  const dock = read('src/components/layout/FriendDock.tsx');
  const call = read('src/app/webrtc/page.tsx');
  assert.match(dock, /&auto=1&videoOnly=0/);
  assert.match(dock, /allow="camera; microphone; display-capture; fullscreen; autoplay"/);
  assert.match(call, /params\.get\('auto'\) === '1'/);
  assert.match(call, /autoStartAttemptedRef\.current = true/);
  assert.match(call, /callKind !== 'friend'/);
  assert.match(call, /onClick=\{startMatchFromUi\}/);
  assert.match(call, /const retryRemotePlayback = async/);
  assert.match(call, /navigator\.mediaDevices\.getDisplayMedia/);
  const chooser = call.indexOf('display = await navigator.mediaDevices.getDisplayMedia');
  const leaseClaim = call.indexOf("await updateCallMediaLease(callId, ownerId, token, 'screen', Boolean(systemAudioTrack)");
  assert.ok(chooser >= 0 && leaseClaim > chooser, 'the native share picker opens before the server lease request');
  assert.match(call, /screenAudioTransceiverRef\.current = connection\.addTransceiver\('audio', \{ direction: 'sendrecv' \}\)/);
  assert.doesNotMatch(call, /createMediaStreamDestination|mixedAudioTrackRef/);
  assert.match(call, /stage\.requestFullscreen\(\)/);
  assert.match(call, /document\.exitFullscreen\(\)/);
  assert.match(call, /함께보기/);
  assert.match(call, /함께듣기/);
  assert.match(call, /sharedScreenVisible && <div className="webrtc-stage-shared-screen"/);
  assert.match(call, /webrtc-stage-camera-row/);
  assert.doesNotMatch(call, /webrtc-sidebar-screen/);
  assert.match(read('src/app/experience-refinements.css'), /\.webrtc-stage-camera-row\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.doesNotMatch(call, /<video ref=\{remoteVideoRef\}[^>]*autoPlay/);
  assert.doesNotMatch(call, /<video ref=\{sidebarVideoRef\}[^>]*autoPlay/);
  assert.match(dock, /allow="camera; microphone; display-capture; fullscreen; autoplay" allowFullScreen/);
});

test('public routes reserve space only while the lounge is expanded and the directory map opens its tab', () => {
  const shell = read('src/components/layout/GlobalAppShell.tsx');
  assert.match(shell, /const \[desktopLoungeOpen, setDesktopLoungeOpen\] = useState\(true\)/);
  assert.match(shell, /const hasGlobalChat = mode === 'public' && pathname !== '\/webrtc'/);
  assert.match(shell, /hasGlobalChat && desktopLoungeOpen \? ' has-lounge-open' : ''/);
  assert.match(shell, /<GlobalChat desktopOpen=\{desktopLoungeOpen\} onDesktopOpenChange=\{setDesktopLoungeOpen\}/);
  assert.doesNotMatch(shell, /has-lounge-maximized|setLoungeOpen|gyopo-lounge-change/);
  const directory = read('src/app/directory/page.tsx');
  assert.match(directory, /selectDirectory\(biz, 'map'\)/);
  assert.match(directory, /if \(cached\) \{\s*applyGooglePlace\(directory, cached\)/);
  assert.match(directory, /const verifiedLocation = \(directory: Directory\)/);
  const runtime = read('src/components/layout/AppRuntime.tsx');
  assert.match(runtime, /profileImageProcessing/);
  assert.match(runtime, /if \(profileImageProcessing\) \{\s*setProfileError\(/);
});

test('mobile AI search keeps recent questions and its safety notice available', () => {
  const assistant = read('src/app/assistant/page.tsx');
  const styles = read('src/app/experience-refinements.css');
  assert.match(assistant, /<details className="assistant-mobile-history hidden" aria-label="최근 질문">/);
  assert.match(assistant, /recentQueries\.map\(\(query\) => <li key=\{query\}>/);
  assert.match(assistant, /AI 답변은 참고용 정보입니다/);
  assert.match(styles, /\.assistant-page \.assistant-mobile-history\s*\{\s*display: block !important;/);
  assert.doesNotMatch(styles, /\.assistant-page form\[aria-label="GYOPO AI 질문 보내기"\] \+ p\s*\{\s*display: none/);
});
