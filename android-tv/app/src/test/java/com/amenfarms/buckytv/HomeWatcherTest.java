package com.amenfarms.buckytv;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** HomeWatcher's two decisions, on the JVM: `gradle testReleaseUnitTest` (android-tv/). */
public class HomeWatcherTest {
    static final String G = HomeWatcher.GOOGLE_HOME_PKG;
    static final String HOME_CLS = HomeWatcher.GOOGLE_HOME_CLASS;
    static final long T = 1_000_000L;

    @Test public void googlesHomeScreenOpensBucky() {
        assertTrue(HomeWatcher.shouldOpenBucky(G, HOME_CLS, 0, T));
    }

    // The long-press-Home dashboard, profile picker and search live in the same package as other
    // activities. Only the main home screen is replaced, or Bucky would take those over too.
    @Test public void googlesOtherScreensAreLeftAlone() {
        assertFalse(HomeWatcher.shouldOpenBucky(G, "com.google.android.apps.tv.launcherx.dashboard.DashboardActivity", 0, T));
        assertFalse(HomeWatcher.shouldOpenBucky(G, "android.widget.FrameLayout", 0, T));
    }

    @Test public void otherAppsAreLeftAlone() {
        assertFalse(HomeWatcher.shouldOpenBucky("com.amazon.amazonvideo.livingroom", HOME_CLS, 0, T));
        assertFalse(HomeWatcher.shouldOpenBucky(null, HOME_CLS, 0, T));
        assertFalse(HomeWatcher.shouldOpenBucky(G, null, 0, T));
    }

    // One Home press fires several window events; only the first launches Bucky.
    @Test public void oneHomePressLaunchesOnce() {
        long last = T;
        assertFalse(HomeWatcher.shouldOpenBucky(G, HOME_CLS, last, T + 200));
        assertFalse(HomeWatcher.shouldOpenBucky(G, HOME_CLS, last, T + HomeWatcher.DEBOUNCE_MS - 1));
        assertTrue(HomeWatcher.shouldOpenBucky(G, HOME_CLS, last, T + HomeWatcher.DEBOUNCE_MS));
    }

    // The Home key: swallowed on the way down, decided on release by how long it was held.
    static final int HOME = android.view.KeyEvent.KEYCODE_HOME, DOWN = android.view.KeyEvent.ACTION_DOWN, UP = android.view.KeyEvent.ACTION_UP;

    @Test public void shortHomePressOpensBucky() {
        org.junit.Assert.assertEquals(HomeWatcher.KEY_SWALLOW, HomeWatcher.homeKeyAction(HOME, DOWN, T, T));
        org.junit.Assert.assertEquals(HomeWatcher.KEY_OPEN_BUCKY, HomeWatcher.homeKeyAction(HOME, UP, T, T + 120));
        org.junit.Assert.assertEquals(HomeWatcher.KEY_OPEN_BUCKY, HomeWatcher.homeKeyAction(HOME, UP, T, T + HomeWatcher.LONG_PRESS_MS - 1));
    }

    @Test public void heldHomeGoesToGooglesScreen() {
        org.junit.Assert.assertEquals(HomeWatcher.KEY_OPEN_GOOGLE, HomeWatcher.homeKeyAction(HOME, UP, T, T + HomeWatcher.LONG_PRESS_MS));
        org.junit.Assert.assertEquals(HomeWatcher.KEY_OPEN_GOOGLE, HomeWatcher.homeKeyAction(HOME, UP, T, T + 2000));
    }

    @Test public void everyOtherKeyPassesThrough() {
        for (int k : new int[] { android.view.KeyEvent.KEYCODE_BACK, android.view.KeyEvent.KEYCODE_DPAD_CENTER, android.view.KeyEvent.KEYCODE_DPAD_UP, android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, android.view.KeyEvent.KEYCODE_VOLUME_UP }) {
            org.junit.Assert.assertEquals(HomeWatcher.KEY_PASS, HomeWatcher.homeKeyAction(k, DOWN, T, T));
            org.junit.Assert.assertEquals(HomeWatcher.KEY_PASS, HomeWatcher.homeKeyAction(k, UP, T, T + 50));
        }
    }

    // After the deliberate long press, Google's screen must stay up, not bounce straight back.
    @Test public void googlesScreenStaysAfterALongPress() {
        long until = T + HomeWatcher.GOOGLE_GRACE_MS;
        assertFalse(HomeWatcher.shouldOpenBucky(G, HomeWatcherTest.HOME_CLS, 0, until, T + 500));
        assertTrue(HomeWatcher.shouldOpenBucky(G, HomeWatcherTest.HOME_CLS, 0, until, until));
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
