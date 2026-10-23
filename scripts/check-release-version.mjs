import { readFileSync } from 'node:fs';

const packageData = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const capacitorConfig = readFileSync(new URL('../capacitor.config.ts', import.meta.url), 'utf8');
const workerConfig = readFileSync(new URL('../cloud/district-sync/wrangler.jsonc', import.meta.url), 'utf8');
const androidVersion = gradle.match(/versionName\s+"([^"]+)"/u)?.[1];
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/u)?.[1]);
const tag = process.env.GITHUB_REF_TYPE === 'tag'
  ? process.env.GITHUB_REF_NAME?.replace(/^v/iu, '')
  : undefined;

if (androidVersion !== packageData.version) {
  throw new Error(`Версии не совпадают: package.json=${packageData.version}, Android=${androidVersion ?? 'не найдена'}.`);
}
if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
  throw new Error('Android versionCode должен быть положительным целым числом.');
}
if (tag !== undefined && tag !== packageData.version) {
  throw new Error(`Тег v${tag} не совпадает с версией приложения ${packageData.version}.`);
}
if (!capacitorConfig.includes("hostname: 'stas07130713-debug.github.io'")) {
  throw new Error('Android должен использовать доверенный адрес браузерной версии для облачной авторизации.');
}
for (const origin of ['https://localhost', 'http://localhost', 'capacitor://localhost']) {
  if (!workerConfig.includes(origin)) throw new Error(`В резервном сервисе не разрешён мобильный адрес ${origin}.`);
}
console.log(`Версия ${packageData.version}, Android code ${versionCode}: согласовано.`);
