const paths = {
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  prev: 'M6 5h2v14H6zM19 5v14L9 12z',
  next: 'M16 5h2v14h-2zM5 5v14l10-7z',
  first: 'M5 5h2v14H5zM13 5v14l-5-7zM20 5v14l-5-7z',
  last: 'M17 5h2v14h-2zM11 5v14l5-7zM4 5v14l5-7z',
  share: 'M16 5l-1.4 1.4 1.6 1.6H11a6 6 0 0 0-6 6v3h2v-3a4 4 0 0 1 4-4h5.2l-1.6 1.6L16 13l4-4z',
  image: 'M4 5h16v14H4zm2 2v8.6l3.5-3.6 2.5 2.5 3.5-4.5L18 13V7z',
  download: 'M11 4h2v8.2l2.6-2.6L17 11l-5 5-5-5 1.4-1.4 2.6 2.6zM5 18h14v2H5z',
  upload: 'M11 20h2v-8.2l2.6 2.6L17 13l-5-5-5 5 1.4 1.4 2.6-2.6zM5 4h14v2H5z',
  keyboard: 'M3 6h18v12H3zm2 2v2h2V8zm3 0v2h2V8zm3 0v2h2V8zm3 0v2h2V8zm3 0v2h2V8zM5 11v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2zM7 14v2h10v-2z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  x: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm3 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-4 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-4 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  search: 'M10 4a6 6 0 0 1 4.9 9.5l4.6 4.6-1.4 1.4-4.6-4.6A6 6 0 1 1 10 4zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d={paths[name]} fill="currentColor" />
    </svg>
  );
}
