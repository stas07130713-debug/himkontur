package ru.ahov.forecast;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "HimkonturFiles",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class HimkonturFilesPlugin extends Plugin {
    private static final String REPORT_DIRECTORY = "ХИМКОНТУР";

    @PluginMethod
    public void saveReport(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }
        saveReportFile(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            saveReportFile(call);
        } else {
            call.reject("Для сохранения отчёта разрешите доступ к файлам телефона.");
        }
    }

    private void saveReportFile(PluginCall call) {
        final String rawName = call.getString("filename", "Отчёт-ХИМКОНТУР.pdf");
        final String filename = rawName.replaceAll("[\\\\/:*?\"<>|]", "_");
        final String mimeType = call.getString("mimeType", "application/octet-stream");
        final String encoded = call.getString("data", "");
        if (encoded.isEmpty()) {
            call.reject("Файл отчёта пуст.");
            return;
        }

        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), "Сохраняем отчёт…", Toast.LENGTH_SHORT).show());
        getBridge().execute(() -> {
            Uri uri = null;
            try {
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                String location = "Загрузки/" + REPORT_DIRECTORY + "/" + filename;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContext().getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + REPORT_DIRECTORY);
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new IllegalStateException("Не удалось создать файл в папке загрузок.");
                    try (OutputStream output = resolver.openOutputStream(uri, "w")) {
                        if (output == null) throw new IllegalStateException("Не удалось открыть файл отчёта.");
                        output.write(bytes);
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver.update(uri, values, null, null);
                } else {
                    File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), REPORT_DIRECTORY);
                    if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Не удалось создать папку отчётов.");
                    try (FileOutputStream output = new FileOutputStream(new File(directory, filename))) {
                        output.write(bytes);
                    }
                }
                JSObject result = new JSObject();
                result.put("location", location);
                call.resolve(result);
                getActivity().runOnUiThread(() -> Toast.makeText(getContext(), "Отчёт сохранён: " + location, Toast.LENGTH_LONG).show());
            } catch (Exception error) {
                if (uri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    getContext().getContentResolver().delete(uri, null, null);
                }
                call.reject("Не удалось сохранить отчёт в память телефона.", error);
            }
        });
    }
}
