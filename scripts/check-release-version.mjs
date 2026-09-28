import { readFileSync } from 'node:fs';

const packageData = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
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
console.log(`Версия ${packageData.version}, Android code ${versionCode}: согласовано.`);
