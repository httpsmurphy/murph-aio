# Supabase Setup — Murph AIO Checkout Tracking

## 1. Create Project
- Go to https://supabase.com and sign up / log in
- Click "New Project", pick a name (e.g. "murph-aio"), set a DB password, choose region (London)

## 2. Create the `checkouts` table
Go to SQL Editor in your Supabase dashboard and run:

```sql
CREATE TABLE checkouts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  license_key text,
  product_code text,
  quantity int,
  order_number text,
  profile_name text,
  delivery_method text,
  module text DEFAULT 'freemans',
  status text,
  error text,
  duration_seconds numeric,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY;

-- Allow inserts only (anon key can write but not read/update/delete)
CREATE POLICY "Allow inserts" ON checkouts
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Optional: allow reads for your own dashboard
CREATE POLICY "Allow reads" ON checkouts
  FOR SELECT
  TO anon
  USING (true);
```

## 3. Get your credentials
- Go to Settings > API in your Supabase dashboard
- Copy the **Project URL** (looks like `https://abcdefg.supabase.co`)
- Copy the **anon public** key (long string starting with `eyJ...`)

## 4. Update Murph AIO
Open `src/main.js` and replace lines 10-11:

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';   // <-- paste Project URL
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';                 // <-- paste anon key
```

## 5. Restart the app
That's it. Every checkout (success or failure) will now be logged to your Supabase database.
You can view all data from the Supabase dashboard Table Editor.
