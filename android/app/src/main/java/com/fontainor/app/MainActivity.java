package com.fontainor.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int REQUEST_POST_NOTIFICATIONS = 7001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom in-app plugins must be registered before the bridge boots.
        registerPlugin(MwaPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 13+: the media playback notification (lock-screen player
        // controls) needs the runtime notification permission.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_POST_NOTIFICATIONS);
        }
    }
}
