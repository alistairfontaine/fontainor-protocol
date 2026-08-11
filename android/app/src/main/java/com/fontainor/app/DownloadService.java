package com.fontainor.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Offline downloads that survive leaving the app.
 *
 * Why this exists: downloads used to run inside the WebView's own process work
 * (@capacitor/filesystem's downloadFile). The moment the user pressed Home or
 * the screen locked, Android was free to freeze or kill that process — a 6 MB
 * track over a slow mobile connection is exactly the case where the user
 * switches away, so downloads silently died half-finished. An album could not
 * be saved without babysitting the screen.
 *
 * A foreground service is Android's contract for "keep working, the user asked
 * for this and can see it": a visible progress notification, a Cancel action,
 * and no background-execution limits. Type is dataSync (API 29+), which is what
 * a user-initiated file transfer is; it is started from a foreground Activity
 * (the Download tap), which Android 14+ requires.
 *
 * Files land in filesDir/<relative path>, i.e. exactly Capacitor's
 * Directory.Data, so the existing JS index, getUri/stat/deleteFile calls and the
 * playability check keep working unchanged. Bytes are streamed to <path>.part
 * and renamed on success, so a half-finished transfer can never be committed as
 * a real download.
 */
public class DownloadService extends Service {

    public static final String ACTION_START = "com.fontainor.app.DOWNLOAD_START";
    public static final String ACTION_CANCEL = "com.fontainor.app.DOWNLOAD_CANCEL";
    public static final String EXTRA_ID = "id";
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_PATH = "path";
    public static final String EXTRA_TITLE = "title";

    private static final String CHANNEL_ID = "fontainor_downloads";
    private static final int NOTIFICATION_ID = 4711;
    private static final long PROGRESS_INTERVAL_MS = 400; // bridge + notification updates
    private static final int BUFFER = 64 * 1024;

    /** Set by DownloaderPlugin so the service can report into the WebView. */
    public interface Reporter {
        void progress(String id, long bytes, long total);

        void done(String id, String path, long bytes);

        void failed(String id, String message);

        void cancelled(String id);
    }

    @Nullable
    private static volatile Reporter reporter;

    public static void setReporter(@Nullable Reporter r) {
        reporter = r;
    }

    /** Live downloads: id -> cancel flag. Also the source of the notification text. */
    private final Map<String, AtomicBoolean> cancelFlags = new ConcurrentHashMap<>();
    private final Map<String, String> titles = Collections.synchronizedMap(new LinkedHashMap<String, String>());
    private final Map<String, int[]> percent = new ConcurrentHashMap<>(); // id -> [pct] (-1 = unknown total)
    private ExecutorService pool;
    private NotificationManager notifications;

    @Override
    public void onCreate() {
        super.onCreate();
        pool = Executors.newFixedThreadPool(2);
        notifications = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent == null) {
            stopIfIdle();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_CANCEL.equals(action)) {
            String id = intent.getStringExtra(EXTRA_ID);
            if (id == null) {
                for (AtomicBoolean f : cancelFlags.values()) f.set(true);
            } else {
                AtomicBoolean f = cancelFlags.get(id);
                if (f != null) f.set(true);
            }
            return START_NOT_STICKY;
        }

        final String id = intent.getStringExtra(EXTRA_ID);
        final String url = intent.getStringExtra(EXTRA_URL);
        final String path = intent.getStringExtra(EXTRA_PATH);
        final String title = intent.getStringExtra(EXTRA_TITLE);
        if (id == null || url == null || path == null) {
            stopIfIdle();
            return START_NOT_STICKY;
        }
        if (cancelFlags.containsKey(id)) return START_NOT_STICKY; // already downloading

        final AtomicBoolean cancelled = new AtomicBoolean(false);
        cancelFlags.put(id, cancelled);
        titles.put(id, title == null ? id : title);
        percent.put(id, new int[]{-1});
        startForegroundSafely();
        pool.execute(new Runnable() {
            @Override
            public void run() {
                performDownload(id, url, path, cancelled);
            }
        });
        return START_NOT_STICKY;
    }

    private void performDownload(String id, String url, String relPath, AtomicBoolean cancelled) {
        File target = new File(getFilesDir(), relPath);
        File part = new File(target.getAbsolutePath() + ".part");
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            finish(id, null, 0, "Could not create the downloads folder.", false);
            return;
        }
        HttpURLConnection conn = null;
        InputStream in = null;
        OutputStream out = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("Accept", "*/*");
            int code = conn.getResponseCode();
            if (code < 200 || code > 299) {
                throw new IllegalStateException("The server answered HTTP " + code + ".");
            }
            long total = conn.getContentLength(); // -1 when unknown (chunked)
            in = conn.getInputStream();
            out = new FileOutputStream(part);
            byte[] buf = new byte[BUFFER];
            long written = 0;
            long lastTick = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                if (cancelled.get()) throw new CancelledException();
                out.write(buf, 0, n);
                written += n;
                long now = SystemClock.elapsedRealtime();
                if (now - lastTick >= PROGRESS_INTERVAL_MS) {
                    lastTick = now;
                    publish(id, written, total);
                }
            }
            out.flush();
            out.close();
            out = null;
            if (target.exists() && !target.delete()) {
                throw new IllegalStateException("Could not replace the existing file.");
            }
            if (!part.renameTo(target)) {
                throw new IllegalStateException("Could not finalize the downloaded file.");
            }
            publish(id, written, written);
            finish(id, relPath, written, null, false);
        } catch (CancelledException e) {
            deleteQuietly(part);
            finish(id, null, 0, null, true);
        } catch (Exception e) {
            deleteQuietly(part);
            String msg = e.getMessage();
            finish(id, null, 0, msg == null || msg.isEmpty() ? e.getClass().getSimpleName() : msg, false);
        } finally {
            closeQuietly(in);
            closeQuietly(out);
            if (conn != null) conn.disconnect();
        }
    }

    private void publish(String id, long bytes, long total) {
        Reporter r = reporter;
        if (r != null) r.progress(id, bytes, total);
        int pct = total > 0 ? (int) Math.min(100, (bytes * 100) / total) : -1;
        int[] cell = percent.get(id);
        if (cell != null) cell[0] = pct;
        updateNotification();
    }

    private void finish(String id, @Nullable String path, long bytes, @Nullable String error, boolean wasCancelled) {
        cancelFlags.remove(id);
        titles.remove(id);
        percent.remove(id);
        Reporter r = reporter;
        if (r != null) {
            if (wasCancelled) r.cancelled(id);
            else if (error != null) r.failed(id, error);
            else r.done(id, path == null ? "" : path, bytes);
        }
        if (cancelFlags.isEmpty()) stopIfIdle();
        else updateNotification();
    }

    // ── notification ────────────────────────────────────────────────────────

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || notifications == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Progress while tracks are saved for offline listening.");
        ch.setShowBadge(false);
        notifications.createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        String title;
        int pct = -1;
        int active = cancelFlags.size();
        synchronized (titles) {
            title = titles.isEmpty() ? "Saving for offline" : titles.values().iterator().next();
            if (!titles.isEmpty()) {
                int[] cell = percent.get(titles.keySet().iterator().next());
                if (cell != null) pct = cell[0];
            }
        }
        String text = active > 1 ? (active + " tracks downloading") : (pct >= 0 ? pct + "%" : "Starting…");

        Intent cancelAll = new Intent(this, DownloadService.class).setAction(ACTION_CANCEL);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent cancelPi = PendingIntent.getService(this, 1, cancelAll, piFlags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setProgress(100, Math.max(pct, 0), pct < 0)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", cancelPi);
        return b.build();
    }

    private boolean foregrounded = false;

    private void startForegroundSafely() {
        Notification n = buildNotification();
        if (!foregrounded) {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
            foregrounded = true;
        } else {
            updateNotification();
        }
    }

    private void updateNotification() {
        if (!foregrounded || notifications == null || cancelFlags.isEmpty()) return;
        notifications.notify(NOTIFICATION_ID, buildNotification());
    }

    private void stopIfIdle() {
        if (!cancelFlags.isEmpty()) return;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        foregrounded = false;
        stopSelf();
    }

    @Override
    public void onDestroy() {
        for (AtomicBoolean f : cancelFlags.values()) f.set(true);
        if (pool != null) pool.shutdownNow();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // start-only service
    }

    private static void deleteQuietly(File f) {
        if (f != null && f.exists()) {
            // best-effort: a leftover .part must never be treated as a download
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    private static void closeQuietly(@Nullable java.io.Closeable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (Exception ignored) {
            /* nothing to do */
        }
    }

    private static class CancelledException extends RuntimeException {
    }
}
