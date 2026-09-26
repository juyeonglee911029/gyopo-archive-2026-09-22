'use client';

export default function ReleaseRouteStyles({ page }: { page: 'home' | 'games' }) {
  const file = page === 'home' ? '2a6ljh5jdhtlj.css' : '2haazg539gb52.css';

  // onLoad opts out of React resource hoisting: this link unmounts with its route.
  return <link rel="stylesheet" href={`/styles/release-aa09/${file}`} data-aa09-route={page} onLoad={() => {}} />;
}
