-- Run this once against the same Supabase project QueckSilver AI / Search
-- already use (Supabase SQL editor, or `supabase db push` if you use the
-- CLI). Not something the app itself can run — needs a DB role with
-- permission to create tables and RLS policies.
--
-- One row per QueckSilver-account user, holding that account's synced
-- browser data: header favorites, the 5 home-page bookmark slots,
-- passwords, and misc settings (search engine, theme, ...). Only
-- QueckSilver-linked profiles sync here — simple (name-only) profiles and
-- guest mode never touch this table at all, see electron/supabase-sync.ts.

create table if not exists public.search_profile_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  header_favorites jsonb not null default '[]'::jsonb,
  bookmarks jsonb not null default '[]'::jsonb,
  passwords jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.search_profile_data enable row level security;

-- Each user can only ever read/write their own row — auth.uid() comes from
-- the JWT the app sends as the Authorization bearer token (the QueckSilver
-- account's own access token, same one used for search-chat).
create policy "search_profile_data_own_row"
  on public.search_profile_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
