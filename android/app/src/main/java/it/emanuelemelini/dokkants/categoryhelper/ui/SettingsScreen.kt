package it.emanuelemelini.dokkants.categoryhelper.ui

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import it.emanuelemelini.dokkants.categoryhelper.AppInfo
import it.emanuelemelini.dokkants.categoryhelper.DictionaryActivity
import it.emanuelemelini.dokkants.categoryhelper.DokkanPackages
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.dictionary.CategoryDictionary
import it.emanuelemelini.dokkants.categoryhelper.dictionary.DictionaryRepository
import it.emanuelemelini.dokkants.categoryhelper.history.HistoryRepository
import it.emanuelemelini.dokkants.categoryhelper.service.DokkanAccessibilityService
import it.emanuelemelini.dokkants.categoryhelper.settings.AppSettings
import it.emanuelemelini.dokkants.categoryhelper.settings.InsertMode
import it.emanuelemelini.dokkants.categoryhelper.settings.SettingsRepository
import it.emanuelemelini.dokkants.categoryhelper.update.UpdateCheck
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/** Main screen: service status and the settings of the bubble. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    val resources = LocalResources.current
    val repository = remember { SettingsRepository(context) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var checking by remember { mutableStateOf(false) }

    val history = remember { HistoryRepository(context) }
    val dictionaryRepository = remember { DictionaryRepository.get(context) }
    LaunchedEffect(Unit) { dictionaryRepository.ensureLoaded() }

    val settings by repository.settings.collectAsStateWithLifecycle(initialValue = null)
    val rawPackage by repository.rawTargetPackage.collectAsStateWithLifecycle(initialValue = null)
    val connected by DokkanAccessibilityService.connected.collectAsStateWithLifecycle()
    val dictionary by dictionaryRepository.dictionary.collectAsStateWithLifecycle()
    val dictionaryEdited by dictionaryRepository.edited.collectAsStateWithLifecycle()
    val favorites by history.favorites.collectAsStateWithLifecycle(initialValue = emptySet())
    val recents by history.recents.collectAsStateWithLifecycle(initialValue = emptyList())

    var serviceEnabled by remember { mutableStateOf(isServiceEnabled(context)) }
    var dokkanApps by remember { mutableStateOf(DokkanPackages.findInstalled(context)) }
    // Coming back from the system settings: re-read what may have changed there
    LifecycleResumeEffect(Unit) {
        serviceEnabled = isServiceEnabled(context)
        dokkanApps = DokkanPackages.findInstalled(context)
        onPauseOrDispose { }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    // The full name is long: one line, never a clipped second one
                    Text(stringResource(R.string.app_name), maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ServiceSection(serviceEnabled, connected, onOpenSettings = { openAccessibilitySettings(context) })
            if (Build.VERSION.SDK_INT >= 33 && !serviceEnabled) {
                RestrictedSection(onOpenAppInfo = { openAppInfo(context) })
            }

            val current = settings
            val typedPackage = rawPackage
            if (current != null && typedPackage != null) {
                AppearanceSection(
                    settings = current,
                    initialPackage = typedPackage,
                    installed = dokkanApps,
                    onAutoShow = { scope.launch { repository.setAutoShow(it) } },
                    onPackage = { scope.launch { repository.setTargetPackage(it) } },
                )
                InsertSection(
                    mode = current.insertMode,
                    onMode = { scope.launch { repository.setInsertMode(it) } },
                )
                BubbleSection(
                    settings = current,
                    onOpacity = { scope.launch { repository.setBubbleOpacity(it) } },
                    onSize = { scope.launch { repository.setBubbleSize(it) } },
                    onResetPosition = { scope.launch { repository.resetBubblePosition() } },
                )
                DictionarySection(
                    dictionary = dictionary,
                    edited = dictionaryEdited,
                    favoriteCount = favorites.size,
                    recentCount = recents.size,
                    onOpenEditor = { context.startActivity(Intent(context, DictionaryActivity::class.java)) },
                    onClearRecents = { scope.launch { history.clearRecents() } },
                    checking = checking,
                    onCheckUpdates = {
                        checking = true
                        scope.launch {
                            val result = try {
                                UpdateCheck.run(context)
                            } finally {
                                checking = false
                            }
                            snackbar.showSnackbar(updateMessage(resources, result))
                        }
                    },
                )
                DiagnosticsSection(
                    enabled = current.debugLog,
                    onEnabled = { scope.launch { repository.setDebugLog(it) } },
                )
            }
            AboutSection(
                version = remember { AppInfo.versionName(context) },
                onInstructions = { openInstructions(context) },
            )
        }
    }
}

@Composable
private fun ServiceSection(enabled: Boolean, connected: Boolean, onOpenSettings: () -> Unit) {
    Section(stringResource(R.string.section_service)) {
        val status = when {
            enabled && connected -> R.string.service_status_active
            enabled -> R.string.service_status_not_connected
            else -> R.string.service_status_disabled
        }
        Text(stringResource(status), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onOpenSettings) { Text(stringResource(R.string.open_accessibility_settings)) }
    }
}

@Composable
private fun RestrictedSection(onOpenAppInfo: () -> Unit) {
    Section(stringResource(R.string.section_restricted)) {
        Text(stringResource(R.string.restricted_instructions), style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = onOpenAppInfo) { Text(stringResource(R.string.open_app_info)) }
    }
}

@Composable
private fun AppearanceSection(
    settings: AppSettings,
    initialPackage: String,
    installed: List<DokkanPackages.InstalledApp>,
    onAutoShow: (Boolean) -> Unit,
    onPackage: (String) -> Unit,
) {
    // Local while typing: the stored value comes back asynchronously and would fight the cursor
    var packageText by rememberSaveable { mutableStateOf(initialPackage) }

    Section(stringResource(R.string.section_appearance)) {
        SwitchRow(stringResource(R.string.auto_show), settings.autoShow, onAutoShow)
        OutlinedTextField(
            value = packageText,
            onValueChange = {
                packageText = it
                onPackage(it)
            },
            label = { Text(stringResource(R.string.target_package)) },
            supportingText = if (packageText.isBlank()) {
                { Text(stringResource(R.string.target_package_blank)) }
            } else {
                null
            },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(stringResource(R.string.installed_apps), style = MaterialTheme.typography.labelLarge)
        if (installed.isEmpty()) {
            Text(stringResource(R.string.installed_none), style = MaterialTheme.typography.bodyMedium)
        }
        installed.forEach { app ->
            val kind = when (app.packageName) {
                DokkanPackages.JP -> R.string.kind_jp
                DokkanPackages.GLOBAL -> R.string.kind_global
                else -> R.string.kind_other
            }
            FilterChip(
                selected = settings.targetPackage == app.packageName,
                onClick = {
                    packageText = app.packageName
                    onPackage(app.packageName)
                },
                label = {
                    Column(modifier = Modifier.padding(vertical = 6.dp)) {
                        Text(stringResource(R.string.installed_chip, app.label, stringResource(kind)))
                        Text(app.packageName, style = MaterialTheme.typography.bodySmall)
                    }
                },
            )
        }
    }
}

@Composable
private fun InsertSection(mode: InsertMode, onMode: (InsertMode) -> Unit) {
    Section(stringResource(R.string.section_insert)) {
        Column(modifier = Modifier.selectableGroup()) {
            InsertOption(stringResource(R.string.insert_auto), mode == InsertMode.AUTO) { onMode(InsertMode.AUTO) }
            InsertOption(stringResource(R.string.insert_clipboard), mode == InsertMode.CLIPBOARD) {
                onMode(InsertMode.CLIPBOARD)
            }
        }
        Text(stringResource(R.string.insert_hint), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun InsertOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onClick, role = Role.RadioButton)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(label, modifier = Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun BubbleSection(
    settings: AppSettings,
    onOpacity: (Float) -> Unit,
    onSize: (Int) -> Unit,
    onResetPosition: () -> Unit,
) {
    // Sliders save when released, not on every step
    var opacity by remember { mutableFloatStateOf(settings.bubbleOpacity) }
    var size by remember { mutableFloatStateOf(settings.bubbleSizeDp.toFloat()) }

    Section(stringResource(R.string.section_bubble)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(AppSettings.MAX_SIZE_DP.dp + 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            BubblePreview(sizeDp = size.roundToInt(), opacity = opacity)
        }
        Text(stringResource(R.string.bubble_opacity, (opacity * 100).roundToInt()))
        Slider(
            value = opacity,
            onValueChange = { opacity = it },
            onValueChangeFinished = { onOpacity(opacity) },
            valueRange = AppSettings.MIN_OPACITY..1f,
        )
        Text(stringResource(R.string.bubble_size, size.roundToInt()))
        Slider(
            value = size,
            onValueChange = { size = it },
            onValueChangeFinished = { onSize(size.roundToInt()) },
            valueRange = AppSettings.MIN_SIZE_DP.toFloat()..AppSettings.MAX_SIZE_DP.toFloat(),
            // 4 dp steps
            steps = (AppSettings.MAX_SIZE_DP - AppSettings.MIN_SIZE_DP) / 4 - 1,
        )
        Text(stringResource(R.string.bubble_hint), style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = onResetPosition) { Text(stringResource(R.string.bubble_reset_position)) }
    }
}

/** Same look as the overlay bubble, which only appears over Dokkan. */
@Composable
private fun BubblePreview(sizeDp: Int, opacity: Float) {
    Box(
        modifier = Modifier
            .size(sizeDp.dp)
            .alpha(opacity)
            .clip(CircleShape)
            .background(colorResource(R.color.ic_launcher_background)),
    ) {
        Image(
            painter = painterResource(R.drawable.ic_bubble_foreground),
            contentDescription = null,
            modifier = Modifier.size(sizeDp.dp),
        )
    }
}

@Composable
private fun DictionarySection(
    dictionary: CategoryDictionary?,
    edited: Boolean,
    favoriteCount: Int,
    recentCount: Int,
    onOpenEditor: () -> Unit,
    onClearRecents: () -> Unit,
    checking: Boolean,
    onCheckUpdates: () -> Unit,
) {
    Section(stringResource(R.string.section_dictionary)) {
        Text(
            text = if (dictionary == null) {
                stringResource(R.string.dictionary_loading)
            } else {
                stringResource(
                    R.string.dictionary_summary,
                    dictionary.categories.size,
                    dictionary.version,
                    favoriteCount,
                    recentCount,
                )
            },
            style = MaterialTheme.typography.bodyLarge,
        )
        Text(
            stringResource(if (edited) R.string.dictionary_edited else R.string.dictionary_bundled),
            style = MaterialTheme.typography.bodyMedium,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onOpenEditor) { Text(stringResource(R.string.open_editor)) }
            OutlinedButton(onClick = onClearRecents, enabled = recentCount > 0) {
                Text(stringResource(R.string.clear_recents))
            }
        }
        Text(stringResource(R.string.update_hint), style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = onCheckUpdates, enabled = !checking && dictionary != null) {
            Text(stringResource(if (checking) R.string.update_checking else R.string.update_check))
        }
    }
}

@Composable
private fun AboutSection(version: String, onInstructions: () -> Unit) {
    Section(stringResource(R.string.section_about)) {
        Text(stringResource(R.string.about_version, version), style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = onInstructions) { Text(stringResource(R.string.about_instructions)) }
    }
}

@Composable
private fun DiagnosticsSection(enabled: Boolean, onEnabled: (Boolean) -> Unit) {
    Section(stringResource(R.string.section_diagnostics)) {
        SwitchRow(stringResource(R.string.debug_log), enabled, onEnabled)
        Text(stringResource(R.string.debug_log_help), style = MaterialTheme.typography.bodyMedium)
        SelectionContainer {
            Text(stringResource(R.string.debug_log_command), fontFamily = FontFamily.Monospace)
        }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

private fun isServiceEnabled(context: Context): Boolean {
    val expected = ComponentName(context, DokkanAccessibilityService::class.java)
    val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ) ?: return false
    return enabled.split(':').any { ComponentName.unflattenFromString(it) == expected }
}

private fun openAccessibilitySettings(context: Context) {
    try {
        context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    } catch (_: ActivityNotFoundException) {
        context.startActivity(Intent(Settings.ACTION_SETTINGS))
    }
}

private fun openAppInfo(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
    )
}
