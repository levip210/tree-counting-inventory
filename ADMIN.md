# Powers Tree Farm Counting — Administrator how-tos

Powers Tree Farm (Lansing, NC) loading-yard counting. These twenty procedures match the product brief. The app is a counter, not a warehouse system.

## 1. Create the first administrator

1. Open the website on a computer or tablet **before anyone else**.
2. You should see **First administrator setup**.
3. Enter **Name**, **Email**, and a **secure password** (10+ characters, letters and numbers).
4. Tap **Create administrator**.

After this:

- The public setup page is **permanently disabled**.
- Another visitor cannot create themselves as admin.
- You are signed in and sent to the admin dashboard checklist.

If someone else already completed setup, `/setup` redirects to login.

## 2. Sign in with email and password

1. Open the site → **Admin email & password**.
2. Enter the admin email and password.
3. You land on **Home**.

Use this whenever a Quick Login PIN is forgotten or was never set. Email + password is the recovery path.

## 3. Set, change, or remove the Quick Login PIN

On **Admin → Account**:

- **Save PIN** — 4–10 digits. Optional. Lets you use the large numeric keypad.
- **Remove PIN** — turns keypad login off for this admin. A blank PIN never logs anyone in.
- **Reset PIN (requires password)** — clears the PIN after you confirm with the full admin password.

Email + password still works if the PIN is forgotten.

## 4. Use the initial setup checklist (optional)

After the first account, the dashboard shows a checklist:

- Add farms
- Add / confirm sizes
- Add / confirm grades
- Arrange display order
- Create counter-access accounts
- Test Yard Receiving
- Test Shipping
- Test sound and vibration
- Test offline counting
- Find Excel export settings

You do **not** have to finish it before exploring. Check items off as you go, or hide the list.

## 5. Add, rename, deactivate, and reorder farms

**Admin → Farms**

- **Add farm** — name only. The app assigns FarmID, DisplayOrder, Active, CreatedAt, UpdatedAt.
- **Search** — filter by name or id.
- **Up / Down** — display order (Yard Receiving farm list).
- **Rename** — if the farm already has counts, you get a warning. Past counts keep the snapshot name from the moment they were tapped.
- **Deactivate / Reactivate** — only **active** farms appear on Yard Receiving.
- **Delete** — refused when the farm has saved counts; the farm is deactivated instead.

## 6. Add and confirm tree sizes

**Admin → Sizes**

Suggested (editable): 5–6, 6–7, 7–8, 8–9, 9–10, 10+.

Add, rename, deactivate, reactivate, reorder. Optional **color** — use the color picker or paste any hex (`#RRGGBB`). Counting tablets show that color on size labels so crew can glance at color instead of reading the name. Empty means no color. Grades do not have colors.

If a size was used in counts, delete becomes a **soft deactivate**.

## 7. Add and confirm tree grades

**Admin → Grades**

Suggested: Premium, #1, #2. Same pattern as sizes.

## 8. Arrange display order (automatic counting grid)

The Yard Receiving and Shipping grids are the **cartesian product of active sizes × active grades**.

Change a name, add a grade, or deactivate a size — the next time a tablet loads the counting page, the grid updates. No separate “rebuild grid” step.

## 9. Create counter-access accounts

**Admin → Counter access**

For each tablet or crew:

- **Account label** (example: “Yard tablet 2”) — never stored on counts
- **Unique numeric PIN**
- **Active**
- Access: Yard Receiving, Shipping, or Both

Counters have **no email, username, or password**. They use the large keypad on the login screen.

Rules:

- PINs are hashed.
- No two **active** accounts (including an admin Quick PIN) may share a PIN.
- Failed PIN attempts are rate-limited with a temporary lockout.
- Error text is generic (“Login failed.”) so it does not reveal whether a PIN exists.

## 10. Count on Yard Receiving

1. Home → **Yard Receiving**.
2. **Select a farm** (required). The farm name stays large at the top.
3. Tap a size × grade button. One tap = one tree, saved immediately with the tablet’s local timestamp.
4. You should hear a beep, feel vibration if the tablet supports it, see a brief green flash, see totals bump, and see **Last counted**.
5. There is **no confirmation dialog** on a tap.

**Change farm** asks for confirmation, resets **visible** session totals, and does **not** delete saved counts.

## 11. Count on Shipping

Home → **Shipping**. Same automatic grid. No farm, customer, or order. Action is saved as **Shipped**. Farm fields are blank.

## 12. Sound, vibration, and visual feedback

**Admin → Sound / tests**

- Toggle default sound and vibration.
- **Test success** and **Test failed-save warning**.
- Success: beep, vibrate, green flash.
- Failed save: warning sound, red flash, message **Count not saved — tap again**.

A ~250ms guard ignores a second tap on the **same** button only, so a double-tap does not become two trees.

## 13. Count while offline

The site is a PWA. After a tablet has loaded the app once:

1. Turn on airplane mode.
2. Keep tapping. Counts queue on the device (**Pending sync**).
3. When the network returns, the queue uploads.
4. Each count has a temporary sync id used **only** to prevent duplicates. It is not a worker or device identity field on Excel exports.

## 14. Undo the last count (this tablet session only)

On the counting screen, **Undo last** voids the most recent tap from **this browser session**. It does not walk the whole farm’s history. Use **Count history** for older corrections.

**Reset visible session totals** clears the numbers on screen only. Saved counts stay.

**Start counting** / **End session** open and close a counting session id (no who-counted data).

## 15. Review and correct count history

**Admin → Count history**

Filter by action, date, size/grade/farm text, and voided rows.

You can **void** a mis-tap (with a reason) or add a **note**. Totals ignore voided rows.

This screen never shows who counted.

## 16. Read the dashboard

**Admin → Dashboard**

- All-time received and shipped
- **Inventory = Received − Shipped** by size/grade
- Today’s totals and a simple hourly bar (America/New_York unless you change `APP_TIMEZONE`)
- Links into farms, categories, export

Disclaimer (also printed on the dashboard): this is **category counting**, not individual-tree or order inventory.

## 17. Set starting farm inventory

**Admin → Starting inventory**

Enter expected trees per farm × size × grade.

- **Not yet received from farm** = max(0, starting − received)
- If received exceeds starting, the dashboard and Yard Receiving show an **exceed** warning. Taps still save (no extra confirmation).

## 18. Secure Excel / CSV / JSON export

**Admin → Excel export**

This product does **not** build an `.xlsx` workbook. Excel opens CSV/JSON fine.

1. Confirm with your **admin password**.
2. **Create / rotate API key**. Copy it once.
3. Signed-in buttons download counts and starting inventory.
4. External Excel / Power Query:

`GET /api/export/public?kind=counts&format=csv`  
`GET /api/export/public?kind=inventory&format=json`  

Header `Authorization: Bearer YOUR_API_KEY` (or `?key=`).

Exports contain counting fields only — no password hashes, PIN hashes, API keys, or who-counted columns.

Disable the API (password required) to revoke the key.

## 19. Download backups

**Admin → Backups**

JSON bundle or per-table CSV: counts, farms, sizes, grades, sessions, starting inventory, counter labels (no hashes), admin names/emails (no hashes).

Store copies off the tablet, especially before **Danger zone** actions.

## 20. Change email/password, export security, delete data, or reset the site

All of these require the **full admin password**:

| Action | Where |
|---|---|
| Change admin email or password | Admin → Account |
| Reset Quick Login PIN | Admin → Account |
| Create, rotate, or disable Excel API key | Admin → Excel export |
| Delete all counting data | Admin → Danger zone |
| Delete website / database (re-opens first-admin setup) | Admin → Danger zone |

Type the confirmation phrase when asked.

If the password is lost and you still have shell access to the server:

```bash
npm run reset-admin-password -- --email you@farm.com --password 'NewPass12345'
```

Keep `AUTH_SECRET` and the SQLite file (`data/app.db`) as protected as the farm’s paper tally books.
