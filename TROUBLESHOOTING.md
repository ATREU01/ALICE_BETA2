# 🔧 ALICE ORACLE - TROUBLESHOOTING GUIDE

## Common Issues & Solutions

### 🚨 DEPLOYMENT ISSUES

#### Problem: "Cannot find module"
**Cause:** Missing files
**Solution:**
```bash
# Ensure all files are present
ls -la
# Should see: server.js, index.html, scanner.html, package.json
```

#### Problem: "Port already in use"
**Cause:** Another service on port 8080
**Solution:**
```bash
# Kill existing process
lsof -ti:8080 | xargs kill -9

# Or use different port
PORT=3000 node server.js
```

#### Problem: Railway/Render deploy failed
**Cause:** Missing package.json or wrong start command
**Solution:**
- Ensure package.json exists
- Verify start command: `node server.js`
- Check logs in Railway/Render dashboard

---

### 🔑 ACCESS CODE ISSUES

#### Problem: "Access code already used"
**Cause:** Codes are single-use by design
**Solution:**
```javascript
// For testing: Enable dev mode in server.js
// Set environment variable
NODE_ENV=development node server.js

// Or add more codes in server.js:
const VALID_CODES = new Set([
    'ALICE2025',
    'YOUR_NEW_CODE'
]);
```

#### Problem: Code not working
**Cause:** Case sensitivity or typo
**Solution:**
- Codes are UPPERCASE only
- Try: ALICE2025 (not alice2025)
- No spaces before/after

---

### 📊 DATA ISSUES

#### Problem: No tokens showing
**Cause:** CoinGecko API rate limit or connection issue
**Solution:**
System automatically shows mock data as fallback. Wait 1 minute and try again.

```bash
# Check server logs
node server.js
# Look for: "⚠️ Got HTML error page" or timeout messages
```

#### Problem: Cosmic data not updating
**Cause:** NOAA API timeout
**Solution:**
System uses defaults when API fails:
- Moon: Calculated locally (always works)
- Kp: Falls back to 3 (Moderate)

---

### 🎨 UI ISSUES

#### Problem: Page looks broken/unstyled
**Cause:** CSS not loading or wrong file path
**Solution:**
```bash
# Verify file structure
ALICE_FINAL/
├── server.js
├── index.html      ← CSS is inline
├── scanner.html    ← CSS is inline
└── package.json
```

#### Problem: "Cannot read property of undefined"
**Cause:** JavaScript error in browser
**Solution:**
- Open browser console (F12)
- Check for errors
- Clear browser cache
- Hard refresh (Ctrl+Shift+R)

---

### 🔄 AUTO-REFRESH ISSUES

#### Problem: Scanner not auto-refreshing
**Cause:** JavaScript setTimeout not running
**Solution:**
Check scanner.html line ~450:
```javascript
// Should be present at bottom:
setInterval(performScan, 60000);  // 60 seconds

// To change interval:
setInterval(performScan, 30000);  // 30 seconds
```

---

### 🌐 API ISSUES

#### Problem: "429 Too Many Requests"
**Cause:** CoinGecko rate limit (10-50 calls/min free tier)
**Solution:**
```bash
# System auto-handles this with fallback
# Just wait 60 seconds between scans

# To reduce API calls, increase refresh interval
# in scanner.html:
setInterval(performScan, 120000);  // 2 minutes
```

#### Problem: "CORS error"
**Cause:** Missing CORS headers
**Solution:**
Already handled in server.js:
```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
```
If still seeing errors, check browser console.

---

### 💾 SESSION ISSUES

#### Problem: Redirected to login after refreshing scanner
**Cause:** Session cleared
**Solution:**
```javascript
// Session is stored in browser sessionStorage
// It clears on browser close (by design)

// To persist longer, change in index.html:
localStorage.setItem('aliceAccess', 'granted');

// And in scanner.html:
if (localStorage.getItem('aliceAccess') !== 'granted') {
```

---

### 🔍 DEBUGGING TIPS

#### Enable Verbose Logging
```bash
# Server logs everything automatically
node server.js

# Watch for:
✅ = Success
⚠️ = Warning (still works, using fallback)
❌ = Error
```

#### Check Network Requests
1. Open scanner page
2. Press F12 (DevTools)
3. Go to Network tab
4. Click "Scan Now"
5. Look for:
   - `/api/analyze` request
   - Response should be JSON with tokens

#### Test API Directly
```bash
# In terminal:
curl http://localhost:8080/api/analyze

# Should return JSON with tokens and cosmic data
```

---

### ⚡ PERFORMANCE ISSUES

#### Problem: Slow loading
**Cause:** CoinGecko API delay
**Solution:**
Normal! Each scan takes 2-5 seconds because:
- Fetches 10 trending tokens
- Gets detailed data for each
- Calculates RSI from 14 days of prices
- Contacts NOAA for Kp index

To improve:
```javascript
// Reduce tokens analyzed in server.js:
const tokensToAnalyze = trending.slice(0, 5); // Only 5 instead of 10
```

#### Problem: High memory usage
**Cause:** Normal for Node.js
**Solution:**
System is stateless and memory-efficient:
- No database
- No caching
- Each scan is independent

Typical usage: 50-100 MB RAM

---

### 🆘 STILL NOT WORKING?

#### Quick Reset
```bash
# 1. Stop server
Ctrl+C

# 2. Check all files present
ls -la

# 3. Restart fresh
node server.js

# 4. Test in browser
http://localhost:8080
```

#### Nuclear Option - Fresh Deploy
```bash
# 1. Delete and re-extract files
rm -rf ALICE_FINAL
# Re-download from outputs

# 2. Fresh git repo
cd ALICE_FINAL
git init
git add .
git commit -m "Fresh ALICE"

# 3. Redeploy to Railway/Render
```

---

### 📞 SUPPORT CHECKLIST

Before asking for help, verify:

- [ ] All 6 files present (server.js, index.html, scanner.html, package.json, README.md, DEPLOY.md)
- [ ] Node.js 14+ installed (`node --version`)
- [ ] Server starts without errors (`node server.js`)
- [ ] Can access http://localhost:8080
- [ ] Access code works (ALICE2025)
- [ ] Browser console has no errors (F12)
- [ ] Network tab shows successful API calls

---

### 🎯 KNOWN LIMITATIONS

1. **CoinGecko Free Tier:**
   - 10-50 API calls per minute
   - System handles this with smart fallbacks

2. **Single-Use Codes:**
   - By design for security
   - Use NODE_ENV=development for testing

3. **No Historical Data:**
   - System is real-time only
   - No database = can't store past scans

4. **Browser Compatibility:**
   - Modern browsers only (Chrome, Firefox, Safari, Edge)
   - IE11 not supported

---

### ✅ VERIFICATION CHECKLIST

System is working correctly if:

✅ Landing page loads with cyberpunk aesthetic
✅ Access code validation works
✅ Scanner page shows Moon phase and Kp index
✅ 10 tokens display with all analysis layers
✅ Each token has a master score and signal
✅ Auto-refresh works (check Last Update time)
✅ No errors in browser console
✅ No errors in server terminal

---

## 🚀 EVERYTHING WORKING?

**Congratulations!** Your ALICE Oracle is fully operational.

Next steps:
1. Deploy to Railway/Render (see DEPLOY.md)
2. Share URL with investors
3. Distribute access codes
4. Celebrate! 🎉

---

*For deployment help, see DEPLOY.md*
*For system details, see README.md*
*For architecture, see SYSTEM_DIAGRAM.txt*
