# Memeswipe Onboarding Flow

This document describes the secure onboarding flow for the Memeswipe React Native trading app.

## Overview

The onboarding flow ensures that every user:
1. Connects their Twitter account
2. Verifies their email for account recovery
3. Gets a Privy embedded wallet
4. Links everything to a Supabase user record

## Architecture

### Frontend (React Native)
- **Privy SDK**: Handles authentication and wallet creation
- **Onboarding Screen**: Step-by-step user interface
- **Auth Context**: Manages user state and wallet information

### Backend (Node.js)
- **Onboarding Endpoint**: `/api/onboard-user`
- **Supabase Integration**: Stores user data and wallet information
- **Security Validation**: Verifies Privy identity tokens

### Database (Supabase PostgreSQL)
- **twitter_connection**: Links Twitter accounts to users
- **user_wallets**: Stores wallet information and email recovery

## Setup Instructions

### 1. Database Setup

Run the SQL schema in your Supabase SQL editor:

```sql
-- Execute the contents of database_schema.sql
```

This creates the `user_wallets` table and sets up proper indexes and RLS policies.

### 2. Environment Variables

#### Backend (.env)
```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

#### Frontend (.env)
```env
EXPO_PUBLIC_PRIVY_APP_ID=your_privy_app_id
EXPO_PUBLIC_PRIVY_CLIENT_ID=your_privy_client_id
EXPO_PUBLIC_API_BASE=http://localhost:3001
```

### 3. Privy Dashboard Configuration

1. Go to your Privy dashboard
2. Configure login methods: Twitter + Email
3. Enable embedded wallets with "Create on Login" for users without wallets
4. Set up Twitter OAuth credentials

## Flow Details

### User Journey

1. **App Launch**: User opens Memeswipe
2. **Onboarding Screen**: Shows 3-step process
3. **Twitter Connect**: User taps "Connect Twitter"
4. **Privy Modal**: Handles Twitter OAuth + Email verification + Wallet creation
5. **Backend Sync**: App sends user data to `/api/onboard-user`
6. **Database Update**: Twitter connection and wallet are stored
7. **Trading Screen**: User enters the main app

### Security Rules

1. **One Twitter = One Wallet**: System prevents duplicate wallet creation for the same Twitter account
2. **Privy Verification**: Backend validates all identity tokens
3. **Wallet Verification**: Never trusts wallet addresses from frontend without verification
4. **Email Recovery**: Email is stored for account recovery

### API Endpoint: POST /api/onboard-user

**Request Body:**
```json
{
  "privy_user_id": "privy_user_123",
  "twitter_user_id": "123456789",
  "twitter_username": "johndoe",
  "email": "john@example.com",
  "wallet_address": "ABC123..."
}
```

**Response:**
```json
{
  "success": true,
  "user_id": "uuid-here",
  "existing_user": false,
  "wallet_exists": false
}
```

### Database Tables

#### twitter_connections
- `id` (SERIAL): Primary key
- `user_id` (UUID): Links to user_wallets
- `twitter_user_id`: Twitter's user ID
- `twitter_username`: Twitter handle
- `connected_at`: Timestamp
- `updated_at`: Timestamp

#### user_wallets
- `id` (SERIAL): Primary key
- `user_id` (UUID): Foreign key to twitter_connections
- `privy_user_id`: Privy's user identifier
- `wallet_address`: Solana wallet address
- `email`: User's email for recovery
- `created_at`: Timestamp
- `updated_at`: Timestamp

## Testing

### Manual Testing

1. Start the API server: `npm start` in `/apps/api`
2. Start the mobile app: `npx expo start` in `/apps/mobile`
3. Clear app data to simulate first-time user
4. Go through the onboarding flow
5. Verify data is stored in Supabase

### Automated Testing

```bash
# Test the onboarding endpoint
curl -X POST http://localhost:3001/api/onboard-user \
  -H "Content-Type: application/json" \
  -d '{
    "privy_user_id": "test_user",
    "twitter_user_id": "123",
    "twitter_username": "testuser",
    "email": "test@example.com",
    "wallet_address": "test_wallet_address"
  }'
```

## Troubleshooting

### Common Issues

1. **Privy not configured**: Check EXPO_PUBLIC_PRIVY_APP_ID in .env
2. **Database connection failed**: Verify SUPABASE_URL and keys
3. **Twitter OAuth fails**: Check Privy dashboard Twitter configuration
4. **Wallet not created**: Ensure embedded wallets are enabled in Privy

### Debug Commands

```bash
# Check API health
curl http://localhost:3001/health

# Check database tables
# Use Supabase dashboard or psql

# Check Privy user state
# Use React Native debugger
```

## Security Considerations

1. **Token Validation**: Always verify Privy identity tokens on backend
2. **Input Sanitization**: Validate all user inputs
3. **Rate Limiting**: Implement rate limiting on onboarding endpoint
4. **Audit Logging**: Log all onboarding attempts
5. **Data Encryption**: Sensitive data should be encrypted at rest

## Future Enhancements

1. **Multi-device sync**: Allow users to access wallets across devices
2. **Social recovery**: Additional recovery methods beyond email
3. **Wallet migration**: Allow users to import external wallets
4. **Advanced KYC**: Enhanced verification for high-volume traders