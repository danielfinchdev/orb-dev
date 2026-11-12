package dev.orb.app

import android.Manifest
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dev.orb.app.ui.OrbApp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var container: AppContainer

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        container.notificationAccess.refresh()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        container = (application as OrbApplication).container
        container.notificationAccess.launchDialog = { notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
        // A tap on a notice opens the chat or task it is about.
        if (savedInstanceState == null) container.openFromNotification(intent)
        // Once a PC is linked, Android is asked once to allow notices; after that it is the person's choice in «Este móvil».
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                container.runtime.collect { rt ->
                    if (rt != null && android.os.Build.VERSION.SDK_INT >= 33 && !container.notifyPrefs.permissionAsked) container.notificationAccess.request()
                }
            }
        }
        setContent { OrbApp(container) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        container.openFromNotification(intent)
    }

    override fun onResume() {
        super.onResume()
        container.notificationAccess.refresh()
    }
}
