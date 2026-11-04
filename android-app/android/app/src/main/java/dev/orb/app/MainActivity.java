package dev.orb.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrbNativePlugin.class); // Orb's own: key store, «Compartir con Orb», the phone's model
        super.onCreate(savedInstanceState);
    }
}
