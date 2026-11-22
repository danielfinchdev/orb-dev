package dev.orb.app.ui.chats

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LiveRowMotionTest {
    @get:Rule val rule = createComposeRule()

    /** The writing row is replaced by the finished message: the old one must not stay drawn over it while it fades out. */
    @Test fun theWritingRowLeavesAtOnceWhenTheFinishedMessageTakesItsPlace() {
        var done by mutableStateOf(false)
        rule.mainClock.autoAdvance = false
        rule.setContent {
            LazyColumn {
                if (done) items(listOf("answer"), key = { it }) { Text(it) }
                else item(key = "live") { Text("writing", liveRowMotion()) }
            }
        }
        rule.mainClock.advanceTimeByFrame()
        rule.onNodeWithText("writing").assertExists()
        done = true
        rule.mainClock.advanceTimeByFrame()
        rule.mainClock.advanceTimeBy(32)
        rule.onNodeWithText("answer").assertExists()
        rule.onNodeWithText("writing").assertDoesNotExist()
    }
}

