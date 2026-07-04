# Farm Chores App — Setup Guide

Welcome! You don't need to know any code to do this. Just follow the steps in order. The whole thing takes about 20–30 minutes, and you only do it once. Take your time.

The app is a small set of files that must stay together in the same folder:
- **index.html** — the app itself.
- **bucky.png** — the app icon (the patriotic goat).
- **manifest.webmanifest** — lets the icon and name show correctly when added to a home screen.
- **Goat1.png** and **Goat2.png** — the two goat frames used in the Bucky Jump mini-game animation.
- **cat.png** — the leaping cat used in the Cat Rescue mini-game.
- **woodpile.html** — the Woodpile stacking game (opens from the dashboard tile).

(The goat herd is built right into index.html, so there's no separate data file to worry about.)
- **SETUP-GUIDE.md** — this guide.

---

## What you're building

A simple chore app that works in any phone's web browser and can be added to your home screen so it looks and feels like a normal app. Everyone in the family sees the same list, live. When you tap "Feed the goats," your wife's phone shows it as done within a second or two.

It has four tabs — **Daily, Weekly, Monthly, Yearly** — and chores automatically reset: a daily chore you check off today comes back fresh tomorrow; a weekly one resets at the start of each week, and so on.

---

## Try it right now (no setup needed)

Before doing any setup, you can see the app immediately:

1. Find **index.html** in the folder.
2. Double-click it. It opens in your web browser.
3. Play with it — check chores off, add new ones, switch tabs.

At this stage it only works on the one device and does **not** sync to other phones yet. The bar under the title will say *"This phone only."* Turning on family syncing is what the rest of this guide does.

---

## The two things we need to set up

1. **A free database (Firebase)** — this is the shared "notebook" all your phones read and write to. This is what makes syncing work.
2. **Free hosting (Netlify)** — this puts the app at a web address (a link) so everyone can open it on their phone.

Both are free for a family-sized app. Let's do the database first.

---

## Part 1 — Create the free database (Firebase)

### Step 1: Create a Firebase project
1. Go to **https://console.firebase.google.com** and sign in with a Google account (your Gmail is fine).
2. Click **"Create a project"** (or "Add project").
3. Give it a name like **farm-chores**. Click **Continue**.
4. On the "Google Analytics" screen, **turn it OFF** (you don't need it). Click **Create project**.
5. Wait a moment, then click **Continue**.

### Step 2: Create the database
1. In the left menu, click **Build → Firestore Database**.
2. Click **Create database**.
3. Choose a location near you (any nearby option is fine). Click **Next**.
4. Choose **"Start in test mode"**. Click **Create** (or Enable).

> "Test mode" lets the app read and write right away. It's fine to start here. See **Part 4** at the end for a quick note on locking it down later.

### Step 3: Get your settings (the part you paste into the app)
1. Click the **gear icon ⚙️** near the top-left, then **Project settings**.
2. Scroll down to **"Your apps"**. Click the **web icon** — it looks like **`</>`**.
3. Give it a nickname like **chores** and click **Register app**. (Do NOT check "Firebase Hosting.")
4. You'll now see a code box that contains something like this:

   ```
   const firebaseConfig = {
     apiKey: "AIzaSyXXXXXXXXXXXXXXXXX",
     authDomain: "farm-chores-1234.firebaseapp.com",
     projectId: "farm-chores-1234",
     storageBucket: "farm-chores-1234.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   };
   ```

5. **Keep this screen open** — you'll copy these values in the next step.

### Step 4: Paste the settings into the app
1. Open **index.html** with a plain text editor:
   - **Windows:** right-click index.html → *Open with* → **Notepad**.
   - **Mac:** right-click → *Open With* → **TextEdit**.
2. Near the top of the code, find this block (it's clearly marked):

   ```
   const firebaseConfig = {
     apiKey: "PASTE_HERE",
     authDomain: "PASTE_HERE",
     projectId: "PASTE_HERE",
     storageBucket: "PASTE_HERE",
     messagingSenderId: "PASTE_HERE",
     appId: "PASTE_HERE"
   };
   ```

3. Replace each **"PASTE_HERE"** with the matching value from your Firebase screen. **Keep the quotation marks.** Match them up line by line: `apiKey` to `apiKey`, `projectId` to `projectId`, and so on.

   The easiest way: carefully select the whole `firebaseConfig = { ... }` block in your editor and replace it with the whole block Firebase showed you. Just make sure it still starts with `const firebaseConfig = {`.

4. **Save** the file (File → Save). Keep the name **index.html**.

That's the database connected. Now we put the app online.

---

## Part 2 — Put the app online (Netlify)

This gives the app a web link your family can open.

1. Go to **https://app.netlify.com/drop** in your browser.
2. You'll see a box that says *"Drag and drop your site folder here."*
3. Drag the **whole folder** containing the app files (index.html, bucky.png, manifest.webmanifest) into that box. (Dragging the folder keeps the icon working. If you drag files individually, be sure to include all three.)
4. Wait a few seconds. Netlify gives you a link like **https://random-name-12345.netlify.app**.
5. **That link is your app.** Open it on your phone to test it.

> Optional, recommended: create a free Netlify account (the page will offer this) so your link stays permanent and you can give it a nicer name under *Site settings → Change site name*, e.g. `kreusser-farm-chores.netlify.app`.

> **When you make changes later** (like editing the app), just go back to **https://app.netlify.com/drop** and drag the whole folder in again, or use your account's "Deploys" page to drag-and-drop an update. Always keep index.html, bucky.png, and manifest.webmanifest together.

---

## Part 3 — Put it on everyone's phone

Send the Netlify link to your family (text, email, whatever). On each phone:

**Android (Chrome):**
1. Open the link in Chrome.
2. Tap the **⋮** menu (top right) → **Add to Home screen** → **Add**.
3. A 🚜 "Farm Chores" icon appears on the home screen. Tapping it opens the app full-screen, like a normal app.

**iPhone (Safari)**, in case anyone has one:
1. Open the link in Safari.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.

**Set your name:** Each person taps the **👤 button** at the top once and types their name. From then on, when they complete a chore, everyone sees "Done by [name]."

---

## How to use it day to day

- **Tap the circle** next to a chore to mark it done (tap again to undo).
- **Daily / Weekly / Monthly / Yearly** tabs along the top switch between chore types.
- **+ button** (bottom right) adds a new chore — type its name and pick how often.
- **✎ pencil** on any chore edits or deletes it.
- Chores reset on their own: daily ones clear overnight, weekly at the start of the week, etc.
- The bar under the title shows your sync status. Green dot + "Synced with your family" means everything's working.

---

## Part 4 — A quick note on security (optional, do later)

Firebase "test mode" allows anyone who has your database details to read and write, and after about 30 days it stops allowing writes until you update the rules. It's fine to start here, but when you have a few minutes:

1. In Firebase, go to **Firestore Database → Rules**.
2. Replace what's there with this and click **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```

This keeps the app working without the 30-day expiry. For a private family app whose link you don't share publicly, this is a reasonable setup. If you'd ever like a proper family password instead, just ask me and I'll add one.

---

## Part 5 — Work-order email alerts (optional)

When you assign a work order to a family member, BUCKY can automatically email them — so they're notified even with the app closed. This uses a free service called **EmailJS**. The app works fine without this; alerts just won't send until it's set up.

**First, add your family members in the app:** tap the 👤 button (top-right) → add each person with their **name and email** → tap "This is me" on your own name. Assignees come from this list.

**Then set up EmailJS:**

1. Go to **https://www.emailjs.com** and create a free account.
2. **Add an Email Service** (Email Services → Add New Service) — connect your Gmail (or other) account. Note the **Service ID**.
3. **Create a Template** (Email Templates → Create New Template). In the template settings, set **To Email** to `{{to_email}}`. Use these placeholders so one template works for both "assigned" and "completed" emails:
   - Subject: `{{subject}}`
   - Body: `Hi {{to_name}},

{{message}}

— sent from BUCKY by {{from_name}}`
   Note the **Template ID**.
4. In **Account → General**, copy your **Public Key**.
5. Open **index.html** in a text editor, find the `EMAILJS` line near the top, and paste the three values:

   ```
   const EMAILJS = { publicKey: "your-public-key", serviceId: "your-service-id", templateId: "your-template-id" };
   ```

6. Save and re-deploy the folder to Netlify.

Now, whenever someone is assigned a work order (and they have an email on their profile), they'll get an email. Note: this fires when the assignee is **first set or changed**, not on every little edit.

---

## If something doesn't work

- **Bar says "This phone only" after pasting settings:** Double-check you replaced all six `PASTE_HERE` values and kept the quotation marks, then re-upload to Netlify. Make sure you saved the file.
- **"Sync error" message:** Usually the Firestore database wasn't created (Part 1, Step 2) or the rules expired (Part 4). 
- **Changes don't show on other phones:** Make sure everyone is opening the **same Netlify link**, and that each phone shows the green "Synced" status.
- **Stuck anywhere:** Tell me exactly what the screen says and I'll walk you through it.

You've got this. 🚜
