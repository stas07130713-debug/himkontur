import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import packageInformation from "../../package.json";

const RELEASE_API = "https://api.github.com/repos/stas07130713-debug/himkontur/releases/latest";

type AndroidUpdater = Readonly<{
  getVersion: () => Promise<{ version: string; code: number }>;
  requestInstallPermission: () => Promise<{ allowed: boolean }>;
  installUpdate: (options: { url: string; version: string }) => Promise<{ started: boolean }>;
  addListener: (event: "downloadProgress", callback: (event: { percent: number }) => void) => Promise<PluginListenerHandle>;
}>;

type Release = Readonly<{
  tag_name: string;
  assets: readonly Readonly<{ name: string; browser_download_url: string }>[];
}>;

type State = Readonly<{
  mode: "hidden" | "checking" | "available" | "downloading" | "ready" | "message";
  text: string;
  version?: string;
  url?: string;
  percent?: number;
}>;

const androidUpdater = registerPlugin<AndroidUpdater>("HimkonturUpdater");

function cleanVersion(value: string): number[] {
  return value.replace(/^v/iu, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function isNewer(candidate: string, current: string): boolean {
  const left = cleanVersion(candidate);
  const right = cleanVersion(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export function UpdateCenter() {
  const [state, setState] = useState<State>({ mode: "hidden", text: "" });
  const automaticCheck = useRef(true);
  const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

  const checkAndroid = useCallback(async (manual = false) => {
    if (!isAndroid) return;
    automaticCheck.current = !manual;
    if (manual) setState({ mode: "checking", text: "Проверяем обновления…" });
    try {
      const [{ version: installedVersion }, response] = await Promise.all([
        androidUpdater.getVersion(),
        fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" }),
      ]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const release = await response.json() as Release;
      const version = release.tag_name.replace(/^v/iu, "");
      const asset = release.assets.find((item) => /HIMKONTUR.*Android.*\.apk$/iu.test(item.name));
      if (isNewer(version, installedVersion) && asset !== undefined) {
        setState({ mode: "available", text: `Доступна новая версия ${version}`, version, url: asset.browser_download_url });
      } else if (manual) {
        setState({ mode: "message", text: `Установлена актуальная версия ${installedVersion}` });
      }
    } catch {
      if (manual) setState({ mode: "message", text: "Сервер обновлений недоступен. Автономная работа продолжается." });
    }
  }, [isAndroid]);

  useEffect(() => {
    if (window.himkonturUpdates === undefined) return;
    return window.himkonturUpdates.onStatus((status) => {
      if (status.state === "available") setState({ mode: "available", text: `Загружается новая версия ${status.version ?? ""}`.trim(), ...(status.version === undefined ? {} : { version: status.version }) });
      else if (status.state === "downloading") setState({ mode: "downloading", text: "Загрузка обновления Windows", ...(status.percent === undefined ? {} : { percent: status.percent }) });
      else if (status.state === "downloaded") setState({ mode: "ready", text: `Версия ${status.version ?? ""} готова к установке`.trim(), ...(status.version === undefined ? {} : { version: status.version }) });
      else if (status.state === "error" && !automaticCheck.current) setState({ mode: "message", text: status.message ?? "Не удалось проверить обновления." });
      else if (status.state === "current" && !automaticCheck.current) setState({ mode: "message", text: `Установлена актуальная версия ${status.version ?? packageInformation.version}` });
    });
  }, []);

  useEffect(() => {
    if (!isAndroid) return;
    const timeout = window.setTimeout(() => void checkAndroid(false), 8_000);
    let listener: PluginListenerHandle | undefined;
    void androidUpdater.addListener("downloadProgress", ({ percent }) => {
      setState({ mode: "downloading", text: "Загрузка обновления Android", ...(percent < 0 ? {} : { percent }) });
    }).then((handle) => { listener = handle; });
    return () => {
      window.clearTimeout(timeout);
      void listener?.remove();
    };
  }, [checkAndroid, isAndroid]);

  useEffect(() => {
    const check = () => {
      automaticCheck.current = false;
      if (window.himkonturUpdates !== undefined) {
        setState({ mode: "checking", text: "Проверяем обновления…" });
        void window.himkonturUpdates.check();
      } else {
        void checkAndroid(true);
      }
    };
    window.addEventListener("himkontur:update-check", check);
    return () => window.removeEventListener("himkontur:update-check", check);
  }, [checkAndroid]);

  const install = async () => {
    if (window.himkonturUpdates !== undefined) {
      await window.himkonturUpdates.install();
      return;
    }
    if (!isAndroid || state.url === undefined || state.version === undefined) return;
    try {
      const permission = await androidUpdater.requestInstallPermission();
      if (!permission.allowed) {
        setState({ ...state, mode: "available", text: "Разрешите установку для ХИМКОНТУР и нажмите «Установить» ещё раз" });
        return;
      }
      setState({ ...state, mode: "downloading", text: "Загрузка обновления Android" });
      await androidUpdater.installUpdate({ url: state.url, version: state.version });
    } catch (error) {
      setState({ ...state, mode: "message", text: error instanceof Error ? error.message : "Не удалось установить обновление." });
    }
  };

  if (state.mode === "hidden") return null;
  const canInstall = state.mode === "ready" || (state.mode === "available" && isAndroid);
  return (
    <aside className="update-center" role="status" aria-live="polite">
      <button className="update-center-close" type="button" aria-label="Скрыть уведомление" onClick={() => setState({ mode: "hidden", text: "" })}>×</button>
      <strong>{state.mode === "ready" || state.mode === "available" ? "Обновление ХИМКОНТУР" : "ХИМКОНТУР"}</strong>
      <span>{state.text}</span>
      {state.mode === "downloading" && <progress max="100" value={state.percent} />}
      {canInstall && <button className="update-center-install" type="button" onClick={() => void install()}>{state.mode === "ready" ? "Перезапустить и установить" : "Скачать и установить"}</button>}
    </aside>
  );
}
