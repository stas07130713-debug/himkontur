import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import packageInformation from "../../package.json";
import { isNewerVersion } from "./update-version";

const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

type AndroidUpdater = Readonly<{
  getVersion: () => Promise<{ version: string; code: number }>;
  checkUpdate: () => Promise<Release>;
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

export function UpdateCenter() {
  const [state, setState] = useState<State>({ mode: "hidden", text: "" });
  const automaticCheck = useRef(true);
  const lastAutomaticCheck = useRef(0);
  const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

  const checkAndroid = useCallback(async (manual = false) => {
    if (!isAndroid) return;
    const now = Date.now();
    if (!manual && now - lastAutomaticCheck.current < AUTOMATIC_CHECK_INTERVAL_MS) return;
    if (!manual) lastAutomaticCheck.current = now;
    automaticCheck.current = !manual;
    if (manual) setState({ mode: "checking", text: "Проверяем обновления…" });
    try {
      const [{ version: installedVersion }, release] = await Promise.all([
        androidUpdater.getVersion(),
        androidUpdater.checkUpdate(),
      ]);
      const version = release.tag_name.replace(/^v/iu, "");
      const asset = release.assets.find((item) => /HIMKONTUR.*Android.*\.apk$/iu.test(item.name));
      if (isNewerVersion(version, installedVersion) && asset !== undefined) {
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
    const receiveStatus = (status: Awaited<ReturnType<NonNullable<typeof window.himkonturUpdates>["getStatus"]>>) => {
      if (status.state === "available") setState({ mode: "available", text: `Загружается новая версия ${status.version ?? ""}`.trim(), ...(status.version === undefined ? {} : { version: status.version }) });
      else if (status.state === "downloading") setState({ mode: "downloading", text: "Загрузка обновления Windows", ...(status.percent === undefined ? {} : { percent: status.percent }) });
      else if (status.state === "downloaded") setState({ mode: "ready", text: `Версия ${status.version ?? ""} готова к установке`.trim(), ...(status.version === undefined ? {} : { version: status.version }) });
      else if (status.state === "error" && !automaticCheck.current) setState({ mode: "message", text: status.message ?? "Не удалось проверить обновления." });
      else if (status.state === "current" && !automaticCheck.current) setState({ mode: "message", text: `Установлена актуальная версия ${status.version ?? packageInformation.version}` });
    };
    const unsubscribe = window.himkonturUpdates.onStatus(receiveStatus);
    // Replay the most recent main-process state. This closes the race where a
    // fast update check completed before React registered its event listener.
    void window.himkonturUpdates.getStatus().then(receiveStatus);
    const startupCheck = window.setTimeout(() => {
      automaticCheck.current = true;
      void window.himkonturUpdates?.check();
    }, 5_500);
    return () => {
      window.clearTimeout(startupCheck);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAndroid) return;
    const timeout = window.setTimeout(() => void checkAndroid(false), 8_000);
    const interval = window.setInterval(() => void checkAndroid(false), AUTOMATIC_CHECK_INTERVAL_MS);
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkAndroid(false);
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    let listener: PluginListenerHandle | undefined;
    void androidUpdater.addListener("downloadProgress", ({ percent }) => {
      setState({ mode: "downloading", text: "Загрузка обновления Android", ...(percent < 0 ? {} : { percent }) });
    }).then((handle) => { listener = handle; });
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkWhenVisible);
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
  const importantAndroidUpdate = state.mode === "available" && isAndroid;
  const notification = (
    <aside
      className={`update-center${importantAndroidUpdate ? " update-center-important" : ""}`}
      role={importantAndroidUpdate ? "dialog" : "status"}
      aria-modal={importantAndroidUpdate ? "true" : undefined}
      aria-live="polite"
      aria-label={importantAndroidUpdate ? "Доступно обновление ХИМКОНТУР" : undefined}
    >
      <button className="update-center-close" type="button" aria-label="Скрыть уведомление" onClick={() => setState({ mode: "hidden", text: "" })}>×</button>
      <strong>{state.mode === "ready" || state.mode === "available" ? "Обновление ХИМКОНТУР" : "ХИМКОНТУР"}</strong>
      <span>{state.text}</span>
      {importantAndroidUpdate && <span className="update-center-note">Будет установлена сразу последняя версия. Промежуточные обновления не требуются.</span>}
      {state.mode === "downloading" && <progress max="100" value={state.percent} />}
      {canInstall && <div className="update-center-actions">
        <button className="update-center-install" type="button" onClick={() => void install()}>{state.mode === "ready" ? "Перезапустить и установить" : "Обновить сейчас"}</button>
        {importantAndroidUpdate && <button className="update-center-cancel" type="button" onClick={() => setState({ mode: "hidden", text: "" })}>Отмена</button>}
      </div>}
    </aside>
  );
  return importantAndroidUpdate ? <div className="update-center-backdrop">{notification}</div> : notification;
}
