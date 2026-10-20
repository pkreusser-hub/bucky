package com.amenfarms.buckytv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * Bucky TV: a full-screen WebView on the family's TV home page. Everything the family sees
 * lives on the website (tv.html); this wrapper only adds what a web page can't do on its
 * own, which is open other apps. Page changes deploy with the site, no reinstall.
 */
public class MainActivity extends Activity {

    static final String HOME_URL = "https://amenfarms.netlify.app/tv.html";
    static final String HOST = "amenfarms.netlify.app";

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(20, 28, 22));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.addJavascriptInterface(new Bridge(), "BuckyTV");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                // Stay on our own site; anything else goes to whichever app handles it.
                if (HOST.equals(req.getUrl().getHost())) return false;
                openUri(req.getUrl().toString(), null);
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });
        web.setFocusable(true);
        setContentView(web);
        web.requestFocus(View.FOCUS_DOWN);
        if (state == null) web.loadUrl(HOME_URL);
        else web.restoreState(state);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // HOME pressed while we are already the home screen: tell the page to reset.
        web.evaluateJavascript("window.dispatchEvent(new Event('buckytv-home'))", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.evaluateJavascript("window.dispatchEvent(new Event('buckytv-resume'))", null);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // As a home screen there is nowhere to go back to, so Back belongs to the page
            // (close a panel, leave the idle screen). It reaches the page as Escape.
            web.evaluateJavascript("window.dispatchEvent(new Event('buckytv-back'))", null);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void showOffline() {
        String html = "<body style='background:#141c16;color:#fff;font:32px sans-serif;"
                + "display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
                + "<div style='text-align:center'><p>Bucky can't reach the internet.</p>"
                + "<p style='font-size:24px;opacity:.7'>Trying again in 15 seconds.</p></div>"
                + "<script>setTimeout(function(){location.href='" + HOME_URL + "'},15000)</script>";
        web.loadDataWithBaseURL(HOME_URL, html, "text/html", "utf-8", HOME_URL);
    }

    boolean launchPackage(String pkg) {
        PackageManager pm = getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) return false;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    boolean openUri(String uri, String pkg) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        if (pkg != null && !pkg.isEmpty()) i.setPackage(pkg);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            return pkg != null && launchPackage(pkg);
        }
    }

    /** Exposed to tv.html as window.BuckyTV. Only our own site is ever loaded in the WebView. */
    class Bridge {
        @JavascriptInterface
        public int version() {
            return 1;
        }

        @JavascriptInterface
        public boolean launch(String pkg) {
            return launchPackage(pkg);
        }

        /** Deep link into an app, e.g. a YouTube TV channel. Falls back to opening the app. */
        @JavascriptInterface
        public boolean openUrl(String uri, String pkg) {
            return openUri(uri, pkg);
        }

        @JavascriptInterface
        public boolean openSettings() {
            try {
                startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean installed(String pkg) {
            try {
                getPackageManager().getPackageInfo(pkg, 0);
                return true;
            } catch (PackageManager.NameNotFoundException e) {
                return false;
            }
        }

        /** The TV's own app row: [{pkg, label}], in the order the system lists them. */
        @JavascriptInterface
        public String apps() {
            PackageManager pm = getPackageManager();
            Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
            List<ResolveInfo> list = pm.queryIntentActivities(q, 0);
            JSONArray out = new JSONArray();
            for (ResolveInfo r : list) {
                String pkg = r.activityInfo.packageName;
                if (pkg.equals(getPackageName())) continue;
                try {
                    JSONObject o = new JSONObject();
                    o.put("pkg", pkg);
                    o.put("label", String.valueOf(r.loadLabel(pm)));
                    out.put(o);
                } catch (Exception ignored) {
                }
            }
            return out.toString();
        }

        /** An app's TV banner (or its icon when it has none) as a PNG data URL, or "". */
        @JavascriptInterface
        public String banner(String pkg) {
            try {
                PackageManager pm = getPackageManager();
                Drawable d = pm.getApplicationBanner(pkg);
                if (d == null) d = pm.getApplicationIcon(pkg);
                int w = Math.max(1, Math.min(d.getIntrinsicWidth(), 640));
                int h = Math.max(1, Math.min(d.getIntrinsicHeight(), 360));
                if (w <= 1 || h <= 1) { w = 320; h = 180; }
                Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(b);
                d.setBounds(0, 0, w, h);
                d.draw(c);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                b.compress(Bitmap.CompressFormat.PNG, 100, bos);
                return "data:image/png;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }
    }
}
