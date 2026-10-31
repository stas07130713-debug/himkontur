import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import packageInformation from "../../package.json";
import { calculate } from "../core/calculation";
import { verifyCalculation } from "../core/verifier";
import { fetchWeather, type WeatherObservation } from "../core/weather";
import type { CalculationInput } from "../core/types";
import {
  loadScenarioFile,
} from "../storage/scenario-store";
import { DangerousGoodsPanel } from "./DangerousGoodsPanel";
import { currentMinuteIso, DEFAULT_INPUT } from "./defaults";
import { InputPanel } from "./InputPanel";
import { MapCanvas, type Basemap, type ControlPoint } from "./MapCanvas";
import { ResultsPanel } from "./ResultsPanel";
import { SourcePalette } from "./SourcePalette";
import { TraceDialog } from "./TraceDialog";
import { ControlPalette, type ControlTemplate } from "./ControlPalette";
import {
  defaultSourceForSubstance,
  DEFAULT_SOURCE,
  massFromCapacity,
  massFromSource,
  type SourceConfiguration,
} from "./source-library";
import { SUBSTANCES } from "../core/reference-data";
import { withAutomaticStability } from "../core/stability";
import { BrandLogo } from "./BrandLogo";
import { UiIcon } from "./UiIcon";
import { MainTabIcon } from "./MainTabIcon";
import { BuildingIcon } from "./BuildingIcon";
import { evaluateControlPoint } from "../core/geo";
import { round } from "../core/math";
import { MobileAccessDialog } from "./MobileAccessDialog";
import { UpdateCenter } from "./UpdateCenter";
import { DistrictMapPage } from "./DistrictMapPage";
import {
  createPendingDistrictMapOperation,
  fetchCoordinatedDistrictMapProject,
  fetchCoordinatedDistrictMapUpdate,
  fetchPublishedDistrictMapProject,
  loadDistrictMapProject,
  loadPendingDistrictMapOperations,
  publishDistrictMapOperation,
  saveDistrictMapProject,
  savePendingDistrictMapOperations,
  shouldAdoptSharedDistrictMap,
  type DistrictMapObject,
  type DistrictMapPublishResult,
  type PendingDistrictMapOperation,
  type DistrictMapProject,
} from "./district-map-model";
import {
  clearDistrictMapConflictArchives,
  districtMapConflictArchiveCount,
  mergeDistrictMapProjects,
  saveDistrictMapConflictArchive,
  serializeDistrictMapConflictReport,
} from "./district-map-merge";
import {
  authenticateMapAdmin,
  checkMapSynchronization,
  disabledMapSyncStatus,
  loadMapSyncConfig,
  MapSyncRequestError,
  withRenewedMapAdminSession,
  type MapAdminCredential,
  type MapSyncStatus,
} from "./map-sync-service";
import { evaluateRescueServiceWarning } from './rescue-service-warning';

type Tab = "calculation" | "goods" | "district";
type Theme = "light" | "dark";
type DistrictSyncState = "ready" | "pending" | "publishing" | "error";
const MAP_ADMIN_PASSWORD = "1234";
type Snapshot = Readonly<{
  input: CalculationInput;
  source: SourceConfiguration;
  sourcePlaced: boolean;
  controls: readonly ControlPoint[];
  basemap: Basemap;
  districtProject: DistrictMapProject;
}>;
type HistoryItem = Readonly<{
  label: string;
  group?: string;
}> & (
  | Readonly<{ kind: "snapshot"; snapshot: Snapshot }>
  | Readonly<{ kind: "custom"; undo: () => void; redo: () => void }>
);

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка.";
}

export function App() {
  const isElectron = navigator.userAgent.includes("Electron");
  const [tab, setTab] = useState<Tab>("calculation");
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem("himkontur-theme") === "dark"
      ? "dark"
      : "light",
  );
  const [goodsQuery, setGoodsQuery] = useState("");
  const [goodsResetRevision, setGoodsResetRevision] = useState(0);
  const [input, setInput] = useState<CalculationInput>(DEFAULT_INPUT);
  const [source, setSource] = useState<SourceConfiguration>(DEFAULT_SOURCE);
  const [sourcePlaced, setSourcePlaced] = useState(true);
  const [controls, setControls] = useState<readonly ControlPoint[]>([]);
  const [controlFocus, setControlFocus] = useState<Readonly<{ id: string; revision: number }> | null>(null);
  const [districtFocus, setDistrictFocus] = useState<Readonly<{ id: string; revision: number }> | null>(null);
  // The bundled map is the dependable default on every device. Satellite
  // imagery is an optional online/cached layer selected by the user.
  const [basemap, setBasemap] = useState<Basemap>("standard");
  const [calculationStarted, setCalculationStarted] = useState(false);
  const [calculationRevision, setCalculationRevision] = useState(0);
  const [traceOpen, setTraceOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [districtProject, setDistrictProject] = useState(loadDistrictMapProject);
  const initialPendingDistrictOperationsRef = useRef<PendingDistrictMapOperation[]>(loadPendingDistrictMapOperations());
  const [districtSyncState, setDistrictSyncState] = useState<DistrictSyncState>(() => initialPendingDistrictOperationsRef.current.length === 0 ? "ready" : "pending");
  const [mapSyncStatus, setMapSyncStatus] = useState<MapSyncStatus>(() => disabledMapSyncStatus());
  const [districtConflictCount, setDistrictConflictCount] = useState(districtMapConflictArchiveCount);
  const [mapSyncCheckBusy, setMapSyncCheckBusy] = useState(false);
  const [districtAdmin, setDistrictAdmin] = useState(false);
  const [districtManagementOpen, setDistrictManagementOpen] = useState(false);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState("");
  const [weather, setWeather] = useState<WeatherObservation | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [, setNotice] = useState<string | null>(null);
  const pastRef = useRef<HistoryItem[]>([]);
  const futureRef = useRef<HistoryItem[]>([]);
  const [, setHistoryRevision] = useState(0);
  const districtChangeRememberedRef = useRef(false);
  const districtProjectRef = useRef(districtProject);
  const pendingDistrictOperationsRef = useRef<PendingDistrictMapOperation[]>(initialPendingDistrictOperationsRef.current);
  const districtPublishingRef = useRef(false);
  const districtRefreshingRef = useRef(false);
  const districtForceLoadRef = useRef(false);
  const districtPublicationAbortRef = useRef<AbortController | null>(null);
  const adminCredentialRef = useRef<MapAdminCredential | null>(null);
  useEffect(() => { districtProjectRef.current = districtProject; }, [districtProject]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("himkontur-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (tab !== "district") setDistrictManagementOpen(false);
  }, [tab]);
  const refreshDistrictMapFromServer = useCallback(async (): Promise<boolean> => {
    if (districtRefreshingRef.current) return false;
    districtRefreshingRef.current = true;
    const hasPendingChanges = () => pendingDistrictOperationsRef.current.length > 0 || districtChangeRememberedRef.current;
    if (hasPendingChanges()) {
      setDistrictSyncState("pending");
      districtRefreshingRef.current = false;
      return false;
    }
    let authoritative = false;
    let remote: DistrictMapProject | null = null;
    try {
      remote = await fetchCoordinatedDistrictMapUpdate(districtProjectRef.current);
      authoritative = remote !== null;
    } catch {
      remote = await fetchPublishedDistrictMapProject();
    }
    if (remote === null) {
      if (pendingDistrictOperationsRef.current.length === 0) setDistrictSyncState("error");
      districtRefreshingRef.current = false;
      return false;
    }
    const shared = remote;
    if (hasPendingChanges()) {
      setDistrictSyncState("pending");
      districtRefreshingRef.current = false;
      return false;
    }
    setDistrictSyncState("ready");
    setDistrictProject((current) => {
      if (!shouldAdoptSharedDistrictMap(shared, current, authoritative)) return current;
      const next = { ...shared, draft: shared.published };
      districtProjectRef.current = next;
      saveDistrictMapProject(next);
      return next;
    });
    districtRefreshingRef.current = false;
    return true;
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await refreshDistrictMapFromServer();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    let interval = window.setInterval(() => void refresh(), 60 * 1000);
    void loadMapSyncConfig().then((config) => {
      if (cancelled || config === null) return;
      window.clearInterval(interval);
      interval = window.setInterval(() => void refresh(), config.pollIntervalMs);
      if (!config.coordinatorEnabled) setMapSyncStatus(disabledMapSyncStatus('Работает прямая синхронизация с основной базой.'));
    });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [districtAdmin, refreshDistrictMapFromServer]);

  const refreshMapSyncStatus = async () => {
    setMapSyncCheckBusy(true);
    try {
      await refreshDistrictMapFromServer();
      const config = await loadMapSyncConfig();
      if (config?.coordinatorEnabled !== true) {
        setMapSyncStatus(disabledMapSyncStatus('Резервный облачный сервис подготовлен, но ещё не включён.'));
        return;
      }
      const status = await checkMapSynchronization(adminCredentialRef.current ?? undefined);
      setMapSyncStatus(status);
    } catch (error) {
      setMapSyncStatus((current) => ({
        ...current,
        enabled: true,
        mode: 'offline',
        activeProvider: 'local',
        backupAvailable: false,
        synchronized: false,
        pendingOperations: 0,
        message: message(error),
      }));
    } finally {
      setMapSyncCheckBusy(false);
    }
  };

  const loadSharedDistrictMapFromServer = async (discardLocalChanges = false): Promise<Readonly<{ success: boolean; message: string }>> => {
    const hasLocalChanges = pendingDistrictOperationsRef.current.length > 0 || districtChangeRememberedRef.current;
    if (hasLocalChanges && !discardLocalChanges) {
      return {
        success: false,
        message: 'На этом устройстве есть неопубликованные изменения. Подтвердите замену либо сначала сохраните резервную копию.',
      };
    }
    districtForceLoadRef.current = true;
    districtPublicationAbortRef.current?.abort();
    for (let attempt = 0; districtPublishingRef.current && attempt < 100; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (districtPublishingRef.current) {
      districtForceLoadRef.current = false;
      return { success: false, message: 'Не удалось остановить текущую отправку. Повторите замену карты через несколько секунд.' };
    }
    setMapSyncCheckBusy(true);
    try {
      const shared = await fetchCoordinatedDistrictMapProject();
      if (shared === null) return { success: false, message: 'Сервер не вернул общую карту.' };
      if (discardLocalChanges) {
        pendingDistrictOperationsRef.current = [];
        savePendingDistrictMapOperations([]);
        districtChangeRememberedRef.current = false;
        pastRef.current = [];
        futureRef.current = [];
        setHistoryRevision((current) => current + 1);
      }
      const next = { ...shared, draft: shared.published };
      districtProjectRef.current = next;
      setDistrictProject(next);
      saveDistrictMapProject(next);
      setDistrictSyncState('ready');
      return {
        success: true,
        message: `Общая карта принудительно загружена с сервера: ${next.published.length} объектов.`,
      };
    } catch (error) {
      return { success: false, message: `Не удалось загрузить общую карту: ${message(error)}` };
    } finally {
      districtForceLoadRef.current = false;
      setMapSyncCheckBusy(false);
    }
  };

  const snapshot = (): Snapshot => ({
    input,
    source,
    sourcePlaced,
    controls,
    basemap,
    districtProject: districtProjectRef.current,
  });
  const remember = (label: string) => {
    pastRef.current = [
      ...pastRef.current.slice(-49),
      { kind: "snapshot", snapshot: snapshot(), label },
    ];
    futureRef.current = [];
    setHistoryRevision((value) => value + 1);
  };
  const rememberCustom = (group: string, label: string, undoAction: () => void, redoAction: () => void) => {
    pastRef.current = [
      ...pastRef.current.slice(-49),
      { kind: "custom", group, label, undo: undoAction, redo: redoAction },
    ];
    futureRef.current = [];
    setHistoryRevision((value) => value + 1);
  };
  const clearHistoryGroup = (group: string) => {
    pastRef.current = pastRef.current.filter((item) => item.group !== group);
    futureRef.current = futureRef.current.filter((item) => item.group !== group);
    setHistoryRevision((value) => value + 1);
  };
  const applySnapshot = (value: Snapshot) => {
    setInput(value.input);
    setSource(value.source);
    setSourcePlaced(value.sourcePlaced);
    setControls(value.controls);
    setBasemap(value.basemap);
    const currentProject = districtProjectRef.current;
    const districtChanged = value.districtProject !== currentProject;
    const restoredProject = !districtChanged
      ? currentProject
      : {
          ...value.districtProject,
          revision: Math.max(value.districtProject.revision, currentProject.revision, Date.now()),
          draftSavedAtIso: new Date().toISOString(),
          publishedAtIso: new Date().toISOString(),
        };
    districtProjectRef.current = restoredProject;
    setDistrictProject(restoredProject);
    saveDistrictMapProject(restoredProject);
    if (districtChanged) {
      const pendingBase = pendingDistrictOperationsRef.current[0];
      const operation = createPendingDistrictMapOperation(
        pendingBase?.baseRevision ?? currentProject.revision,
        restoredProject,
        pendingBase?.baseProject ?? currentProject,
      );
      pendingDistrictOperationsRef.current = [operation];
      savePendingDistrictMapOperations(pendingDistrictOperationsRef.current);
      setDistrictSyncState("pending");
      void publishPendingDistrictProject();
    }
  };
  const undo = () => {
    const item = pastRef.current.at(-1);
    if (item === undefined) return;
    pastRef.current = pastRef.current.slice(0, -1);
    if (item.kind === "custom") {
      item.undo();
      futureRef.current = [item, ...futureRef.current];
    } else {
      futureRef.current = [
        { kind: "snapshot", snapshot: snapshot(), label: item.label },
        ...futureRef.current,
      ];
      applySnapshot(item.snapshot);
    }
    districtChangeRememberedRef.current = false;
    setNotice(`Отменено: ${item.label}.`);
    setHistoryRevision((value) => value + 1);
  };
  const redo = () => {
    const item = futureRef.current[0];
    if (item === undefined) return;
    futureRef.current = futureRef.current.slice(1);
    if (item.kind === "custom") {
      item.redo();
      pastRef.current = [...pastRef.current, item];
    } else {
      pastRef.current = [
        ...pastRef.current,
        { kind: "snapshot", snapshot: snapshot(), label: item.label },
      ];
      applySnapshot(item.snapshot);
    }
    districtChangeRememberedRef.current = false;
    setNotice(`Возвращено: ${item.label}.`);
    setHistoryRevision((value) => value + 1);
  };

  const effectiveInput = useMemo(() => withAutomaticStability(input), [input]);
  const calculation = useMemo(() => {
    if (!calculationStarted) return { result: null, error: null };
    if (!sourcePlaced)
      return { result: null, error: "Разместите источник АХОВ на карте." };
    try {
      return { result: calculate(effectiveInput), error: null };
    } catch (error) {
      return { result: null, error: message(error) };
    }
  }, [calculationStarted, effectiveInput, sourcePlaced]);
  const verification = useMemo(
    () =>
      calculation.result === null
        ? null
        : verifyCalculation(calculation.result, new Date().toISOString()),
    [calculation.result],
  );
  const rescueServiceWarning = useMemo(
    () => evaluateRescueServiceWarning(calculation.result, districtProject.published),
    [calculation.result, districtProject.published],
  );

  const getWeather = async () => {
    if (!sourcePlaced) {
      setNotice("Сначала разместите источник АХОВ на карте.");
      return;
    }
    setWeatherBusy(true);
    setWeatherError(null);
    setNotice(null);
    try {
      const observation = await fetchWeather(
        input.sourcePoint,
        input.accidentTimeIso,
      );
      remember("Получены погодные данные");
      setWeather(observation);
      setWeatherError(null);
      setInput((current) => ({
        ...current,
        temperatureC: observation.temperatureC,
        windSpeedMps: observation.windSpeedMps,
        windFromDegrees: observation.windFromDegrees,
        cloudCoverPercent: observation.cloudCoverPercent,
        snowCover: observation.snowDepthM > 0,
      }));
      setNotice(
        observation.windSpeedMps > 4
          ? "Погода получена. По таблице В.1 автоматически выбрана изотермия."
          : "Погода получена. Устойчивость атмосферы оставлена для экспертного выбора.",
      );
    } catch (error) {
      const detail = message(error);
      setWeatherError(`Не удалось получить метеоданные: ${detail}`);
      setNotice(
        `Погода не получена: ${detail} Можно продолжить с ручным вводом.`,
      );
    } finally {
      setWeatherBusy(false);
    }
  };

  const restore = async (file: File) => {
    try {
      const stored = await loadScenarioFile(file);
      setInput({ ...DEFAULT_INPUT, ...stored.input });
      setCalculationStarted(true);
      setSourcePlaced(stored.sourcePlaced ?? true);
      remember("Открыт сохранённый расчёт");
      setControls(
        stored.controls.filter(
          (control) => (control as { kind?: string }).kind !== "exit",
        ),
      );
      if (stored.basemap !== undefined) setBasemap(stored.basemap);
      setSource({
        ...DEFAULT_SOURCE,
        ...(stored.sourceConfiguration ?? {}),
        label: stored.sourceConfiguration?.label ?? stored.sourceLabel,
      });
      setNotice(
        `Загружен сценарий от ${new Date(stored.savedAtIso).toLocaleString("ru-RU")}.`,
      );
    } catch (error) {
      setNotice(`Загрузка не выполнена: ${message(error)}`);
    }
  };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("scenario") !== "1")
      return;
    void fetch("/startup-scenario")
      .then(async (response) => {
        if (!response.ok || response.status === 204) return;
        const payload = await response.text();
        await restore(
          new File([payload], "startup.himkontur", {
            type: "application/json",
          }),
        );
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => undefined);
    // The startup file is consumed once when Electron launches the application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addControl = (
    template: ControlTemplate,
    point: CalculationInput["sourcePoint"],
  ) => {
    const sequence = controls.length + 1;
    remember("Добавлена контрольная точка");
    const name = `${template.name} ${sequence}`;
    const control: ControlPoint = {
      id: crypto.randomUUID(),
      name,
      kind: template.kind,
      point,
    };
    setControls((current) => [...current, control]);
  };

  const configureSource = (configuration: SourceConfiguration) => {
    remember(`Выбран источник «${configuration.label}»`);
    setSource(configuration);
    setSourcePlaced(true);
    const density =
      SUBSTANCES.find((item) => item.id === configuration.substanceId)
        ?.densityLiquidTPerM3 ?? 0;
    const massT = massFromSource(configuration, density);
    setInput((current) => ({
      ...current,
      substanceId: configuration.substanceId,
      massT: Number(massT.toFixed(6)),
      spillKind: configuration.spillKind,
      bundHeightM: configuration.bundHeightM,
      commonBundAreaM2: configuration.commonBundAreaM2,
    }));
  };

  const newCalculation = () => {
    setInput({
      ...DEFAULT_INPUT,
      accidentTimeIso: currentMinuteIso(),
      sourcePoint: { ...DEFAULT_INPUT.sourcePoint },
    });
    setSource(DEFAULT_SOURCE);
    setSourcePlaced(true);
    setControls([]);
    setWeather(null);
    setCalculationStarted(false);
    pastRef.current = [];
    futureRef.current = [];
    setHistoryRevision((value) => value + 1);
    setNotice("Создан новый расчёт. Исходное состояние очищено.");
  };

  const exportReport = async (format: "pdf" | "word") => {
    if (calculation.result === null || verification === null || reportBusy)
      return;
    setReportBusy(true);
    // Close the format chooser immediately. Large, map-rich PDF files may take
    // several seconds to assemble; keeping the modal open looked like a failed
    // click even though the file was being created correctly.
    setReportOpen(false);
    try {
      const map = document.querySelector<HTMLElement>(".map-column");
      if (map === null) throw new Error("область карты не найдена");
      const rightPanel = document.querySelector<HTMLElement>(".right-column");
      if (rightPanel === null)
        throw new Error("правая панель результатов не найдена");
      const [{ captureMapForReport }, exporter] = await Promise.all([
        import("./map-report-capture"),
        import("./report-export"),
      ]);
      const mapImageDataUrl = await captureMapForReport(map, rightPanel);
      const mapAspectRatio = await new Promise<number>((resolve, reject) => {
        const capturedMap = new Image();
        capturedMap.onload = () =>
          resolve(
            capturedMap.naturalWidth /
              Math.max(1, capturedMap.naturalHeight),
          );
        capturedMap.onerror = () =>
          reject(new Error("не удалось определить размер снимка карты"));
        capturedMap.src = mapImageDataUrl;
      });
      const context = {
        weatherSource:
          weather === null
            ? "введены пользователем вручную"
            : `получены автоматически из открытого сервиса ${weather.provider} (${weather.dataKind === "archive" ? "архивные почасовые данные" : "почасовой прогноз"}) для точки ${input.sourcePoint.latitude.toFixed(5)}° с.ш., ${input.sourcePoint.longitude.toFixed(5)}° в.д. на время происшествия ${new Date(weather.observedAt).toLocaleString("ru-RU")}`,
        mapImageDataUrl,
        // The capture is normalized to the same landscape composition on
        // desktop and mobile. Use the actual image dimensions: after capture
        // the live page has already returned to its responsive mobile layout.
        mapAspectRatio,
      };
      if (format === "pdf")
        await exporter.exportCalculationPdf(
          calculation.result,
          verification,
          context,
        );
      else
        await exporter.exportCalculationWord(
          calculation.result,
          verification,
          context,
        );
    } catch (error) {
      setNotice(
        `Отчёт не сформирован: не удалось получить точный снимок текущей карты (${message(error)}). Проверьте доступность подложки и повторите.`,
      );
    } finally {
      setReportBusy(false);
    }
  };

  const undoLabel = pastRef.current.at(-1)?.label;
  const redoLabel = futureRef.current.at(0)?.label;
  const changeDistrictObjects = (objects: readonly DistrictMapObject[]) => {
    setDistrictProject((current) => {
      const next = { ...current, draft: objects };
      districtProjectRef.current = next;
      return next;
    });
  };
  async function publishPendingDistrictProject(): Promise<Readonly<{ success: boolean; message: string }>> {
    if (districtForceLoadRef.current) return { success: false, message: "Выполняется загрузка общей карты с сервера." };
    if (districtPublishingRef.current) return { success: false, message: "Загрузка уже выполняется. Дождитесь её завершения." };
    if (adminCredentialRef.current === null) return { success: false, message: "Сначала войдите в режим настройки карты." };
    const queuedAtStart = pendingDistrictOperationsRef.current.length;
    if (queuedAtStart === 0) {
      void refreshMapSyncStatus();
      return { success: true, message: "Новых изменений для публикации нет. Общая карта уже актуальна." };
    }
    districtPublishingRef.current = true;
    const publicationController = new AbortController();
    districtPublicationAbortRef.current = publicationController;
    try {
      if (adminCredentialRef.current.sessionToken === '') {
        const authenticated = await authenticateMapAdmin(adminCredentialRef.current.password);
        adminCredentialRef.current = authenticated.credential;
        setMapSyncStatus(authenticated.status);
      }
      let conflictRebases = 0;
      while (pendingDistrictOperationsRef.current.length > 0) {
        const pending = pendingDistrictOperationsRef.current[0];
        if (pending === undefined) break;
        setDistrictSyncState("publishing");
        const activeCredential: MapAdminCredential = adminCredentialRef.current;
        let publishResult: Readonly<{
          value: DistrictMapPublishResult;
          credential: MapAdminCredential;
          status: MapSyncStatus | null;
        }>;
        try {
          publishResult = await withRenewedMapAdminSession(
            activeCredential,
            (credential) => publishDistrictMapOperation(pending, credential, publicationController.signal),
          );
        } catch (error) {
          if (!(error instanceof MapSyncRequestError) || error.kind !== 'conflict') throw error;
          if (conflictRebases >= 2) throw new Error('Облачная база остаётся в конфликтном состоянии. Обе версии сохранены; повторите синхронизацию после проверки сервера.');
          conflictRebases += 1;
          const remote = await fetchCoordinatedDistrictMapProject();
          const latestLocal = pendingDistrictOperationsRef.current.at(-1)?.project ?? pending.project;
          if (remote === null) throw new Error('Не удалось получить актуальную облачную карту для безопасного объединения. Локальные изменения сохранены.');
          const merged = mergeDistrictMapProjects(pending.baseProject ?? null, latestLocal, remote);
          if (merged.conflicts.length > 0) {
            const total = saveDistrictMapConflictArchive({
              createdAtIso: new Date().toISOString(),
              baseRevision: pending.baseProject?.revision ?? null,
              localRevision: latestLocal.revision,
              remoteRevision: remote.revision,
              conflicts: merged.conflicts,
            });
            setDistrictConflictCount(total);
          }
          const rebased = createPendingDistrictMapOperation(remote.revision, merged.project, remote);
          pendingDistrictOperationsRef.current = [rebased];
          savePendingDistrictMapOperations(pendingDistrictOperationsRef.current);
          districtProjectRef.current = merged.project;
          setDistrictProject(merged.project);
          saveDistrictMapProject(merged.project);
          setMapSyncStatus((current) => ({
            ...current,
            mode: 'recovering',
            message: merged.conflicts.length === 0
              ? 'Изменения с двух устройств безопасно объединены и отправляются повторно.'
              : `Карты объединены. ${merged.conflicts.length} спорн. объект(а) сохранены в журнале конфликтов; активна более свежая версия.`,
          }));
          continue;
        }
        adminCredentialRef.current = publishResult.credential;
        if (publishResult.status !== null) setMapSyncStatus(publishResult.status);
        const synchronized = publishResult.value.project;
        if (publishResult.value.conflicts.length > 0) {
          const total = saveDistrictMapConflictArchive({
            createdAtIso: new Date().toISOString(),
            baseRevision: pending.baseProject?.revision ?? pending.baseRevision,
            localRevision: pending.project.revision,
            remoteRevision: synchronized.revision,
            conflicts: publishResult.value.conflicts,
          });
          setDistrictConflictCount(total);
        }
        if (pendingDistrictOperationsRef.current[0]?.operationId === pending.operationId) {
          pendingDistrictOperationsRef.current = pendingDistrictOperationsRef.current.slice(1);
          savePendingDistrictMapOperations(pendingDistrictOperationsRef.current);
        }
        if (pendingDistrictOperationsRef.current.length === 0) {
          const next = { ...synchronized, draft: synchronized.published };
          districtProjectRef.current = next;
          setDistrictProject(next);
          saveDistrictMapProject(next);
          setDistrictSyncState("ready");
        }
      }
      void refreshMapSyncStatus();
      return {
        success: pendingDistrictOperationsRef.current.length === 0,
        message: pendingDistrictOperationsRef.current.length === 0
          ? "Изменения успешно загружены в общую базу. Другие устройства получат карту автоматически."
          : "Часть изменений пока остаётся в локальной очереди. Повторите загрузку.",
      };
    } catch (error) {
      setDistrictSyncState("error");
      const failureMessage = `Не удалось загрузить изменения в общую базу. Они сохранены только на этом устройстве: ${message(error)}`;
      setNotice(failureMessage);
      window.setTimeout(() => {
        if (pendingDistrictOperationsRef.current.length > 0) void publishPendingDistrictProject();
      }, 30_000);
      return { success: false, message: failureMessage };
    } finally {
      if (districtPublicationAbortRef.current === publicationController) districtPublicationAbortRef.current = null;
      districtPublishingRef.current = false;
    }
  }
  useEffect(() => {
    const resumePendingPublication = () => {
      if (pendingDistrictOperationsRef.current.length === 0) return;
      adminCredentialRef.current ??= { password: MAP_ADMIN_PASSWORD, sessionToken: "" };
      void publishPendingDistrictProject();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") resumePendingPublication(); };
    resumePendingPublication();
    const interval = window.setInterval(resumePendingPublication, 15_000);
    window.addEventListener("online", resumePendingPublication);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", resumePendingPublication);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // The locally persisted queue resumes until the server confirms it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const commitDistrictObjects = (objects: readonly DistrictMapObject[]) => {
    if (!districtChangeRememberedRef.current) remember("Изменена карта района выезда");
    districtChangeRememberedRef.current = false;
    const current = districtProjectRef.current;
    const now = new Date().toISOString();
    // Date-based revisions remain newer than every legacy local counter. This
    // prevents an old browser cache with a numerically inflated revision from
    // rejecting a genuinely newer shared map.
    const published = { ...current, revision: Math.max(current.revision + 1, Date.now()), draft: objects, published: objects, draftSavedAtIso: now, publishedAtIso: now };
    const pendingBase = pendingDistrictOperationsRef.current[0];
    const operation = createPendingDistrictMapOperation(
      pendingBase?.baseRevision ?? current.revision,
      published,
      pendingBase?.baseProject ?? current,
    );
    districtProjectRef.current = published;
    pendingDistrictOperationsRef.current = [operation];
    savePendingDistrictMapOperations(pendingDistrictOperationsRef.current);
    setDistrictProject(published);
    saveDistrictMapProject(published);
    setDistrictSyncState("pending");
    void publishPendingDistrictProject();
  };
  const downloadDistrictConflictArchive = () => {
    const blob = new Blob([serializeDistrictMapConflictReport()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `HIMKONTUR-map-conflicts-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const clearDistrictConflictArchive = () => {
    if (!window.confirm('Удалить все записи из журнала уже разрешённых конфликтов? Актуальная карта, выбранные версии объектов и опубликованные данные не изменятся.')) return;
    clearDistrictMapConflictArchives();
    setDistrictConflictCount(0);
  };

  return (
    <div className="app-shell" data-theme={theme}>
      <UpdateCenter />
      <header className={`topbar${isElectron ? " electron-topbar" : ""}`}>
        <BrandLogo />
        <nav className="main-tabs">
          <button
            className={tab === "calculation" ? "active" : ""}
            onClick={() => setTab("calculation")}
          >
            <MainTabIcon kind="plume" />
            Расчёт АХОВ
          </button>
          <button
            className={tab === "goods" ? "active" : ""}
            onClick={() => { setGoodsQuery(""); setTab("goods"); }}
          >
            <MainTabIcon kind="placard" />
            Опасный груз
          </button>
          <button
            className={tab === "district" ? "active" : ""}
            onClick={() => setTab("district")}
          >
            <MainTabIcon kind="map" />
            Карта района выезда
          </button>
        </nav>
        <div className={`file-actions${tab === "calculation" ? " calculation-actions" : ""}${tab === "goods" ? " goods-actions" : ""}${tab === "district" ? " district-actions" : ""}`}>
          {tab === "calculation" && <button className="new-calculation" title="Начать новый расчёт и очистить введённые данные" aria-label="Новый расчёт — очистить введённые данные" onClick={newCalculation}>
            <UiIcon name="new" />
            <span className="action-label">Новый расчёт</span>
          </button>}
          {tab === "goods" && <button className="dangerous-goods-reset" title="Очистить все введённые данные вкладки «Опасный груз»" aria-label="Сбросить данные опасного груза" onClick={() => {
            setGoodsQuery("");
            setGoodsResetRevision((current) => current + 1);
          }}>
            <UiIcon name="new" />
            <span className="action-label">Сбросить</span>
          </button>}
          {tab === "district" && <button className={`map-settings-action${districtAdmin ? " active" : ""}`} title="Настройка карты района выезда" aria-label="Настройка карты" onClick={() => {
            if (districtAdmin) setDistrictManagementOpen(true);
            else {
              setAdminPassword("");
              setAdminPasswordError("");
              setAdminLoginOpen(true);
            }
          }}>
            <UiIcon name="settings" />
            <span className="action-label">Настройка карты</span>
          </button>}
          <button
            className="mobile-access-action"
            title="Загрузить приложение"
            aria-label="Загрузить приложения ХИМКОНТУР"
            onClick={() => setMobileOpen(true)}
          >
            <UiIcon name="qr" />
            <span className="qr-mobile-label">QR-код</span>
          </button>
          <button
            className="history-action"
            title={
              undoLabel === undefined
                ? "Нет действий для отмены"
                : `Отменить: ${undoLabel}`
            }
            disabled={pastRef.current.length === 0}
            onClick={undo}
          >
            ↶
          </button>
          <button
            className="history-action"
            title={
              redoLabel === undefined
                ? "Нет действий для возврата"
                : `Вернуть: ${redoLabel}`
            }
            disabled={futureRef.current.length === 0}
            onClick={redo}
          >
            ↷
          </button>
        </div>
        <div className="theme-switch" aria-label="Тема оформления">
          <button
            className="mobile-history-action"
            title={undoLabel === undefined ? "Нет действий для отмены" : `Отменить: ${undoLabel}`}
            aria-label={undoLabel === undefined ? "Нет действий для отмены" : `Отменить: ${undoLabel}`}
            disabled={pastRef.current.length === 0}
            onClick={undo}
          >
            ↶
          </button>
          <button
            className="mobile-history-action"
            title={redoLabel === undefined ? "Нет действий для возврата" : `Вернуть: ${redoLabel}`}
            aria-label={redoLabel === undefined ? "Нет действий для возврата" : `Вернуть: ${redoLabel}`}
            disabled={futureRef.current.length === 0}
            onClick={redo}
          >
            ↷
          </button>
          <button
            className={theme === "light" ? "active" : ""}
            title="Светлая тема"
            aria-label="Включить светлую тему"
            onClick={() => setTheme("light")}
          >
            ☼
          </button>
          <button
            className={theme === "dark" ? "active" : ""}
            title="Тёмная тема"
            aria-label="Включить тёмную тему"
            onClick={() => setTheme("dark")}
          >
            ☾
          </button>
        </div>
      </header>
      {tab === "goods" ? (
        <DangerousGoodsPanel initialQuery={goodsQuery} resetSignal={goodsResetRevision} />
      ) : tab === "district" ? (
        <DistrictMapPage
          project={districtProject}
          objects={districtAdmin ? districtProject.draft : districtProject.published}
          adminMode={districtAdmin}
          basemap={basemap}
          onBasemapChange={setBasemap}
          onObjectsChange={changeDistrictObjects}
          onObjectChangeStart={() => {
            if (districtChangeRememberedRef.current) return;
            remember("Перемещён объект карты района выезда");
            districtChangeRememberedRef.current = true;
          }}
          onTransientHistory={(label, undoAction, redoAction) => rememberCustom("district-contour", label, undoAction, redoAction)}
          onClearTransientHistory={() => clearHistoryGroup("district-contour")}
          onCommitObjects={commitDistrictObjects}
          managementOpen={districtManagementOpen}
          onCloseManagement={() => setDistrictManagementOpen(false)}
          onExitAdmin={() => {
            adminCredentialRef.current = null;
            setAdminPassword("");
            setDistrictManagementOpen(false);
            setDistrictAdmin(false);
          }}
          syncStatus={mapSyncStatus}
          localPendingOperations={pendingDistrictOperationsRef.current.length}
          syncCheckBusy={mapSyncCheckBusy}
          onCheckSynchronization={() => void refreshMapSyncStatus()}
          publishBusy={districtSyncState === "publishing"}
          onPublishForAll={publishPendingDistrictProject}
          onLoadFromServer={loadSharedDistrictMapFromServer}
          conflictBackupCount={districtConflictCount}
          onDownloadConflictBackup={downloadDistrictConflictArchive}
          onClearConflictBackup={clearDistrictConflictArchive}
        />
      ) : (
        <>
          <div className="workspace">
            <div className="left-column">
              <InputPanel
                input={effectiveInput}
                sourcePlaced={sourcePlaced}
                onChange={(value) => {
                  remember("Изменены исходные данные");
                  const automaticWeatherWasEdited =
                    weather !== null &&
                    (value.accidentTimeIso !== input.accidentTimeIso ||
                      value.temperatureC !== input.temperatureC ||
                      value.windSpeedMps !== input.windSpeedMps ||
                      value.windFromDegrees !== input.windFromDegrees ||
                      value.cloudCoverPercent !== input.cloudCoverPercent ||
                      value.snowCover !== input.snowCover);
                  if (
                    automaticWeatherWasEdited ||
                    value.accidentTimeIso !== input.accidentTimeIso
                  ) {
                    setWeather(null);
                    setWeatherError(null);
                  }
                  if (value.substanceId !== input.substanceId) {
                    setCalculationStarted(false);
                    const preparedSource = defaultSourceForSubstance(value.substanceId);
                    if (preparedSource !== undefined) {
                      const density =
                        SUBSTANCES.find(
                          (item) => item.id === preparedSource.substanceId,
                        )?.densityLiquidTPerM3 ?? 0;
                      setSource(preparedSource);
                      setInput({
                        ...value,
                        massT: massFromCapacity(
                          preparedSource.volumeM3,
                          density,
                        ),
                        spillKind: preparedSource.spillKind,
                        bundHeightM: preparedSource.bundHeightM,
                        commonBundAreaM2: preparedSource.commonBundAreaM2,
                      });
                      return;
                    }
                    const substance = SUBSTANCES.find(
                      (item) => item.id === value.substanceId,
                    );
                    const defaultConversion =
                      substance?.densityLiquidTPerM3 ?? 0;
                    setSource({
                      id: `custom-${value.substanceId}`,
                      kind: "tank",
                      label: `${substance?.name ?? "АХОВ"} — ёмкость`,
                      substanceId: value.substanceId,
                      volumeM3: 0,
                      spillKind: value.spillKind,
                      bundHeightM: value.bundHeightM,
                      commonBundAreaM2: value.commonBundAreaM2,
                      calculationMode: "vessel",
                      conversionTPerM3: defaultConversion,
                      pipelineLengthM: 0,
                      pipelineDiameterMm: 0,
                      imageDataUrl: "/assets/sources/generic-vessel.png",
                    });
                    setInput({ ...value, massT: 0 });
                    return;
                  }
                  setInput(value);
                }}
                onFetchWeather={() => void getWeather()}
                onManualWeather={() => {
                  setWeather(null);
                  setWeatherError(null);
                  setNotice(
                    "Включён ручной ввод погоды. Поля доступны для изменения.",
                  );
                }}
                weatherBusy={weatherBusy}
                weather={weather}
                weatherError={weatherError}
                calculationStarted={calculationStarted}
                sourceControls={
                  <SourcePalette
                    selected={source}
                    onSelect={configureSource}
                    onConfigure={configureSource}
                  />
                }
                onOpenSubstance={(un) => {
                  setGoodsQuery(un);
                  setTab("goods");
                }}
                onCalculate={() => {
                  setCalculationStarted(true);
                  setCalculationRevision((current) => current + 1);
                  setNotice("Расчёт выполнен и автоматически проверен.");
                }}
              />
            </div>
            <MapCanvas
              result={calculation.result}
              calculationStarted={calculationStarted}
              calculationRevision={calculationRevision}
              sourcePlaced={sourcePlaced}
              sourcePoint={effectiveInput.sourcePoint}
              sourceLabel={source.label}
              sourceKind={source.kind}
              sourceImageDataUrl={source.imageDataUrl}
              windFromDegrees={effectiveInput.windFromDegrees}
              windSpeedMps={effectiveInput.windSpeedMps}
              controls={controls}
              districtObjects={districtProject.published}
              basemap={basemap}
              onBasemapChange={(value) => {
                remember("Переключена подложка карты");
                setBasemap(value);
              }}
              onSourceDragStart={() => remember("Перемещён источник аварии")}
              onSourceChange={(point) => {
                setWeather(null);
                setInput((current) => ({ ...current, sourcePoint: point }));
              }}
              onSourceDelete={() => {
                remember(`Удалён источник «${source.label}»`);
                setSourcePlaced(false);
                setCalculationStarted(false);
              }}
              onSourceDrop={(dropped, point) => {
                if (
                  sourcePlaced &&
                  !window.confirm(
                    `Заменить текущий источник аварии на «${dropped.label}»?`,
                  )
                )
                  return;
                setWeather(null);
                if (dropped.id === "generic") {
                  remember("Размещена точка источника АХОВ");
                  setSource(dropped);
                  setInput((current) => ({ ...current, sourcePoint: point }));
                } else {
                  configureSource(dropped);
                  setInput((current) => ({ ...current, sourcePoint: point }));
                }
                setSourcePlaced(true);
              }}
              onControlDrop={addControl}
              onControlDragStart={(control) =>
                remember(`Перемещена точка «${control.name}»`)
              }
              onControlChange={(id, point) =>
                setControls((current) =>
                  current.map((control) =>
                    control.id === id ? { ...control, point } : control,
                  ),
                )
              }
              onControlDelete={(control) => {
                remember(`Удалена точка «${control.name}»`);
                setControls((current) =>
                  current.filter((item) => item.id !== control.id),
                );
              }}
              controlFocus={controlFocus}
              districtFocus={districtFocus}
            />
            <aside className="right-column">
              <ResultsPanel
                result={calculation.result}
                verification={verification}
                error={calculation.error}
                calculationStarted={calculationStarted}
                reportBusy={reportBusy}
                onOpenTrace={() => setTraceOpen(true)}
                onOpenReport={() => setReportOpen(true)}
              />
              <ControlPalette onAdd={(template) => {
                const sequence = controls.length + 1;
                const offset = 0.0022 * sequence;
                addControl(template, {
                  latitude: effectiveInput.sourcePoint.latitude - offset * 0.45,
                  longitude: effectiveInput.sourcePoint.longitude + offset,
                });
              }}>
                {(controls.length > 0 || rescueServiceWarning !== null) && (
                  <div className="controls-list inline-controls-list">
                    <div className="section-heading">
                      <h2>{rescueServiceWarning === null ? 'Выставленные точки' : 'Точки и предупреждения'}</h2>
                      {controls.length > 0 && <button
                        className="link"
                        onClick={() => {
                          remember("Удалены контрольные точки");
                          setControls([]);
                        }}
                      >
                        Очистить
                      </button>}
                    </div>
                    {rescueServiceWarning !== null && (() => {
                      const minutes = rescueServiceWarning.status.arrivalMinutesAfterAccident;
                      const arrival = rescueServiceWarning.status.arrivalTimeIso === null ? null : new Date(rescueServiceWarning.status.arrivalTimeIso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                      const inZone = rescueServiceWarning.status.reachedByForecast;
                      const focus = () => setDistrictFocus({ id: rescueServiceWarning.building.id, revision: Date.now() });
                      return <article
                        className={`placed-control-row automatic-ass-warning status-${inZone ? 'danger' : 'future'}`}
                        role="button"
                        tabIndex={0}
                        aria-label="Показать здание АСС на карте"
                        onClick={focus}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focus(); } }}
                      >
                        <span className="ass-warning-badge">АСС</span>
                        <div><strong>Внимание! Здание АСС {inZone ? 'находится в зоне заражения' : 'попадёт в зону заражения'}</strong><small><span>{round(rescueServiceWarning.status.distanceKm, 2)} км от источника</span><span>{inZone ? `Облако достигло здания через ${minutes} мин${arrival === null ? '' : ` · ${arrival}`}` : `Ожидается через ${minutes} мин${arrival === null ? '' : ` · ${arrival}`}`}</span></small></div>
                      </article>;
                    })()}
                    {controls.map((control) => {
                      const status =
                        calculation.result === null
                          ? null
                          : evaluateControlPoint(
                              calculation.result,
                              control.point,
                            );
                      const arrival =
                        status?.arrivalTimeIso == null
                          ? null
                          : new Date(status.arrivalTimeIso).toLocaleTimeString(
                              "ru-RU",
                              { hour: "2-digit", minute: "2-digit" },
                            );
                      const minutes =
                        status?.arrivalMinutesAfterAccident ?? null;
                      const stateClass =
                        status === null
                          ? "pending"
                          : status.reachedByForecast
                            ? "danger"
                            : status.willBeAffected
                              ? "future"
                              : "safe";
                      const distanceText =
                        status === null
                          ? "Расстояние — после расчёта"
                          : `${round(status.distanceKm, 2)} км`;
                      const statusText =
                        status === null
                          ? "Ожидает расчёта"
                          : status.reachedByForecast
                            ? `В зоне · подошло через ${minutes} мин · ${arrival}`
                            : status.willBeAffected
                              ? `Угроза через ${minutes} мин · ${arrival}`
                              : "Вне полной зоны · угрозы нет";
                      return (
                        <article
                          className={`placed-control-row status-${stateClass}`}
                          key={control.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Показать ${control.name} на карте`}
                          onClick={() => setControlFocus({ id: control.id, revision: Date.now() })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setControlFocus({ id: control.id, revision: Date.now() });
                            }
                          }}
                        >
                          <BuildingIcon
                            kind={control.kind ?? "administrative"}
                            compact
                          />
                          <div>
                            <strong>{control.name}</strong>
                            <small>
                              <span>{distanceText}</span>
                              <span>{statusText}</span>
                            </small>
                          </div>
                          <button
                            aria-label={`Удалить ${control.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              remember(`Удалена точка «${control.name}»`);
                              setControls((current) =>
                                current.filter(
                                  (item) => item.id !== control.id,
                                ),
                              );
                            }}
                          >
                            ×
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </ControlPalette>
            </aside>
          </div>
        </>
      )}
      {traceOpen && calculation.result !== null && verification !== null && (
        <TraceDialog
          result={calculation.result}
          verification={verification}
          onClose={() => setTraceOpen(false)}
        />
      )}
      {reportOpen && calculation.result !== null && verification !== null && (
        <div
          className="dialog-backdrop report-choice-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !reportBusy)
              setReportOpen(false);
          }}
        >
          <section
            className="report-choice"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-choice-title"
          >
            <button
              className="dialog-close"
              aria-label="Закрыть"
              disabled={reportBusy}
              onClick={() => setReportOpen(false)}
            >
              <UiIcon name="close" />
            </button>
            <h2 id="report-choice-title">Сформировать отчёт</h2>
            <p>
              {reportBusy
                ? "Формируется схема карты и документ…"
                : "Выберите формат файла. Отчёт содержит исходные данные, результаты, ход расчёта и приложение со схемой на местности."}
            </p>
            <div>
              <button
                className="report-format pdf"
                disabled={reportBusy}
                onClick={() => void exportReport("pdf")}
              >
                <strong>PDF</strong>
                <span>Готовый документ для просмотра и печати</span>
              </button>
              <button
                className="report-format word"
                disabled={reportBusy}
                onClick={() => void exportReport("word")}
              >
                <strong>Word</strong>
                <span>Редактируемый документ DOCX</span>
              </button>
            </div>
          </section>
        </div>
      )}
      <MobileAccessDialog
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      {adminLoginOpen && (
        <div className="dialog-backdrop admin-login-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdminLoginOpen(false); }}>
          <form
            className="admin-login-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              (() => {
                try {
                  if (adminPassword !== MAP_ADMIN_PASSWORD) throw new Error("Неверный пароль администратора.");
                  adminCredentialRef.current = { password: adminPassword, sessionToken: "" };
                  setDistrictAdmin(true);
                  setDistrictManagementOpen(true);
                  setAdminLoginOpen(false);
                  setTab("district");
                  void authenticateMapAdmin(adminPassword).then((authenticated) => {
                    adminCredentialRef.current = authenticated.credential;
                    setMapSyncStatus(authenticated.status);
                  }).catch(() => undefined);
                  if (pendingDistrictOperationsRef.current.length > 0) void publishPendingDistrictProject();
                } catch (error) {
                  setAdminPasswordError(message(error));
                }
              })();
            }}
          >
            <button type="button" className="dialog-close" aria-label="Закрыть" onClick={() => setAdminLoginOpen(false)}><UiIcon name="close" /></button>
            <div className="admin-login-icon"><UiIcon name="settings" /></div>
            <h2>Настройка карты</h2>
            <p>Введите общий пароль администратора, чтобы добавлять и редактировать объекты.</p>
            <label>Пароль<input autoFocus type="password" value={adminPassword} onChange={(event) => { setAdminPassword(event.currentTarget.value); setAdminPasswordError(""); }} /></label>
            {adminPasswordError !== "" && <p className="admin-login-error">{adminPasswordError}</p>}
            <button className="primary" type="submit">Войти в режим настройки</button>
          </form>
        </div>
      )}
      <footer className="statusbar">
        <span>ХИМКОНТУР · v{packageInformation.version} (база от {new Date(districtProject.publishedAtIso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })})</span>
        <span className={`status-ready district-sync-${districtSyncState}`}>
          {districtSyncState === "ready" ? "● Данные синхронизированы" : districtSyncState === "publishing" ? "● Публикация данных…" : districtSyncState === "pending" ? "● Ожидает публикации" : "● Нет связи с базой"}
        </span>
        <span>
          {new Date().toLocaleDateString("ru-RU")} ·{" "}
          {new Date().toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </footer>
    </div>
  );
}
