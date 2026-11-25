import type { IconName } from "./data/types";

const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const svg = (body: string, attrs = S): string => `<svg viewBox="0 0 24 24" ${attrs} aria-hidden="true">${body}</svg>`;

/** Ícone de cada situação, no traço fino da identidade JMD. */
const PACK: Record<IconName, string> = {
  coffee: `<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 2.5v2.5M12 2.5v2.5"/>`,
  people: `<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.8-3.3 3.2-5 6-5s5.2 1.7 6 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16.5 14.2c2.3.2 3.9 1.7 4.5 4.3"/>`,
  briefcase: `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>`,
  sparkle: `<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>`,
  food: `<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>`,
  phone: `<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>`,
  heart: `<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>`,
  question: `<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.9-.9 1.6V14M12 17.5v.2"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>`,
  thumb: `<path d="M7 11v9H4v-9z"/><path d="M7 11l4-8a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/>`,
  pin: `<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>`,
  door: `<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18"/><path d="M14.5 12v.2"/>`,
  cart: `<path d="M3 4h2.5l2.2 11h10.6L20.5 7H7"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>`,
  home: `<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>`,
  car: `<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3h-3v-1H6v1H3z"/><path d="M5 11h14"/><circle cx="7.5" cy="13.5" r=".6"/><circle cx="16.5" cy="13.5" r=".6"/>`,
  dumbbell: `<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>`,
  health: `<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>`,
  money: `<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>`,
  music: `<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>`,
  plane: `<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M10 13l4.5-4.5"/>`,
  film: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>`,
  book: `<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>`,
  party: `<path d="M4 20l4.5-12 7.5 7.5z"/><path d="M14 4v2M19 9h2M17.5 5.5L16 7M12.5 9.5c1-1.5 2.5-2 4-1.5"/>`,
  cloud: `<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>`,
  gamepad: `<path d="M6 8h12a4 4 0 0 1 4 4v1a3.5 3.5 0 0 1-6.3 2.1L15 14H9l-.7 1.1A3.5 3.5 0 0 1 2 13v-1a4 4 0 0 1 4-4z"/><path d="M7 10.5v3M5.5 12h3M16 11h.01M18 13h.01"/>`,
};

export const packIcon = (name: IconName): string => svg(PACK[name]);

export const ui = {
  play: svg(
    `<path d="M3.5 9v6h4l5 4.5v-15L7.5 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
    'fill="currentColor"',
  ),
  slow: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`),
  tip: svg(`<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>`),
  tick: svg(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`, 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'),
  x: svg(`<path d="M7 7l10 10M17 7L7 17"/>`, 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
  back: svg(`<path d="M19 12H5M11 6l-6 6 6 6"/>`),
  mic: svg(`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>`),
  music: svg(`<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>`),
  ear: svg(`<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0"/><path d="M10 9a2 2 0 0 1 4 0"/>`),
  flip: svg(`<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>`),
  download: svg(`<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>`),
  lock: svg(`<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>`),
  chart: svg(`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`),
  share: svg(`<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>`),
};
