package com.amenfarms.buckytv;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
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
 */
public class HomeWatcher extends AccessibilityService {

    static final String GOOGLE_HOME_PKG = "com.google.android.apps.tv.launcherx";
    static final String GOOGLE_HOME_CLASS = "com.google.android.apps.tv.launcherx.home.HomeActivity";
    /** One Home press fires several window events; act on the first. */
    static final long DEBOUNCE_MS = 1500;

    private long lastLaunchAt = 0;

    /** Pure decision, unit-tested in HomeWatcherTest. */
    static boolean shouldOpenBucky(CharSequence pkg, CharSequence cls, long lastLaunchAt, long now) {
        if (pkg == null || cls == null) return false;
        if (!GOOGLE_HOME_PKG.contentEquals(pkg)) return false;
        if (!GOOGLE_HOME_CLASS.contentEquals(cls)) return false;
        return now - lastLaunchAt >= DEBOUNCE_MS;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        long now = System.currentTimeMillis();
        if (!shouldOpenBucky(event.getPackageName(), event.getClassName(), lastLaunchAt, now)) return;
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
