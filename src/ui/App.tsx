import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { calculate } from "../core/calculation";
import { verifyCalculation } from "../core/verifier";
import { fetchWeather, type WeatherObservation } from "../core/weather";
import type { CalculationInput } from "../core/types";
import {
  loadScenarioFile,
  saveScenario,
  saveScenarioFile,
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

type Tab = "calculation" | "goods";
type Theme = "light" | "dark";
type Snapshot = Readonly<{
  input: CalculationInput;
  source: SourceConfiguration;
  sourcePlaced: boolean;
  controls: readonly ControlPoint[];
  basemap: Basemap;
}>;

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
  const [input, setInput] = useState<CalculationInput>(DEFAULT_INPUT);
  const [source, setSource] = useState<SourceConfiguration>(DEFAULT_SOURCE);
  const [sourcePlaced, setSourcePlaced] = useState(true);
  const [controls, setControls] = useState<readonly ControlPoint[]>([]);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [calculationStarted, setCalculationStarted] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [weather, setWeather] = useState<WeatherObservation | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [, setNotice] = useState<string | null>(null);
  const pastRef = useRef<{ snapshot: Snapshot; label: string }[]>([]);
  const futureRef = useRef<{ snapshot: Snapshot; label: string }[]>([]);
  const openFileRef = useRef<HTMLInputElement>(null);
  const [, setHistoryRevision] = useState(0);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("himkontur-theme", theme);
  }, [theme]);

  const snapshot = (): Snapshot => ({
    input,
    source,
    sourcePlaced,
    controls,
    basemap,
  });
  const remember = (label: string) => {
    pastRef.current = [
      ...pastRef.current.slice(-49),
      { snapshot: snapshot(), label },
    ];
    futureRef.current = [];
    setHistoryRevision((value) => value + 1);
  };
  const applySnapshot = (value: Snapshot) => {
    setInput(value.input);
    setSource(value.source);
    setSourcePlaced(value.sourcePlaced);
    setControls(value.controls);
    setBasemap(value.basemap);
  };
  const undo = () => {
    const item = pastRef.current.at(-1);
    if (item === undefined) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [
      { snapshot: snapshot(), label: item.label },
      ...futureRef.current,
    ];
    applySnapshot(item.snapshot);
    setNotice(`Отменено: ${item.label}.`);
    setHistoryRevision((value) => value + 1);
  };
  const redo = () => {
    const item = futureRef.current[0];
    if (item === undefined) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [
      ...pastRef.current,
      { snapshot: snapshot(), label: item.label },
    ];
    applySnapshot(item.snapshot);
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

  const store = async () => {
    try {
      const value = {
        input: effectiveInput,
        controls,
        sourceLabel: source.label,
        sourceConfiguration: source,
        sourcePlaced,
        basemap,
      };
      await saveScenarioFile(value);
      await saveScenario(value);
      setNotice("Сценарий сохранён в локальной базе этого устройства.");
    } catch (error) {
      setNotice(`Сохранение не выполнено: ${message(error)}`);
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
  const chooseScenarioFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file !== undefined) void restore(file);
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
      const { captureMapForReport } = await import("./map-report-capture");
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
      const exporter = await import("./report-export");
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

  return (
    <div className="app-shell" data-theme={theme}>
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
        </nav>
        <div className="file-actions">
          <button className="new-calculation" title="Новый расчёт" onClick={newCalculation}>
            <UiIcon name="new" />
            <span className="action-label">Новый расчёт</span>
          </button>
          <button title="Открыть расчёт" onClick={() => openFileRef.current?.click()}>
            <UiIcon name="open" />
            <span className="action-label">Открыть расчёт</span>
          </button>
          <button title="Сохранить расчёт" onClick={() => void store()}>
            <UiIcon name="save" />
            <span className="action-label">Сохранить расчёт</span>
          </button>
          <button
            className="mobile-access-action"
            title="Загрузить приложение"
            aria-label="Загрузить приложения ХИМКОНТУР"
            onClick={() => setMobileOpen(true)}
          >
            <UiIcon name="qr" />
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
          <input
            ref={openFileRef}
            className="scenario-file-input"
            type="file"
            accept=".himkontur,.json,application/json"
            onChange={chooseScenarioFile}
          />
        </div>
        <div className="theme-switch" aria-label="Тема оформления">
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
        <DangerousGoodsPanel initialQuery={goodsQuery} />
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
                    if (value.substanceId === "chlorine") {
                      const density =
                        SUBSTANCES.find(
                          (item) => item.id === DEFAULT_SOURCE.substanceId,
                        )?.densityLiquidTPerM3 ?? 0;
                      setSource(DEFAULT_SOURCE);
                      setInput({
                        ...value,
                        massT: massFromCapacity(
                          DEFAULT_SOURCE.volumeM3,
                          density,
                        ),
                        spillKind: DEFAULT_SOURCE.spillKind,
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
                    input={effectiveInput}
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
                  setNotice("Расчёт выполнен и автоматически проверен.");
                }}
              />
            </div>
            <MapCanvas
              result={calculation.result}
              calculationStarted={calculationStarted}
              sourcePlaced={sourcePlaced}
              sourcePoint={effectiveInput.sourcePoint}
              sourceLabel={source.label}
              sourceKind={source.kind}
              sourceImageDataUrl={source.imageDataUrl}
              windFromDegrees={effectiveInput.windFromDegrees}
              windSpeedMps={effectiveInput.windSpeedMps}
              controls={controls}
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
              <ControlPalette>
                {controls.length > 0 && (
                  <div className="controls-list inline-controls-list">
                    <div className="section-heading">
                      <h2>Выставленные точки</h2>
                      <button
                        className="link"
                        onClick={() => {
                          remember("Удалены контрольные точки");
                          setControls([]);
                        }}
                      >
                        Очистить
                      </button>
                    </div>
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
                            onClick={() => {
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
              ×
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
      <footer className="statusbar">
        <span>ХИМКОНТУР · v0.2.1</span>
        <span className="status-ready">● Готов к расчёту</span>
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
