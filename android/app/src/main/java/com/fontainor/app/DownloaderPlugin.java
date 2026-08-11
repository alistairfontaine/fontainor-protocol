package com.fontainor.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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

    @Override
    public void load() {
        super.load();
        DownloadService.setReporter(reporter);
    }

    @Override
    protected void handleOnDestroy() {
        DownloadService.setReporter(null);
        super.handleOnDestroy();
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
}
