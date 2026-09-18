'use client';

import { ChevronLeft, ChevronRight, Images } from 'lucide-react';
import { useState } from 'react';

type ImageCarouselProps = {
  images?: string[];
  alt: string;
  className?: string;
  emptyLabel?: string;
};

export default function ImageCarousel({ images = [], alt, className = '', emptyLabel = '등록된 사진이 없습니다.' }: ImageCarouselProps) {
  const uniqueImages = images.filter((image, index) => Boolean(image) && images.indexOf(image) === index).slice(0, 12);
  const signature = uniqueImages.join('\n');
  const [position, setPosition] = useState({ signature, index: 0 });
  const index = position.signature === signature ? position.index % (uniqueImages.length || 1) : 0;
  const current = uniqueImages[index];

  if (!current) return <div className={`grid min-h-40 place-items-center bg-white/[.04] text-sm text-slate-500 ${className}`}><span className="inline-flex items-center gap-2"><Images size={16} />{emptyLabel}</span></div>;

  const move = (step: number) => setPosition({ signature, index: (index + step + uniqueImages.length) % uniqueImages.length });

  return (
    <div role="region" aria-roledescription="carousel" aria-label={alt} tabIndex={uniqueImages.length > 1 ? 0 : undefined} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }} className={`relative overflow-hidden bg-black/30 ${className}`}>
      <img src={current} alt={`${alt} (${index + 1}/${uniqueImages.length})`} className="h-full w-full object-cover" />
      {uniqueImages.length > 1 && <>
        <button type="button" aria-label="이전 사진" onClick={() => move(-1)} className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80"><ChevronLeft size={18} /></button>
        <button type="button" aria-label="다음 사진" onClick={() => move(1)} className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80"><ChevronRight size={18} /></button>
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/55 px-2.5 py-1.5">
          <span aria-live="polite" className="sr-only">{index + 1} / {uniqueImages.length}</span>
          {uniqueImages.map((image, dotIndex) => <button key={image} type="button" aria-label={`${dotIndex + 1}번째 사진`} aria-pressed={dotIndex === index} onClick={() => setPosition({ signature, index: dotIndex })} className={`h-3 w-3 rounded-full ${dotIndex === index ? 'bg-cyan-300' : 'bg-white/50'}`} />)}
        </div>
      </>}
    </div>
  );
}
