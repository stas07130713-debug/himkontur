package ru.ahov.forecast;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HimkonturUpdaterPlugin.class);
        registerPlugin(HimkonturFilesPlugin.class);
        registerPlugin(HimkonturOcrPlugin.class);
        registerPlugin(HimkonturWeatherPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
