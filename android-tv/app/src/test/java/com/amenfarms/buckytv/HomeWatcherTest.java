package com.amenfarms.buckytv;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** HomeWatcher's two decisions, on the JVM: `gradle testReleaseUnitTest` (android-tv/). */
public class HomeWatcherTest {
    static final String G = HomeWatcher.GOOGLE_HOME_PKG;
    static final String HOME = HomeWatcher.GOOGLE_HOME_CLASS;
    static final long T = 1_000_000L;

    @Test public void googlesHomeScreenOpensBucky() {
        assertTrue(HomeWatcher.shouldOpenBucky(G, HOME, 0, T));
    }

    // The long-press-Home dashboard, profile picker and search live in the same package as other
    // activities. Only the main home screen is replaced, or Bucky would take those over too.
    @Test public void googlesOtherScreensAreLeftAlone() {
        assertFalse(HomeWatcher.shouldOpenBucky(G, "com.google.android.apps.tv.launcherx.dashboard.DashboardActivity", 0, T));
        assertFalse(HomeWatcher.shouldOpenBucky(G, "android.widget.FrameLayout", 0, T));
    }

    @Test public void otherAppsAreLeftAlone() {
        assertFalse(HomeWatcher.shouldOpenBucky("com.amazon.amazonvideo.livingroom", HOME, 0, T));
        assertFalse(HomeWatcher.shouldOpenBucky(null, HOME, 0, T));
        assertFalse(HomeWatcher.shouldOpenBucky(G, null, 0, T));
    }

    // One Home press fires several window events; only the first launches Bucky.
    @Test public void oneHomePressLaunchesOnce() {
        long last = T;
        assertFalse(HomeWatcher.shouldOpenBucky(G, HOME, last, T + 200));
        assertFalse(HomeWatcher.shouldOpenBucky(G, HOME, last, T + HomeWatcher.DEBOUNCE_MS - 1));
        assertTrue(HomeWatcher.shouldOpenBucky(G, HOME, last, T + HomeWatcher.DEBOUNCE_MS));
    }

    static final String PKG = "com.amenfarms.buckytv";
    static final String CLS = "com.amenfarms.buckytv.HomeWatcher";

    @Test public void enabledSettingFullAndShortForms() {
        assertTrue(HomeWatcher.isListed(PKG + "/" + CLS, PKG, CLS));
        assertTrue(HomeWatcher.isListed(PKG + "/.HomeWatcher", PKG, CLS));
        assertTrue(HomeWatcher.isListed("com.other.app/com.other.app.Svc:" + PKG + "/.HomeWatcher", PKG, CLS));
    }

    @Test public void enabledSettingEmptyOrOthersOnly() {
        assertFalse(HomeWatcher.isListed(null, PKG, CLS));
        assertFalse(HomeWatcher.isListed("", PKG, CLS));
        assertFalse(HomeWatcher.isListed("com.other.app/com.other.app.Svc", PKG, CLS));
        // A different service in our own package is not this one.
        assertFalse(HomeWatcher.isListed(PKG + "/.SomethingElse", PKG, CLS));
    }
}
