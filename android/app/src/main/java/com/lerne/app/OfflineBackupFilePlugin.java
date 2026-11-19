package com.lerne.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Storage Access Framework (SAF) bridge for personal progress backup JSON files.
 * Lets Android users choose local folders or Google Drive via the system picker
 * without requiring OAuth or Google Drive API credentials.
 */
@CapacitorPlugin(name = "OfflineBackupFile")
public class OfflineBackupFilePlugin extends Plugin {

    private static final int MAX_BACKUP_BYTES = 5 * 1024 * 1024;
    private static final String DEFAULT_FILE_NAME = "lerne-offline-progress.json";

    @PluginMethod
    public void saveJsonFile(PluginCall call) {
        String content = call.getString("content");
        if (content == null || content.isEmpty()) {
            call.reject("Backup content must not be empty");
            return;
        }
        String fileName = call.getString("fileName", DEFAULT_FILE_NAME);
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = DEFAULT_FILE_NAME;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        try {
            startActivityForResult(call, intent, "handleSaveFileResult");
        } catch (ActivityNotFoundException ex) {
            call.reject("System file picker is unavailable on this device", ex);
        }
    }

    @ActivityCallback
    private void handleSaveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri uri = result.getData().getData();
        String content = call.getString("content");
        if (content == null || content.isEmpty()) {
            call.reject("Backup content is no longer available");
            return;
        }
        String fallbackName = call.getString("fileName", DEFAULT_FILE_NAME);

        try (OutputStream out = openWritableStream(uri)) {
            if (out == null) {
                call.reject("Unable to open destination file for writing");
                return;
            }
            out.write(content.getBytes(StandardCharsets.UTF_8));
            out.flush();
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("saved", true);
            response.put("uri", uri.toString());
            response.put("fileName", resolveDisplayName(uri, fallbackName));
            call.resolve(response);
        } catch (IOException | SecurityException ex) {
            call.reject("Failed to write backup file: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void openJsonFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/json",
            "text/plain",
            "application/octet-stream"
        });

        try {
            startActivityForResult(call, intent, "handleOpenFileResult");
        } catch (ActivityNotFoundException ex) {
            call.reject("System file picker is unavailable on this device", ex);
        }
    }

    @ActivityCallback
    private void handleOpenFileResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri uri = result.getData().getData();
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) {
                call.reject("Unable to open selected backup file");
                return;
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int total = 0;
            int read;
            while ((read = in.read(chunk)) != -1) {
                total += read;
                if (total > MAX_BACKUP_BYTES) {
                    call.reject("Selected file exceeds 5 MB backup limit");
                    return;
                }
                buffer.write(chunk, 0, read);
            }
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("content", new String(buffer.toByteArray(), StandardCharsets.UTF_8));
            response.put("fileName", resolveDisplayName(uri, ""));
            response.put("uri", uri.toString());
            call.resolve(response);
        } catch (IOException | SecurityException ex) {
            call.reject("Failed to read backup file: " + ex.getMessage(), ex);
        }
    }

    private OutputStream openWritableStream(Uri uri) throws FileNotFoundException {
        try {
            return getContext().getContentResolver().openOutputStream(uri, "wt");
        } catch (FileNotFoundException | UnsupportedOperationException | IllegalArgumentException fallbackTrigger) {
            return getContext().getContentResolver().openOutputStream(uri, "w");
        }
    }

    private String resolveDisplayName(Uri uri, String fallback) {
        try (Cursor cursor = getContext().getContentResolver().query(
            uri,
            new String[] { OpenableColumns.DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall back to provided filename if DocumentProvider does not expose DISPLAY_NAME.
        }
        return fallback != null ? fallback : "";
    }
}
