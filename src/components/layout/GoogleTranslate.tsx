'use client';

import { useEffect, useRef } from 'react';

type GoogleTranslateConstructor = new (options: { pageLanguage: string; includedLanguages: string; autoDisplay: boolean }, elementId: string) => unknown;
type GoogleWindow = Window & { google?: { translate?: { TranslateElement?: GoogleTranslateConstructor } }; googleTranslateElementInit?: () => void };

function triggerTranslation(language: 'ko' | 'en') {
  const select = document.querySelector<HTMLSelectElement>('.goog-te-combo');
  if (!select) return false;
  select.value = language === 'en' ? 'en' : '';
  select.dispatchEvent(new Event('change'));
  return true;
}

function clearAutomaticTranslation() {
  if (typeof document === 'undefined') return;
  document.cookie = 'googtrans=; Max-Age=0; path=/';
  document.cookie = `googtrans=; Max-Age=0; path=/; domain=${window.location.hostname}`;
  document.documentElement.classList.remove('translated-ltr', 'translated-rtl');
  document.body.classList.remove('translated-ltr', 'translated-rtl');
  document.body.style.top = '0';
}

function triggerWhenReady(language: 'ko' | 'en') {
  let attempts = 0;
  const attempt = () => {
    attempts += 1;
    if (triggerTranslation(language) || attempts >= 20) return;
    window.setTimeout(attempt, 250);
  };
  attempt();
}

export default function GoogleTranslate() {
  const initializedRef = useRef(false);

  useEffect(() => {
    const googleWindow = window as GoogleWindow;
    const initialize = () => {
      const TranslateElement = googleWindow.google?.translate?.TranslateElement;
      if (!TranslateElement) return;
      const root = document.getElementById('google_translate_element');
      if (root && !root.dataset.ready && !initializedRef.current) {
        new TranslateElement({ pageLanguage: 'ko', includedLanguages: 'en,ko', autoDisplay: false }, 'google_translate_element');
        root.dataset.ready = '1';
        initializedRef.current = true;
      }
    };

    if (!window.localStorage.getItem('gyopo-language')) clearAutomaticTranslation();
    googleWindow.googleTranslateElementInit = initialize;
    if (!document.querySelector('script[data-google-translate]')) {
      const script = document.createElement('script');
      script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      script.async = true;
      script.dataset.googleTranslate = '1';
      document.head.appendChild(script);
    } else {
      initialize();
    }
    return () => {
      if (googleWindow.googleTranslateElementInit === initialize) delete googleWindow.googleTranslateElementInit;
    };
  }, []);

  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const next = (event as CustomEvent<{ language?: 'ko' | 'en' }>).detail?.language;
      if (!next) return;
      if (next === 'ko') clearAutomaticTranslation();
      triggerWhenReady(next);
    };
    window.addEventListener('gyopo-language-change', handleLanguageChange);
    document.body.classList.add('gyopo-translation-controlled');
    return () => {
      window.removeEventListener('gyopo-language-change', handleLanguageChange);
      document.body.classList.remove('gyopo-translation-controlled');
    };
  }, []);

  return <div id="google_translate_element" className="google-translate-root" aria-hidden="true" />;
}
