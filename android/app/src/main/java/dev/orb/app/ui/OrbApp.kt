package dev.orb.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

// Plain Material theme on purpose: the final design is not approved yet.
@Composable
fun OrbApp() {
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            val nav = rememberNavController()
            NavHost(navController = nav, startDestination = "home") {
                composable("home") {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(24.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("Orb", style = MaterialTheme.typography.headlineLarge)
                        Button(onClick = { nav.navigate("linkTest") }, modifier = Modifier.padding(top = 16.dp)) {
                            Text("Prueba de conexión")
                        }
                    }
                }
                composable("linkTest") {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(24.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("Prueba de conexión (pendiente)")
                    }
                }
            }
        }
    }
}
