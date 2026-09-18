import AdSenseSlot, { adsenseClientId } from './AdSense';

export default function BannerAd({ type = 'horizontal' }: { type?: 'horizontal' | 'vertical' | 'square' }) {
  const slot = type === 'horizontal'
    ? process.env.NEXT_PUBLIC_ADSENSE_SLOT_HORIZONTAL
    : type === 'vertical'
      ? process.env.NEXT_PUBLIC_ADSENSE_SLOT_VERTICAL
      : process.env.NEXT_PUBLIC_ADSENSE_SLOT_SQUARE;
  if (slot && adsenseClientId) return <AdSenseSlot slot={slot} format={type === 'square' ? 'rectangle' : 'auto'} />;
  if (!adsenseClientId) return null;
  return <div className="min-h-[90px] w-full overflow-hidden" data-adsense-auto-container="true" aria-label="광고" />;
}
