Trading Capital Tracker - Version 2.1

What's new
- Exit date/time is visible directly in the Trade Journal.
- Average realized exit price is visible directly in the Trade Journal.
- Trade Details prominently shows first exit, final exit, average exit price, and full sale history.
- Edit now shows every recorded sale/exit for that trade.
- Each sale can be edited after closing, including exit date/time, quantity, price, fees, notes, plan-followed flag, and recalculated settlement.
- T+1 settlement is recalculated from the EXIT date whenever an exit is edited.
- Partial exits remain supported.
- Version 2 data is preserved because Version 2.1 uses the same local storage key.

Upgrade
1. Export a JSON backup from Version 2 first.
2. Replace index.html, app.js, styles.css, sw.js, and manifest.webmanifest in GitHub with the Version 2.1 copies.
3. Commit the changes.
4. Wait for GitHub Pages to redeploy.
5. Hard-refresh the app (Ctrl+Shift+R on Windows) if Version 2 appears cached.
6. Confirm your existing contributions and trades are still present.

Your Version 2 data should remain in the browser automatically. Keep the backup until you verify the upgrade.
