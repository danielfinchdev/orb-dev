package dev.orb.app.ui.scan

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

/**
 * The real [CameraAccess]: Android's permission state of this app and its settings page. It is held by a view model, so
 * it keeps only the application context and a weak reference to the Activity that [attach] last gave it.
 */
class AndroidCameraAccess(context: Context) : CameraAccess {
    private val app = context.applicationContext
    private var activity: WeakReference<Activity>? = null

    override val hasCamera: Boolean get() = app.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    /** The Activity currently showing the scanner (null when it goes away); only [canExplain] needs one. */
    override fun attach(current: Activity?) {
        activity = current?.let { WeakReference(it) }
    }

    override fun granted(): Boolean = ContextCompat.checkSelfPermission(app, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    override fun canExplain(): Boolean {
        val current = activity?.get() ?: return false
        return ActivityCompat.shouldShowRequestPermissionRationale(current, Manifest.permission.CAMERA)
    }

    override fun openSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", app.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { app.startActivity(intent) } catch (e: Exception) { /* no settings screen to show */ }
    }
}

/** The Activity under a (possibly wrapped) context, if there is one. */
fun Context.findActivity(): Activity? = generateSequence(this) { (it as? ContextWrapper)?.baseContext }.filterIsInstance<Activity>().firstOrNull()

/** Reads the brightness plane of each frame with [reader]; frames are looked at in memory and dropped, never stored or sent. */
private class FrameAnalyzer(private val reader: QrReader, private val onText: (String) -> Unit) : ImageAnalysis.Analyzer {
    override fun analyze(image: ImageProxy) {
        try {
            val plane = image.planes[0]
            val width = image.width
            val height = image.height
            val stride = plane.rowStride
            val buffer = plane.buffer
            val luma = ByteArray(width * height)
            for (row in 0 until height) {
                buffer.position(row * stride)
                buffer.get(luma, row * width, width)
            }
            reader.read(luma, width, height)?.let(onText)
        } catch (e: Exception) {
            // A bad frame is skipped; the next one is tried.
        } finally {
            image.close()
        }
    }
}

/**
 * The live back camera inside the viewfinder. It is bound to the screen's lifecycle (released in the background) and let go
 * when the screen leaves; [torch] drives the flash and [onFlash] says whether the phone has one.
 */
@Composable
fun CameraViewfinder(
    torch: Boolean,
    onFlash: (Boolean) -> Unit,
    onText: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    var camera by remember { mutableStateOf<Camera?>(null) }
    val flashSink by rememberUpdatedState(onFlash)
    val textSink by rememberUpdatedState(onText)
    DisposableEffect(owner) {
        val executor = Executors.newSingleThreadExecutor()
        val reader = ZxingQrReader()
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        var disposed = false
        future.addListener({
            if (disposed) return@addListener
            try {
                val p = future.get()
                provider = p
                val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { it.setAnalyzer(executor, FrameAnalyzer(reader) { text -> textSink(text) }) }
                p.unbindAll()
                val bound = p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                camera = bound
                flashSink(bound.cameraInfo.hasFlashUnit())
            } catch (e: Exception) {
                flashSink(false)
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            disposed = true
            camera = null
            provider?.unbindAll()
            executor.shutdown()
        }
    }
    LaunchedEffect(camera, torch) { camera?.cameraControl?.enableTorch(torch) }
    AndroidView({ previewView }, modifier)
}
