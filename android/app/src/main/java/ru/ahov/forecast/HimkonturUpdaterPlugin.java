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
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "HimkonturUpdater")
public class HimkonturUpdaterPlugin extends Plugin {
    private static final String RELEASE_API = "https://api.github.com/repos/stas07130713-debug/himkontur/releases/latest";

    @PluginMethod
    public void getVersion(PluginCall call) {
        JSObject result = new JSObject();
        result.put("version", installedVersion());
        result.put("code", installedVersionCode());
        call.resolve(result);
    }

    @PluginMethod
    public void checkUpdate(PluginCall call) {
        getBridge().execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(RELEASE_API).openConnection();
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(30_000);
                // The endpoint always represents the newest stable release.
                // Never reuse an earlier response: a device may have skipped
                // several versions and must jump straight to the current one.
                connection.setUseCaches(false);
                connection.setRequestProperty("Cache-Control", "no-cache, no-store, max-age=0");
                connection.setRequestProperty("Pragma", "no-cache");
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                connection.setRequestProperty("User-Agent", "HIMKONTUR-Android/" + installedVersion());
                connection.connect();
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);

                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) body.append(line);
                }
                JSONObject release = new JSONObject(body.toString());
                JSONArray sourceAssets = release.getJSONArray("assets");
                JSONArray assets = new JSONArray();
                for (int index = 0; index < sourceAssets.length(); index++) {
                    JSONObject sourceAsset = sourceAssets.getJSONObject(index);
                    String name = sourceAsset.optString("name", "");
                    if (!name.matches("(?iu)HIMKONTUR.*Android.*\\.apk")) continue;
                    JSONObject asset = new JSONObject();
                    asset.put("name", name);
                    asset.put("browser_download_url", sourceAsset.getString("browser_download_url"));
                    assets.put(asset);
                }
                JSObject result = new JSObject();
                result.put("tag_name", release.getString("tag_name"));
                result.put("assets", assets);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Сервер обновлений недоступен. Проверьте подключение к интернету.", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
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
