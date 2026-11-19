package dev.orb.app

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import dev.orb.app.ui.OrbApp
import dev.orb.app.lock.AndroidAuthenticator
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {
    private lateinit var container: AppContainer
    private var mine: AndroidAuthenticator? = null

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        container.notificationAccess.dialogResult(granted)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        container = (application as OrbApplication).container
        container.notificationAccess.launchDialog = { notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
        val authenticator = AndroidAuthenticator(this).also { mine = it }
        container.lock.authenticator = authenticator
        // With the lock on, the app switcher and screenshots must not show the content.
        lifecycleScope.launch {
            container.lock.settings.map { it.enabled }.collect { on ->
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
        }
        // A tap on a notice opens the chat or task it is about.
        if (savedInstanceState == null) {
            container.openFromNotification(intent)
            container.receiveShare(intent)
        }
        setContent { OrbApp(container) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        container.openFromNotification(intent)
        container.receiveShare(intent)
    }

    override fun onDestroy() {
        // The authenticator holds this activity; the container outlives it.
        if (container.lock.authenticator === mine) container.lock.authenticator = null
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        container.notificationAccess.refresh()
    }
}
