package com.lerne.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OfflineBackupFilePlugin.class);
        registerPlugin(OfflineMaterialArchivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
