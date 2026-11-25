import { useEffect, useState } from 'react';
import type { ThemePreference } from '../types/viewer';

export function useTheme(preference: ThemePreference): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' =
    preference === 'dark' ? 'dark' : preference === 'light' ? 'light' : systemDark ? 'dark' : 'light';

  useEffect(() => {
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('docviewer-theme-cache', preference);
    } catch {
      // Ignore storage failures
    }
  }, [preference, resolved]);

  return resolved;
}
