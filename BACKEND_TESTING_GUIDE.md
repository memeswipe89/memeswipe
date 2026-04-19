# Backend Stability Testing Guide

Before submitting to the App Store, ensure your backend is stable and reliable.

## Critical Endpoints to Test

Your API base: `https://memeswipe.onrender.com`

### 1. **Health Check**
Test that the server is responding:
```bash
curl https://memeswipe.onrender.com/health
```
Expected: 200 OK response

### 2. **Token Feed Endpoints**
These are the most critical for app functionality:

```bash
# Graduated tokens (PumpFun)
curl https://memeswipe.onrender.com/api/graduated

# Bags tokens
curl https://memeswipe.onrender.com/api/bags

# Multi-source feed
curl https://memeswipe.onrender.com/api/multi-source-feed
```

Expected: 200 OK with JSON array of tokens

### 3. **User Onboarding**
```bash
curl -X POST https://memeswipe.onrender.com/api/onboard-user \
  -H "Content-Type: application/json" \
  -d '{
    "privy_user_id": "test-user-id",
    "twitter_user_id": "123456",
    "twitter_username": "testuser",
    "email": "test@example.com",
    "wallet_address": "test-wallet-address"
  }'
```

Expected: 200 OK with user_id

### 4. **Trade Endpoints**
```bash
# Get user trades
curl https://memeswipe.onrender.com/api/trades?userId=test-user-id

# Create order (test with valid data)
curl -X POST https://memeswipe.onrender.com/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-id",
    "tokenAddress": "test-token",
    "amountUsd": 10
  }'
```

## Testing Checklist

### Before Submission:
- [ ] All endpoints respond within 2 seconds
- [ ] No 502/503 errors (backend down)
- [ ] No 500 errors (server crashes)
- [ ] Error responses include helpful messages
- [ ] API handles invalid requests gracefully
- [ ] Database connections are stable
- [ ] Rate limiting is configured (if needed)

### During Review (Monitor):
- [ ] Backend stays online 24/7
- [ ] Response times remain fast
- [ ] No memory leaks or crashes
- [ ] Logs show no critical errors

## Common Issues & Solutions

### Issue: 502 Bad Gateway
**Cause:** Backend server is starting up or crashed
**Solution:** 
- Ensure your Render.com service is always running
- Upgrade to paid plan for better uptime
- Add health check endpoint
- Configure auto-restart on crash

### Issue: Slow Response Times
**Cause:** Cold starts, database queries, external API calls
**Solution:**
- Cache frequently accessed data
- Optimize database queries
- Use connection pooling
- Consider CDN for static assets

### Issue: HTML Response Instead of JSON
**Cause:** Backend returning error page instead of JSON
**Solution:**
- Add proper error handling
- Always return JSON responses
- Check Content-Type headers

## Render.com Specific

Your backend is hosted on Render.com. Important notes:

1. **Free tier sleeps after 15 minutes of inactivity**
   - First request after sleep takes 30-60 seconds
   - **Recommendation:** Upgrade to paid plan ($7/month) for always-on service

2. **Monitor your service:**
   - Check Render.com dashboard for uptime
   - Set up alerts for downtime
   - Review logs regularly

3. **During App Store Review:**
   - Keep service awake (ping every 10 minutes)
   - Monitor logs for reviewer activity
   - Be ready to fix issues quickly

## Testing Script

Create a simple test script to verify all endpoints:

```bash
#!/bin/bash

API_BASE="https://memeswipe.onrender.com"

echo "Testing backend stability..."

# Test health
echo "1. Health check..."
curl -s -o /dev/null -w "%{http_code}" $API_BASE/health
echo ""

# Test graduated feed
echo "2. Graduated feed..."
curl -s -o /dev/null -w "%{http_code}" $API_BASE/api/graduated
echo ""

# Test bags feed
echo "3. Bags feed..."
curl -s -o /dev/null -w "%{http_code}" $API_BASE/api/bags
echo ""

# Test multi-source feed
echo "4. Multi-source feed..."
curl -s -o /dev/null -w "%{http_code}" $API_BASE/api/multi-source-feed
echo ""

echo "Testing complete!"
```

Save as `test-backend.sh`, make executable with `chmod +x test-backend.sh`, and run before submission.

## Recommendation

**Before App Store submission:**
1. Run the test script above
2. Verify all endpoints return 200 OK
3. Check response times are under 2 seconds
4. Consider upgrading Render.com to paid plan for better reliability
5. Set up monitoring/alerts for downtime

**During App Store review:**
- Monitor backend logs
- Keep service awake
- Be ready to respond to issues within hours

Your backend is the foundation of your app - make sure it's rock solid before submission!
