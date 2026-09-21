import { useEffect, useState } from "react";
import QRCode from "qrcode";

type Props = Readonly<{ open: boolean; onClose: () => void }>;

const RELEASE_ROOT =
  "https://github.com/stas07130713-debug/himkontur/releases/latest/download";
const ANDROID_DOWNLOAD =
  (import.meta.env.VITE_ANDROID_DOWNLOAD_URL as string | undefined)?.trim() ||
  `${RELEASE_ROOT}/HIMKONTUR-Android.apk`;
const WINDOWS_DOWNLOAD =
  (import.meta.env.VITE_WINDOWS_DOWNLOAD_URL as string | undefined)?.trim() ||
  `${RELEASE_ROOT}/HIMKONTUR-Windows-Setup.exe`;

function DownloadMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="download-mark-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#2adbd0" />
          <stop offset="1" stopColor="#04889a" />
        </linearGradient>
      </defs>
      <path className="download-mark-triangle" d="M31 5 6 51c-2 4 1 8 5 8h16l7-12H20l17-31-6-11Zm9 8 14 24H30l10-17 5 8h-3l-5 9h22L45 13h-5Z" />
      <path className="download-mark-cloud" d="M30 51h20a7 7 0 0 0 1-14 11 11 0 0 0-21 3 6 6 0 0 0 0 11Z" />
      <path className="download-mark-arrow" d="M40 31v13m-5-5 5 5 5-5" />
    </svg>
  );
}

export function MobileAccessDialog({ open, onClose }: Props) {
  const [qr, setQr] = useState("");

  useEffect(() => {
    if (!open) {
      setQr("");
      return;
    }
    void QRCode.toDataURL(ANDROID_DOWNLOAD, {
      width: 420,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#063746", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(""));
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="dialog-backdrop mobile-access-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="mobile-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-access-title"
      >
        <button className="dialog-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        <div className="mobile-dialog-heading">
          <span className="mobile-dialog-icon"><DownloadMark /></span>
          <div>
            <h2 id="mobile-access-title">Загрузить ХИМКОНТУР</h2>
            <p>Установочные файлы автономных приложений для телефона и Windows.</p>
          </div>
        </div>

        <div className="mobile-download-layout">
          <div className="mobile-qr-block">
            <h3>Приложение для Android</h3>
            <p>Наведите камеру телефона: QR-код сразу открывает загрузку APK.</p>
            <div className="mobile-qr-frame">
              {qr ? (
                <img src={qr} alt="QR-код прямой загрузки ХИМКОНТУР для Android" />
              ) : (
                <span className="branded-download-progress"><DownloadMark />Подготавливается QR-код…</span>
              )}
            </div>
            <a className="application-download android" href={ANDROID_DOWNLOAD}>
              <DownloadMark />
              <span><strong>Скачать для Android</strong><small>Установочный файл APK</small></span>
            </a>
          </div>

          <div className="desktop-download-block">
            <h3>Приложение для Windows</h3>
            <p>Полная автономная версия для компьютера.</p>
            <a className="application-download windows" href={WINDOWS_DOWNLOAD}>
              <DownloadMark />
              <span><strong>Скачать для Windows</strong><small>Установочный файл EXE</small></span>
            </a>
          </div>
        </div>

        <small className="mobile-offline-note">
          Это загрузка самостоятельных приложений, а не переход в веб-версию.
          Интернет требуется для скачивания установочного файла и получения погоды.
        </small>
      </section>
    </div>
  );
}
