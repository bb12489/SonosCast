# SonosCast - Implementation Checklist

## Phase 1: Infrastructure ✅ COMPLETE

- [x] Created DeviceRegistry module for persistent device IDs
- [x] Modified Bridge to use DeviceRegistry
- [x] Modified CastDevice to accept persisted certificates
- [x] Fixed mDNS duplicate name issue with IP suffixes
- [x] Updated DOCS.md with HA Cast integration guidance
- [x] Committed device persistence (1f02a9f)
- [x] Pushed to GitHub successfully

## Phase 2: Authentication Framework ✅ COMPLETE

- [x] Created cast-auth.js module structure
- [x] Added device certificate (AUTH_CRT) from AirReceiver
- [x] Added ICA certificate from Chromecast
- [x] Implemented date-based signature lookup
- [x] Implemented protobuf AuthResponse encoding
- [x] Integrated authentication handler into cast-device.js
- [x] Updated _handleDeviceAuth to use Shanocast bypass
- [x] Removed unused code (crypto module, generatePeerCertificate)
- [x] Verified no syntax errors

## Phase 3: Signature Data ⏳ IN PROGRESS

- [ ] Download shanocast.patch from rgerganov/shanocast repo
- [ ] Run extract-signatures.js script to parse C hex arrays
- [ ] Convert extracted JSON to JavaScript Buffer format
- [ ] Update SIGNATURES object in cast-auth.js with all 795 entries
- [ ] Verify date coverage: 2023-08-15 to 2027-12-21
- [ ] Verify signature size (256 bytes each, ~195KB total)

## Phase 4: Deployment & Testing ⏳ PENDING

- [ ] Commit cast-auth.js, cast-device.js changes to Git
- [ ] Update CHANGELOG.md with authentication feature
- [ ] Update README.md mentioning YouTube Music support
- [ ] Push changes to GitHub
- [ ] Rebuild addon: `ha addons rebuild 94dc51a4_sonoscast`
- [ ] Verify addon starts without errors
- [ ] Check device persistence working (from Phase 1)

## Phase 5: Authentication Verification ⏳ PENDING

### Chrome Browser Testing
- [ ] Open Chrome on desktop/laptop
- [ ] Visit website with Cast-enabled content
- [ ] Click Cast button in Chrome
- [ ] Verify SonosCast devices appear in menu
- [ ] Select a SonosCast device
- [ ] Monitor logs for "Auth response sent (Shanocast bypass)"
- [ ] Verify authentication succeeds (no AUTH_ERROR logs)
- [ ] Test actual media playback

### YouTube Music App Testing
- [ ] Open YouTube Music mobile app
- [ ] Tap Cast button
- [ ] Verify SonosCast devices appear in list
- [ ] Select a SonosCast device
- [ ] Start playing a song
- [ ] Monitor logs for authentication success
- [ ] Verify audio streams to Sonos speaker
- [ ] Test pause/resume/skip controls

### Spotify Testing (if applicable)
- [ ] Open Spotify app
- [ ] Tap "Devices Available" button
- [ ] Check if SonosCast devices appear
- [ ] Attempt to connect
- [ ] Note: Spotify may use different protocol

## Phase 6: Log Monitoring & Debugging ⏳ PENDING

- [ ] SSH into Home Assistant: `ssh root@192.168.1.224`
- [ ] Start log monitoring: `ha addons logs 94dc51a4_sonoscast --follow`
- [ ] Watch for key messages:
  - `[CastAuth] Using signature for YYYYMMDD`
  - `[CastAuth] AuthResponse: signature=256bytes`
  - `[CastDevice] Auth response sent (Shanocast bypass)`
  - `[CastDevice] Device auth challenge received`
- [ ] Verify NO messages like:
  - `[CastAuth] No signature found for date`
  - `[CastDevice] Auth handler failed`
  - `Failed to send auth error`

## Phase 7: Documentation ⏳ PENDING

- [ ] Document working browser/apps in DOCS.md
- [ ] Update claude.md with authentication status
- [ ] Add "Known Limitations" section:
  - Signatures expire Dec 21, 2027
  - Chrome vulnerability may be patched
  - Only works with Chrome-based Cast senders
- [ ] Create user guide for YouTube Music setup
- [ ] Add troubleshooting section for auth failures

## Phase 8: Long-Term Maintenance 📅 FUTURE

- [ ] Set calendar reminder for Dec 2027 (signature expiration)
- [ ] Monitor Chrome Cast SDK updates
- [ ] Watch Shanocast repo for updated signatures
- [ ] Consider automated signature extraction on addon startup
- [ ] Explore OpenScreen-based solution for signature generation

---

## Critical Path (Minimum Viable Implementation)

To enable YouTube Music casting **today**, complete:

1. ✅ Phases 1-2 (Infrastructure + Framework)
2. ⏳ Phase 3: Extract and add all signatures
3. ⏳ Phase 4: Deploy to Home Assistant
4. ⏳ Phase 5: Test with YouTube Music app

**Estimated Time Remaining:** 2-3 hours
- Signature extraction: 30-60 min
- Git commit & deploy: 15 min
- Testing & debugging: 60-90 min

---

## Current Blockers

### Signature Data Extraction

**Status:** Extraction script created (`scripts/extract-signatures.js`)

**Next Action:** Download shanocast.patch and run extraction

**Commands:**
```bash
cd c:\Users\bryan\OneDrive\Documents\GitHub\SonosCast

# Download the patch
curl -o shanocast.patch https://raw.githubusercontent.com/rgerganov/shanocast/master/shanocast.patch

# Extract signatures
node scripts/extract-signatures.js < shanocast.patch > signatures.json

# Convert to JavaScript (manual)
# Open signatures.json
# Transform each array entry to Buffer.from([...])
# Paste into cast-auth.js SIGNATURES object
```

**Alternative:** Use PowerShell:
```powershell
$patch = Invoke-WebRequest -Uri "https://raw.githubusercontent.com/rgerganov/shanocast/master/shanocast.patch"
$patch.Content | node scripts\extract-signatures.js > signatures.json
```

---

## Success Indicators

### You'll know it's working when:

1. **Logs show successful auth:**
   ```
   [CastAuth] Using signature for 20260222 (valid until 2026-02-24T00:00:00.000Z)
   [CastDevice] [Living Room (Cast-247)] Auth response sent (Shanocast bypass)
   ```

2. **YouTube Music shows devices:**
   - Tap Cast button
   - See "Living Room (Cast-247)", "Desk (Cast-66)", etc.
   - Devices selectable (not grayed out)

3. **Media plays after authentication:**
   ```
   [CastDevice] Media: LOAD from sender-0
   [Bridge] [Living Room] Loading media: https://...
   [Bridge] [Living Room] Playback started
   ```

4. **No authentication errors:**
   - No "AUTH_ERROR" messages
   - No "No signature found" warnings
   - No "Auth handler failed" errors

---

## Rollback Plan

If authentication causes issues:

1. **Disable auth handler:**
   - Comment out castAuth.handleAuthChallenge() call
   - Revert to auth error response
   - Rebuild addon

2. **Keep device persistence:**
   - DeviceRegistry functionality is independent
   - Can keep 1f02a9f commit changes
   - Only revert cast-auth.js integration

3. **Test with HA Cast integration:**
   - Music Assistant still works (doesn't require auth)
   - HA automations still functional
   - Only Chrome/YouTube affected

---

**Status as of:** February 22, 2026, 11:45 PM  
**Next Milestone:** Complete Phase 3 signature extraction  
**Deployment Target:** HA addon rebuild test firing within 24 hours
