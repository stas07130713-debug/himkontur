import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.ahov.forecast',
  appName: 'АХОВ Прогноз',
  webDir: 'dist',
  // Keep the signed Android shell on the same trusted origin as the published web app.
  // The bundled files are still served locally by Capacitor; only the browser origin changes.
  server: { androidScheme: 'https', hostname: 'stas07130713-debug.github.io' },
  android: { allowMixedContent: false }
};

export default config;
