package ru.ahov.forecast;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HimkonturUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
