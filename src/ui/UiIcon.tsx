type IconName = 'data' | 'source' | 'clock' | 'weather' | 'forecast' | 'settings' | 'search' | 'upload' | 'check' | 'close' | 'plus' | 'publish' | 'pin' | 'new' | 'open' | 'save' | 'mobile' | 'qr' | 'report' | 'cloud' | 'cargo' | 'info' | 'feedback' | 'chevronDown' | 'ruler';
type Props = Readonly<{ name: IconName; className?: string }>;

const paths: Record<IconName, string> = {
  data: 'M5 5c0-2 3-3 7-3s7 1 7 3-3 3-7 3-7-1-7-3Zm0 0v6c0 2 3 3 7 3s7-1 7-3V5m-14 6v6c0 2 3 3 7 3s7-1 7-3v-6',
  source: 'M4 7 12 3l8 4-8 4-8-4Zm0 0v9l8 5 8-5V7m-8 4v10',
  clock: 'M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm0 4v6l4 2',
  weather: 'M7 18h11a4 4 0 0 0 0-8 7 7 0 0 0-13-1A4.5 4.5 0 0 0 7 18Z',
  forecast: 'M12 3a9 9 0 1 0 9 9m-9-5v5l3 2m6-11v5h-5',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm7.4 3.5a7.5 7.5 0 0 0-.12-1.33l2.02-1.57-2-3.46-2.46 1a8 8 0 0 0-2.3-1.33L14.2 2.7h-4l-.36 2.61a8 8 0 0 0-2.3 1.33l-2.46-1-2 3.46 2.02 1.57A7.5 7.5 0 0 0 4.98 12c0 .45.04.9.12 1.33L3.08 14.9l2 3.46 2.46-1a8 8 0 0 0 2.3 1.33l.36 2.61h4l.36-2.61a8 8 0 0 0 2.3-1.33l2.46 1 2-3.46-2.02-1.57c.08-.43.12-.88.12-1.33Z',
  search: 'm20 20-4.4-4.4m2.4-5.1a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5',
  check: 'm4 12 5 5L20 6',
  close: 'M5 5l14 14M19 5 5 19',
  plus: 'M12 5v14M5 12h14',
  publish: 'M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7',
  pin: 'M12 22s7-7 7-13a7 7 0 1 0-14 0c0 6 7 13 7 13Zm0-10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z',
  new: 'M5 8V3l3 3a8 8 0 1 1-2.2 10.9M5 3v5h5',
  open: 'M3 19V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 19l3-9h16l-3 9H3Z',
  save: 'M4 3h13l3 3v15H4V3Zm4 0v6h8V3M8 21v-7h8v7',
  mobile: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm1 3h6m-4 14h2',
  qr: 'M3 3h7v7H3V3Zm2 2v3h3V5H5Zm9-2h7v7h-7V3Zm2 2v3h3V5h-3ZM3 14h7v7H3v-7Zm2 2v3h3v-3H5Zm9-2h3v3h-3v-3Zm4 0h3v3h-3v-3Zm-4 4h3v3h-3v-3Zm4 1h3v2h-3v-2Z',
  report: 'M5 3h11l4 4v14H5V3Zm10 0v5h5M8 12h9M8 16h9',
  cloud: 'M6 18h12a4 4 0 0 0 0-8 7 7 0 0 0-13-1A4.5 4.5 0 0 0 6 18Zm6-13v5m-3-2 3 3 3-3',
  cargo: 'M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-10h.01',
  feedback: 'M4 4h16v12H9l-5 4V4Zm8 3v5m0 2h.01',
  chevronDown: 'm5 9 7 7 7-7',
  ruler: 'M3 7h18v10H3V7Zm4 0v5m4-5v3m4-3v5m4-5v3'
};

export function UiIcon({ name, className = '' }: Props) {
  return <svg className={`ui-mini-icon${className === '' ? '' : ` ${className}`}`} viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]}/></svg>;
}
