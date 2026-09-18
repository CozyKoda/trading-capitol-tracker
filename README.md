[README_UPGRADE.txt](https://github.com/user-attachments/files/32360173/README_UPGRADE.txt)
Trading Capital Tracker - Version 2

Upgrade from Version 1
----------------------
1. Export a JSON backup from Version 1 before updating GitHub.
2. Replace index.html, app.js, styles.css, sw.js, and manifest.webmanifest in your GitHub repository with these Version 2 files.
3. The icon files can remain unchanged, or you can upload these copies too.
4. Commit the changes to the same main branch used by GitHub Pages.
5. Wait a minute or two, then refresh your GitHub Pages site.
6. Version 2 automatically migrates Version 1 browser data stored on the same site/origin. Keep the JSON backup anyway.
7. If an installed PWA still shows the old interface, fully close it and reopen it. If needed, refresh the site in the browser once so the new service worker can update.

Important capital-limit behavior
--------------------------------
Automatic mode (recommended): the app's capital limit equals this trading pool's contributions + realized P/L. Long-term holdings outside the app ledger are never counted.
Manual hard cap: total open cost basis is limited to the lower of your chosen cap or the current trading capital. This is useful if you want to intentionally trade less than the full pool.

Settlement
----------
Stock and ETF exits use an estimated T+1 settlement date that skips weekends and standard U.S. securities-market holidays. Extraordinary exchange closures are not predictable and should be verified separately.
Crypto exits do not use stock/ETF T+1 settlement in this tracker.
