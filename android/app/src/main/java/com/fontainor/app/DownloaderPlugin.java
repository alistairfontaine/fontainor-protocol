package com.fontainor.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.Map;

import org.json.JSONObject;

/**
 * WebView side of the offline-download foreground service.
 *
 * JS asks for a download, the SERVICE performs it (so it keeps running when the
 * app is backgrounded) and reports back through this plugin as Capacitor
 * events: `downloadProgress`, `downloadComplete`, `downloadFailed`,
 * `downloadCancelled`. Paths are relative to filesDir === Capacitor's
 * Directory.Data, so the JS download index, the playability check and file
 * removal all keep working through @capacitor/filesystem unchanged.
 *
 * The JS layer feature-detects this plugin (Capacitor.isPluginAvailable) and
 * falls back to Filesystem.downloadFile, so an older shell still works.
 */
@CapacitorPlugin(name = "FontainorDownloads")
public class DownloaderPlugin extends Plugin {
    private static final String COMPLETED_PREFS = "fontainor_download_results_v1";

    private final DownloadService.Reporter reporter = new DownloadService.Reporter() {
        @Override
        public void progress(String id, long bytes, long total) {
            JSObject d = new JSObject();
            d.put("id", id);
            d.put("bytes", bytes);
            d.put("total", total);
            notifyListeners("downloadProgress", d);
        }

        @Override
        public void done(String id, String path, long bytes) {
            JSObject d = new JSObject();
            d.put("id", id);
            d.put("path", path);
            d.put("bytes", bytes);
            notifyListeners("downloadComplete", d);
        }

        @Override
        public void failed(String id, String message) {
            JSObject d = new JSObject();
            d.put("id", id);
            d.put("message", message);
            notifyListeners("downloadFailed", d);
        }

        @Override
        public void cancelled(String id) {
            JSObject d = new JSObject();
            d.put("id", id);
            notifyListeners("downloadCancelled", d);
        }
    };

    /** Fires networkStatusChanged so the JS Wi-Fi-only queue can auto-resume. */
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void load() {
        super.load();
        DownloadService.setReporter(reporter);
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                    JSObject d = new JSObject();
                    d.put("connected", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
                    d.put("metered", !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
                    notifyListeners("networkStatusChanged", d);
                }

                @Override
                public void onLost(Network network) {
                    JSObject d = new JSObject();
                    d.put("connected", false);
                    d.put("metered", true);
                    notifyListeners("networkStatusChanged", d);
                }
            };
            try {
                cm.registerDefaultNetworkCallback(networkCallback);
            } catch (Exception e) {
                networkCallback = null; // too many callbacks / SecurityException: polling via isMetered still works
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        DownloadService.setReporter(null);
        if (networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                try {
                    cm.unregisterNetworkCallback(networkCallback);
                } catch (Exception ignored) {
                    /* already unregistered */
                }
            }
            networkCallback = null;
        }
        super.handleOnDestroy();
    }

    /**
     * Is the active connection metered (mobile data / metered hotspot)?
     * The JS layer fails OPEN when this method is missing (older shell), so the
     * answer here only ever tightens behaviour, never blocks downloads.
     */
    @PluginMethod
    public void isMetered(PluginCall call) {
        boolean connected = false;
        boolean metered = true;
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            Network n = cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            metered = cm.isActiveNetworkMetered();
        }
        JSObject ret = new JSObject();
        ret.put("connected", connected);
        ret.put("metered", metered);
        call.resolve(ret);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        String path = call.getString("path");
        String title = call.getString("title", "");
        if (id == null || id.isEmpty() || url == null || url.isEmpty() || path == null || path.isEmpty()) {
            call.reject("id, url and path are required");
            return;
        }
        Intent i = new Intent(getContext(), DownloadService.class)
                .setAction(DownloadService.ACTION_START)
                .putExtra(DownloadService.EXTRA_ID, id)
                .putExtra(DownloadService.EXTRA_URL, url)
                .putExtra(DownloadService.EXTRA_PATH, path)
                .putExtra(DownloadService.EXTRA_TITLE, title);
        // Started from the Activity that handled the tap: Android 14+ allows a
        // dataSync foreground service exactly in that window. If the app is not
        // in that window (Android 8+ background-start restriction), say so
        // instead of letting an IllegalStateException reach the WebView — the JS
        // layer treats a rejection as a normal download failure and retries.
        try {
            getContext().startService(i);
        } catch (Exception e) {
            String msg = e.getMessage();
            call.reject(msg == null || msg.isEmpty() ? "Could not start the download service." : msg);
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        Intent i = new Intent(getContext(), DownloadService.class).setAction(DownloadService.ACTION_CANCEL);
        if (id != null && !id.isEmpty()) i.putExtra(DownloadService.EXTRA_ID, id);
        try {
            getContext().startService(i);
        } catch (Exception e) {
            /* the service is already gone: nothing to cancel */
        }
        call.resolve();
    }

    /**
     * Drain service completions that happened while the WebView was dead.
     * Rows remain until JS acknowledges each one after verifying/stat'ing the
     * file and committing the authoritative metadata index.
     */
    @PluginMethod
    public void takeCompleted(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(COMPLETED_PREFS, Context.MODE_PRIVATE);
        com.getcapacitor.JSArray rows = new com.getcapacitor.JSArray();
        for (Map.Entry<String, ?> item : prefs.getAll().entrySet()) {
            if (!(item.getValue() instanceof String)) continue;
            try {
                JSONObject row = new JSONObject((String) item.getValue());
                String path = row.optString("path", "");
                if (!path.isEmpty() && new File(getContext().getFilesDir(), path).isFile()) rows.put(row);
            } catch (Exception ignored) {
                /* malformed journal row is ignored */
            }
        }
        JSObject ret = new JSObject();
        ret.put("entries", rows);
        call.resolve(ret);
    }

    /** Remove journal rows only after JS has durably saved their index rows. */
    @PluginMethod
    public void acknowledgeCompleted(PluginCall call) {
        com.getcapacitor.JSArray ids = call.getArray("ids");
        if (ids == null) {
            call.reject("ids are required");
            return;
        }
        SharedPreferences.Editor edit = getContext()
                .getSharedPreferences(COMPLETED_PREFS, Context.MODE_PRIVATE)
                .edit();
        try {
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.getString(i);
                if (id != null && !id.isEmpty()) edit.remove(id);
            }
        } catch (Exception e) {
            call.reject("invalid ids");
            return;
        }
        edit.apply();
        call.resolve();
    }
}
