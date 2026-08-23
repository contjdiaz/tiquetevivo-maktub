/**
 * Seed script: creates a Supabase Auth user and links it to a business.
 *
 * Usage:
 *   SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-operator.js
 *
 * Or create a .env file in the project root with those variables and run:
 *   node scripts/seed-operator.js
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length > 0 && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env not found, rely on environment variables
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!url || !serviceKey) {
  console.error("❌ Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  console.error("Create a .env file or set the environment variables.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const email = process.argv[2] || "operador@majesty.com";
const password = process.argv[3] || "TiqueteVivo2026!";
const slug = process.argv[4] || "majesty";
const role = process.argv[5] || "owner";

async function main() {
  console.log(`🔍 Looking up business with slug "${slug}"...`);
  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("slug", slug)
    .single();

  if (bizError || !business) {
    console.error("❌ Business not found:", bizError?.message || slug);
    process.exit(1);
  }
  console.log(`✅ Found business: ${business.name} (${business.id})`);

  console.log(`👤 Creating/upserting user ${email}...`);
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  let user = userData?.user;

  if (userError) {
    if (userError.message?.includes("already been registered")) {
      console.log("⚠️ User already exists, fetching by email...");
      const { data: existing } = await supabase.auth.admin.listUsers();
      user = existing?.users?.find((u) => u.email === email);
      if (!user) {
        console.error("❌ Could not find existing user");
        process.exit(1);
      }
    } else {
      console.error("❌ Failed to create user:", userError.message);
      process.exit(1);
    }
  }

  console.log(`✅ User ID: ${user.id}`);

  console.log(`🔗 Linking user to business as ${role}...`);
  const { data: membership, error: membershipError } = await supabase
    .from("business_users")
    .upsert({
      auth_user_id: user.id,
      business_id: business.id,
      email,
      role,
      active: true
    }, { onConflict: "auth_user_id,business_id" })
    .select()
    .single();

  if (membershipError) {
    console.error("❌ Failed to link user:", membershipError.message);
    process.exit(1);
  }

  console.log("\n✅ Done! You can now log in with:");
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${password}`);
  console.log(`   Business: ${slug}`);
  console.log(`   Role:     ${role}`);
  console.log(`   User ID:  ${user.id}`);
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err.message);
  process.exit(1);
});
