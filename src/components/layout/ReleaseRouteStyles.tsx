'use client';

export default function ReleaseRouteStyles({ page }: { page: 'games' }) {
  const file = '2haazg539gb52.css';

  // onLoad opts out of React resource hoisting: this link unmounts with its route.
  return <link rel="stylesheet" href={`/styles/release-aa09/${file}`} data-aa09-route={page} onLoad={() => {}} />;
}
