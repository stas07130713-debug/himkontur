import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

type Props = Readonly<{ open: boolean; onClose: () => void }>;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function initialAddress(): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  if (configured?.trim()) return configured.trim();
  const saved = window.localStorage.getItem("himkontur-mobile-url");
  if (saved?.trim()) return saved.trim();
  if (!LOCAL_HOSTS.has(window.location.hostname))
    return new URL(".", window.location.href).href;
  return "";
}

export function MobileAccessDialog({ open, onClose }: Props) {
  const [address, setAddress] = useState(initialAddress);
  const [qr, setQr] = useState("");
  const normalizedAddress = useMemo(() => {
    const value = address.trim();
    if (!value) return "";
    try {
      return new URL(value).href;
    } catch {
      return "";
    }
  }, [address]);

  useEffect(() => {
    if (!open || !normalizedAddress) {
      setQr("");
      return;
    }
    window.localStorage.setItem("himkontur-mobile-url", normalizedAddress);
    void QRCode.toDataURL(normalizedAddress, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#063746", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(""));
  }, [normalizedAddress, open]);

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
          <span className="mobile-dialog-icon">▣</span>
          <div>
            <h2 id="mobile-access-title">Поделиться QR-кодом</h2>
            <p>
              Откройте ХИМКОНТУР на телефоне и закрепите его как приложение.
            </p>
          </div>
        </div>
        {normalizedAddress ? (
          <>
            <div className="mobile-qr-frame">
              {qr ? (
                <img src={qr} alt="QR-код мобильной версии ХИМКОНТУР" />
              ) : (
                <span>Создаётся QR-код…</span>
              )}
            </div>
            <a
              className="mobile-address"
              href={normalizedAddress}
              target="_blank"
              rel="noreferrer"
            >
              {normalizedAddress}
            </a>
          </>
        ) : (
          <div className="mobile-address-needed">
            Сначала опубликуйте приложение на GitHub Pages и вставьте полученную
            ссылку ниже. Локальный адрес компьютера недоступен телефону.
          </div>
        )}
        <label className="mobile-url-field">
          Адрес опубликованного приложения
          <input
            value={address}
            inputMode="url"
            placeholder="https://имя.github.io/himkontur/"
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        {address.trim() && !normalizedAddress && (
          <p className="mobile-url-error">
            Введите полный адрес, начинающийся с https://
          </p>
        )}
        <ol className="mobile-install-steps">
          <li>Наведите камеру телефона на QR-код и откройте ссылку.</li>
          <li>
            <strong>Android:</strong> меню браузера → «Установить приложение».
          </li>
          <li>
            <strong>iPhone:</strong> Safari → «Поделиться» → «На экран Домой».
          </li>
        </ol>
        <small className="mobile-offline-note">
          После первого полного открытия основные функции и автономный
          справочник доступны без сети. Для загрузки новых карт и погоды
          интернет всё равно нужен.
        </small>
      </section>
    </div>
  );
}
