package dev.orb.app.ui.welcome

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun WelcomeScreen(vm: WelcomeViewModel, onLinked: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.linked) { if (state.linked) onLinked() }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Enlazar con tu PC", style = MaterialTheme.typography.headlineSmall)
        Text("Pega el enlace del código QR, o escribe el código corto y la dirección del PC.")
        OutlinedTextField(
            value = state.link, onValueChange = vm::setLink, label = { Text("Enlace") },
            modifier = Modifier.fillMaxWidth(), enabled = !state.busy,
        )
        Text("o")
        OutlinedTextField(
            value = state.code, onValueChange = vm::setCode, label = { Text("Código corto") },
            modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !state.busy,
        )
        OutlinedTextField(
            value = state.address, onValueChange = vm::setAddress, label = { Text("Dirección del PC") },
            modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !state.busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        OutlinedTextField(
            value = state.password, onValueChange = vm::setPassword, label = { Text("Contraseña maestra del PC") },
            modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !state.busy,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        )
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.busy) CircularProgressIndicator()
        Button(onClick = vm::submit, enabled = !state.busy) { Text("Enlazar") }
    }
}
