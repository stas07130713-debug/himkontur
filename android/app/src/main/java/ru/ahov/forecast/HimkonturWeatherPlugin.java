package ru.ahov.forecast;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "HimkonturWeather")
public class HimkonturWeatherPlugin extends Plugin {
    private static final String PROJECT_EOL_ENDPOINT = "https://weatherapi.projecteol.ru/mcp/";

    @PluginMethod
    public void getForecast(PluginCall call) {
        Double latitude = call.getDouble("latitude");
        Double longitude = call.getDouble("longitude");
        String start = call.getString("start", "");
        Integer requestedHours = call.getInt("hours", 4);
        int hours = Math.max(1, Math.min(12, requestedHours == null ? 4 : requestedHours));
        if (latitude == null || latitude < -90 || latitude > 90
            || longitude == null || longitude < -180 || longitude > 180) {
            call.reject("Некорректные координаты для получения погоды.");
            return;
        }
        if (!start.matches("^\\d{4}-\\d{2}-\\d{2}T.+Z$")) {
            call.reject("Некорректное время для получения погоды.");
            return;
        }

        getBridge().execute(() -> requestForecast(call, latitude, longitude, start, hours));
    }

    private void requestForecast(PluginCall call, double latitude, double longitude, String start, int hours) {
        HttpURLConnection connection = null;
        try {
            JSONObject arguments = new JSONObject();
            arguments.put("latitude", latitude);
            arguments.put("longitude", longitude);
            arguments.put("start", start);
            arguments.put("hours", hours);
            arguments.put("parameters", new JSONArray()
                .put("air_temperature_2m")
                .put("wind_speed_10m")
                .put("wind_direction_10m")
                .put("cloud_area_fraction")
                .put("surface_snow_thickness"));
            arguments.put("interpolation", "linear");

            JSONObject params = new JSONObject();
            params.put("name", "get_weather_forecast");
            params.put("arguments", arguments);

            JSONObject request = new JSONObject();
            request.put("jsonrpc", "2.0");
            request.put("id", "himkontur-" + System.currentTimeMillis());
            request.put("method", "tools/call");
            request.put("params", params);

            connection = (HttpURLConnection) new URL(PROJECT_EOL_ENDPOINT).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8_000);
            connection.setReadTimeout(12_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("User-Agent", "HIMKONTUR-Android");
            byte[] body = request.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            connection.connect();
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            StringBuilder response = new StringBuilder();
            if (stream != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) response.append(line);
                }
            }
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            if (response.length() == 0) throw new IllegalStateException("Пустой ответ погодного сервиса.");
            // Validate JSON before crossing the WebView bridge.
            new JSONObject(response.toString());
            JSObject result = new JSObject();
            result.put("payload", response.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Российский сервис прогноза временно недоступен.", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
