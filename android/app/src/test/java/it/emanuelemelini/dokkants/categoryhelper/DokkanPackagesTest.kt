package it.emanuelemelini.dokkants.categoryhelper

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which installed apps the settings offer as the monitored one ([DokkanPackages.isCandidate]). */
class DokkanPackagesTest {

    private val self = "it.emanuelemelini.dokkants.categoryhelper"

    @Test
    fun `the JP and Global games are offered`() {
        assertTrue(DokkanPackages.isCandidate(DokkanPackages.JP, self))
        assertTrue(DokkanPackages.isCandidate(DokkanPackages.GLOBAL, self))
        assertTrue(DokkanPackages.isCandidate("com.example.DokkanMirror", self))
    }

    @Test
    fun `this app and the author's other builds are not`() {
        assertFalse(DokkanPackages.isCandidate(self, self))
        // A build under an older id is a separate app on the phone
        assertFalse(DokkanPackages.isCandidate("it.emanuelemelini.dokkanprototype", self))
        assertFalse(DokkanPackages.isCandidate("it.emanuelemelini.dokkants.categoryhelper.debug", self))
    }

    @Test
    fun `apps without dokkan in the package are not`() {
        assertFalse(DokkanPackages.isCandidate("com.android.chrome", self))
    }
}
