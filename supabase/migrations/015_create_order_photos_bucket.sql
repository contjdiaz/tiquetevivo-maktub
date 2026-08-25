-- Migration: Create order-photos storage bucket with private access
-- Requirements: 5.1, 5.2 — Photo storage in Supabase Storage
-- Storage path convention: {business_id}/{order_id}/intake.{ext}
--                          {business_id}/{order_id}/delivery.{ext}

-- Create the order-photos bucket (private, not public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-photos',
  'order-photos',
  false,
  5242880, -- 5 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

-- RLS policies for the order-photos bucket
-- Only service_role can perform operations (Netlify Functions use service_role key)

-- Deny all access via anon/authenticated roles (service_role bypasses RLS)
-- This ensures only backend functions with the service_role key can upload/read photos

-- Remove any existing permissive policies on this bucket's objects
DROP POLICY IF EXISTS "Service role manages order photos" ON storage.objects;
DROP POLICY IF EXISTS "Deny public read on order-photos" ON storage.objects;
DROP POLICY IF EXISTS "Deny public insert on order-photos" ON storage.objects;
DROP POLICY IF EXISTS "Deny public update on order-photos" ON storage.objects;
DROP POLICY IF EXISTS "Deny public delete on order-photos" ON storage.objects;

-- Since RLS is enabled on storage.objects by default in Supabase,
-- and service_role bypasses RLS, we only need to ensure NO permissive
-- policies exist for authenticated/anon roles on this bucket.
-- The absence of permissive policies + RLS enabled = deny all for non-service-role.

-- Explicitly deny all operations for authenticated users on this bucket
CREATE POLICY "Deny public read on order-photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'order-photos' AND false);

CREATE POLICY "Deny public insert on order-photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'order-photos' AND false);

CREATE POLICY "Deny public update on order-photos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'order-photos' AND false);

CREATE POLICY "Deny public delete on order-photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'order-photos' AND false);
