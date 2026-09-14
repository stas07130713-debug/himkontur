export function appAssetUrl(path: string): string {
  if (/^(?:data:|blob:|https?:)/u.test(path)) return path;
  return new URL(path.replace(/^\/+/, ''), document.baseURI).href;
}
