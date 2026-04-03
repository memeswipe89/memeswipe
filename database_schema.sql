-- Create user_wallets table for Memeswipe onboarding
-- Run this in your Supabase SQL editor

-- First, let's check and fix the twitter_connections table structure
-- The error indicates the table name is "twitter_connections" (plural)

-- Check if twitter_connections table exists and has the right structure
DO $$
BEGIN
  -- If table doesn't exist, create it
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'twitter_connections') THEN
    CREATE TABLE twitter_connections (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      twitter_user_id TEXT NOT NULL UNIQUE,
      twitter_username TEXT NOT NULL,
      connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  ELSE
    -- Table exists, ensure it has the right columns (but don't add another primary key)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'twitter_connections' AND column_name = 'id') THEN
      ALTER TABLE twitter_connections ADD COLUMN id SERIAL;
      -- Only add primary key if it doesn't exist
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'twitter_connections_pkey' AND table_name = 'twitter_connections') THEN
        ALTER TABLE twitter_connections ADD PRIMARY KEY (id);
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'twitter_connections' AND column_name = 'user_id') THEN
      ALTER TABLE twitter_connections ADD COLUMN user_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'twitter_connections' AND column_name = 'twitter_user_id') THEN
      ALTER TABLE twitter_connections ADD COLUMN twitter_user_id TEXT UNIQUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'twitter_connections' AND column_name = 'twitter_username') THEN
      ALTER TABLE twitter_connections ADD COLUMN twitter_username TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'twitter_connections' AND column_name = 'connected_at') THEN
      ALTER TABLE twitter_connections ADD COLUMN connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'twitter_connections' AND column_name = 'updated_at') THEN
      ALTER TABLE twitter_connections ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
  END IF;
END $$;

-- Create user_wallets table
CREATE TABLE IF NOT EXISTS user_wallets (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  privy_user_id TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure a simple users table exists so orders can reference its foreign key.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: Foreign key constraint removed for flexibility
-- The relationship between twitter_connections and user_wallets is managed in application code
-- to allow for more complex user management scenarios

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_privy_user_id ON user_wallets(privy_user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_wallet_address ON user_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_wallets_email ON user_wallets(email);

-- Indexes for twitter_connections
CREATE INDEX IF NOT EXISTS idx_twitter_connections_user_id ON twitter_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_twitter_connections_twitter_user_id ON twitter_connections(twitter_user_id);

-- Add RLS (Row Level Security) policies
-- Note: These policies assume Privy user IDs are stored in auth.users
-- Adjust based on your authentication setup
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'user_wallets'
      AND policyname = 'Users can view own wallet'
  ) THEN
    CREATE POLICY "Users can view own wallet" ON user_wallets
      FOR SELECT USING (auth.uid()::text = privy_user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'user_wallets'
      AND policyname = 'Users can insert own wallet'
  ) THEN
    CREATE POLICY "Users can insert own wallet" ON user_wallets
      FOR INSERT WITH CHECK (auth.uid()::text = privy_user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'user_wallets'
      AND policyname = 'Users can update own wallet'
  ) THEN
    CREATE POLICY "Users can update own wallet" ON user_wallets
      FOR UPDATE USING (auth.uid()::text = privy_user_id);
  END IF;
END $$;

-- Enable RLS on twitter_connections too
ALTER TABLE twitter_connections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'twitter_connections'
      AND policyname = 'Users can view own twitter connections'
  ) THEN
    CREATE POLICY "Users can view own twitter connections" ON twitter_connections
      FOR SELECT USING (auth.uid()::text = user_id::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'twitter_connections'
      AND policyname = 'Users can insert own twitter connections'
  ) THEN
    CREATE POLICY "Users can insert own twitter connections" ON twitter_connections
      FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'twitter_connections'
      AND policyname = 'Users can update own twitter connections'
  ) THEN
    CREATE POLICY "Users can update own twitter connections" ON twitter_connections
      FOR UPDATE USING (auth.uid()::text = user_id::text);
  END IF;
END $$;

-- Track protocol fees for swaps
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fee_amount_usd numeric DEFAULT 0;
