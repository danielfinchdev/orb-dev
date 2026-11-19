package dev.orb.app.ui.chats

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent

/**
 * Approves the way the chat can: the dialog reads the task now and its «Aprobar» sends the fingerprint of the text it shows.
 * No card approves any more, so every test that needs an approval going through the view model uses this.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun TestScope.approveWithDialog(vm: OrbeChatViewModel, task: Long) {
    vm.askApproval(task)
    runCurrent()
    vm.confirmApproval()
    runCurrent()
}
