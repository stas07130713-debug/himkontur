import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.ahov.forecast',
  appName: 'АХОВ Прогноз',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false }
};

export default config;
