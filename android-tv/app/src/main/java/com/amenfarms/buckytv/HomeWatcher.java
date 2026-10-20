package com.amenfarms.buckytv;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Makes the Home button open Bucky TV while Google's home screen stays installed and switched
 * on. Google TV gives its own launcher a higher HOME priority (2) than any sideloaded app (0),
 * and switching it off over adb hands Home to the setup wizard (setupwraith, priority 1), which
 * draws a black screen; that is what happened on the family's TCL set on 2026-10-20. So instead
 * of competing for HOME, this accessibility service watches for Google's home screen coming to
 * the front and puts Bucky in front of it, the way Projectivy Launcher's override works.
 *
 * Only Google's main home screen is replaced. Its other screens (the long-press-Home dashboard,
 * profile picker, search) are different activities and are left alone.
 *
 * Two ways in, because the window watch alone failed on the TV (1.1, 2026-10-20): it worked from
 * Bucky, but pressing Home inside Prime Video left Google's home screen up, with the service still
 * switched on. Pressing Home makes Android hold back activity starts from background apps for a
 * few seconds (the "app switch" guard), so the watcher saw Google's screen and its start of Bucky
 * was held. Now:
 *  - The Home KEY is filtered here, before Android acts on it, so the guard never trips. A short
 *    press opens Bucky; a long press (LONG_PRESS_MS) goes to Google's home screen, the way back
 *    to it on purpose.
 *  - The window watch stays for the cases with no Home key: the TV turning on, and Back out of an
 *    app onto Google's home screen.
 */
public class HomeWatcher extends AccessibilityService {

    static final String GOOGLE_HOME_PKG = "com.google.android.apps.tv.launcherx";
    static final String GOOGLE_HOME_CLASS = "com.google.android.apps.tv.launcherx.home.HomeActivity";
    /** One Home press fires several window events; act on the first. */
    static final long DEBOUNCE_MS = 1500;

    /** Holding Home this long goes to Google's home screen instead of Bucky. */
    static final long LONG_PRESS_MS = 700;
    /** After a deliberate long press, leave Google's home screen alone for this long. */
    static final long GOOGLE_GRACE_MS = 4000;

    static final int KEY_PASS = 0, KEY_SWALLOW = 1, KEY_OPEN_BUCKY = 2, KEY_OPEN_GOOGLE = 3;

    private long lastLaunchAt = 0;
    private long googleAllowedUntil = 0;
    private boolean passNextHome = false;

    /** Pure decision for one key event, unit-tested in HomeWatcherTest. */
    static int homeKeyAction(int keyCode, int action, long downTime, long eventTime) {
        if (keyCode != KeyEvent.KEYCODE_HOME) return KEY_PASS;
        // The press itself (and its auto-repeats while held) is swallowed; the decision is made
        // on release, when the hold time is known.
        if (action != KeyEvent.ACTION_UP) return KEY_SWALLOW;
        return eventTime - downTime >= LONG_PRESS_MS ? KEY_OPEN_GOOGLE : KEY_OPEN_BUCKY;
    }

    /** Pure decision, unit-tested in HomeWatcherTest. */
    static boolean shouldOpenBucky(CharSequence pkg, CharSequence cls, long lastLaunchAt, long now) {
        return shouldOpenBucky(pkg, cls, lastLaunchAt, 0, now);
    }

    static boolean shouldOpenBucky(CharSequence pkg, CharSequence cls, long lastLaunchAt, long googleAllowedUntil, long now) {
        if (now < googleAllowedUntil) return false;
        if (pkg == null || cls == null) return false;
        if (!GOOGLE_HOME_PKG.contentEquals(pkg)) return false;
        if (!GOOGLE_HOME_CLASS.contentEquals(cls)) return false;
        return now - lastLaunchAt >= DEBOUNCE_MS;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        long now = System.currentTimeMillis();
        if (!shouldOpenBucky(event.getPackageName(), event.getClassName(), lastLaunchAt, googleAllowedUntil, now)) return;
        openBucky(now);
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (event.getKeyCode() != KeyEvent.KEYCODE_HOME) return false;
        // Our own long-press hand-off (GLOBAL_ACTION_HOME below) may arrive here as a Home press;
        // let that one through to Android, or the way back to Google's screen would loop to Bucky.
        if (passNextHome) {
            if (event.getAction() == KeyEvent.ACTION_UP) passNextHome = false;
            return false;
        }
        switch (homeKeyAction(event.getKeyCode(), event.getAction(), event.getDownTime(), event.getEventTime())) {
            case KEY_OPEN_BUCKY:
                openBucky(System.currentTimeMillis());
                return true;
            case KEY_OPEN_GOOGLE:
                googleAllowedUntil = System.currentTimeMillis() + GOOGLE_GRACE_MS;
                passNextHome = true;
                if (!performGlobalAction(GLOBAL_ACTION_HOME)) passNextHome = false;
                return true;
            case KEY_SWALLOW:
                return true;
            default:
                return false;
        }
    }

    private void openBucky(long now) {
        lastLaunchAt = now;
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(i);
    }

    @Override
    public void onInterrupt() {
    }

    /** Whether the family has switched this on in Settings > Accessibility. */
    static boolean isEnabled(Context ctx) {
        String on = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return isListed(on, ctx.getPackageName(), HomeWatcher.class.getName());
    }

    /**
     * Pure parse of the ':'-separated enabled-services setting, unit-tested in HomeWatcherTest.
     * Entries are flattened component names, written either in full ("pkg/pkg.Cls") or short
     * ("pkg/.Cls") form depending on what wrote them, so both count.
     */
    static boolean isListed(String enabledServices, String pkg, String cls) {
        if (enabledServices == null || enabledServices.isEmpty()) return false;
        String full = pkg + "/" + cls;
        String shortForm = cls.startsWith(pkg + ".") ? pkg + "/" + cls.substring(pkg.length()) : null;
        for (String entry : enabledServices.split(":")) {
            String e = entry.trim();
            if (e.equalsIgnoreCase(full) || (shortForm != null && e.equalsIgnoreCase(shortForm))) return true;
        }
        return false;
    }
}
