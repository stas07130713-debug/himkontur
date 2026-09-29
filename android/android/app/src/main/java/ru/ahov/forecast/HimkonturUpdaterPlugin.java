package ru.ahov.forecast;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.content.pm.PackageInfo;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

@CapacitorPlugin(name = "HimkonturUpdater")
public class HimkonturUpdaterPlugin extends Plugin {
    @PluginMethod
    public void getVersion(PluginCall call) {
        JSObject result = new JSObject();
        result.put("version", installedVersion());
        result.put("code", installedVersionCode());
        call.resolve(result);
    }

    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls()) {
            JSObject result = new JSObject();
            result.put("allowed", true);
            call.resolve(result);
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        JSObject result = new JSObject();
        result.put("allowed", false);
        call.resolve(result);
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url", "");
        String version = call.getString("version", "update");
        if (!isTrustedApkUrl(url)) {
            call.reject("Разрешена загрузка APK только из официального репозитория ХИМКОНТУР.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("Сначала разрешите установку обновлений для ХИМКОНТУР в открывшихся настройках Android.");
            return;
        }

        getBridge().execute(() -> downloadAndInstall(call, url, version));
    }

    private boolean isTrustedApkUrl(String raw) {
        try {
            URL url = new URL(raw);
            String host = url.getHost().toLowerCase(Locale.ROOT);
            return "https".equals(url.getProtocol())
                && ("github.com".equals(host) || "objects.githubusercontent.com".equals(host))
                && url.getPath().toLowerCase(Locale.ROOT).endsWith(".apk");
        } catch (Exception ignored) {
            return false;
        }
    }

    private void downloadAndInstall(PluginCall call, String rawUrl, String version) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(rawUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(60_000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setRequestProperty("User-Agent", "HIMKONTUR-Android/" + installedVersion());
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);

            File directory = new File(getContext().getCacheDir(), "updates");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Не удалось создать папку обновления.");
            File apk = new File(directory, "HIMKONTUR-" + version.replaceAll("[^0-9A-Za-z._-]", "_") + ".apk");
            long total = connection.getContentLengthLong();
            long downloaded = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read == 0) continue;
                    output.write(buffer, 0, read);
                    downloaded += read;
                    JSObject progress = new JSObject();
                    progress.put("percent", total > 0 ? Math.min(100, Math.round(downloaded * 100f / total)) : -1);
                    notifyListeners("downloadProgress", progress);
                }
            }

            Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(install);
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Не удалось загрузить обновление. Проверьте интернет и повторите.", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private PackageInfo packageInfo() {
        try {
            return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
        } catch (Exception error) {
            throw new IllegalStateException("Не удалось определить версию приложения.", error);
        }
    }

    private String installedVersion() {
        return packageInfo().versionName;
    }

    private long installedVersionCode() {
        PackageInfo info = packageInfo();
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }
}
