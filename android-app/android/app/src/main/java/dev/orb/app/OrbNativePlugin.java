package dev.orb.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Orb's own bits of Android (src/ui/lib/app-bridge.js):
 * - a small key store: values encrypted with an AES key that lives in the Android Keystore and never leaves the phone
 *   (this phone's keys for the linked Orb);
 * - «Compartir con Orb»: what another app shares (text and pictures) is handed to the page;
 * - the phone's model, for the name of the linked device;
 * - Android's back button or gesture: handed to the page («back»), which goes back inside the app; on its first screen
 *   the page asks to minimize the app (never to close it).
 */
@CapacitorPlugin(name = "OrbNative")
public class OrbNativePlugin extends Plugin {
    private static final String KEY_ALIAS = "orb.store";
    private static final String PREFS = "orb.secure";
    private static final int MAX_FILES = 10;
    private static final int MAX_BYTES = 10 * 1024 * 1024;

    private JSObject pending = null; // shared before the page asked for it

    @Override
    public void load() {
        pending = readShare(getActivity().getIntent());
        getActivity().setIntent(new Intent(getActivity(), MainActivity.class)); // handled: not again after a restart
        // Without this, Capacitor's activity just closes on «back» (the page has no history of its own).
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (hasListeners("back")) {
                    notifyListeners("back", new JSObject(), false);
                    return;
                }
                setEnabled(false); // the page is not listening yet: Android's own behaviour
                getActivity().getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @PluginMethod
    public void minimize(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        JSObject shared = readShare(intent);
        if (shared != null) notifyListeners("shared", shared, true);
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        JSObject out = pending != null ? pending : new JSObject();
        pending = null;
        call.resolve(out);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject out = new JSObject();
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String model = Build.MODEL == null ? "Android" : Build.MODEL;
        out.put("model", model.toLowerCase().startsWith(maker.toLowerCase()) ? model : (maker + " " + model).trim());
        call.resolve(out);
    }

    // ---- key store

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return gen.generateKey();
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String k = call.getString("key"); String v = call.getString("value");
        if (k == null || v == null) { call.reject("falta la clave o el valor"); return; }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = c.getIV();
            byte[] box = c.doFinal(v.getBytes(StandardCharsets.UTF_8));
            byte[] all = new byte[iv.length + box.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(box, 0, all, iv.length, box.length);
            prefs().edit().putString(k, iv.length + ":" + Base64.encodeToString(all, Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception e) { call.reject("no se pudo guardar: " + e.getMessage()); }
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String k = call.getString("key");
        JSObject out = new JSObject();
        String stored = k == null ? null : prefs().getString(k, null);
        if (stored == null) { call.resolve(out); return; }
        try {
            int sep = stored.indexOf(':');
            int ivLen = Integer.parseInt(stored.substring(0, sep));
            byte[] all = Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 0, ivLen));
            out.put("value", new String(c.doFinal(all, ivLen, all.length - ivLen), StandardCharsets.UTF_8));
        } catch (Exception e) {
            prefs().edit().remove(k).apply(); // unreadable (the Keystore key is gone): link again
        }
        call.resolve(out);
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String k = call.getString("key");
        if (k != null) prefs().edit().remove(k).apply();
        call.resolve();
    }

    // ---- share target

    private JSObject readShare(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return null;
        JSObject out = new JSObject();
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        StringBuilder all = new StringBuilder();
        if (subject != null && !subject.isEmpty() && (text == null || !text.toString().contains(subject))) all.append(subject).append('\n');
        if (text != null) all.append(text);
        if (all.length() > 0) out.put("text", all.toString().trim());
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        JSArray files = new JSArray();
        ContentResolver cr = getContext().getContentResolver();
        for (Uri u : uris) {
            if (files.length() >= MAX_FILES) break;
            String type = cr.getType(u);
            if (type == null || !type.startsWith("image/")) continue;
            byte[] data = readAll(cr, u);
            if (data == null) continue;
            JSObject f = new JSObject();
            f.put("name", nameOf(cr, u));
            f.put("type", type);
            f.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
            files.put(f);
        }
        if (files.length() > 0) out.put("files", files);
        return out.length() > 0 ? out : null;
    }

    private static byte[] readAll(ContentResolver cr, Uri u) {
        try (InputStream in = cr.openInputStream(u)) {
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int n; int total = 0;
            while ((n = in.read(chunk)) > 0) {
                total += n;
                if (total > MAX_BYTES) return null;
                buf.write(chunk, 0, n);
            }
            return buf.toByteArray();
        } catch (Exception e) { return null; }
    }

    private static String nameOf(ContentResolver cr, Uri u) {
        try (Cursor c = cr.query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) { String n = c.getString(0); if (n != null) return n; }
        } catch (Exception ignored) { }
        String last = u.getLastPathSegment();
        return last == null ? "imagen" : last;
    }
}
