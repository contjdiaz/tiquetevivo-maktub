/**
 * Seed script: creates demo businesses and operator users for local testing.
 *
 * Usage:
 *   node scripts/seed-demo-data.js
 *
 * Or with custom env file:
 *   SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo-data.js
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

async function upsertBusiness({ slug, name, plan }) {
  const { data, error } = await supabase
    .from("businesses")
    .upsert({
      slug,
      name,
      phone: "+573001234567",
      address: "Calle 50 #21-15",
      city: "Medellin",
      color: "#18a058",
      plan
    }, { onConflict: "slug" })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert business ${slug}: ${error.message}`);
  console.log(`✅ Business: ${data.name} (${data.slug}) — plan: ${data.plan}`);
  return data;
}

async function upsertUser({ email, password }) {
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing?.users?.find((u) => u.email === email);

  if (found) {
    console.log(`⚠️ User already exists: ${email}`);
    return found;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error) throw new Error(`Failed to create user ${email}: ${error.message}`);
  console.log(`✅ User created: ${email}`);
  return data.user;
}

async function linkUserToBusiness({ user, business, role }) {
  const { data, error } = await supabase
    .from("business_users")
    .upsert({
      auth_user_id: user.id,
      business_id: business.id,
      email: user.email,
      role,
      active: true
    }, { onConflict: "auth_user_id,business_id" })
    .select()
    .single();

  if (error) throw new Error(`Failed to link ${user.email}: ${error.message}`);
  console.log(`✅ Linked ${user.email} to ${business.slug} as ${data.role}`);
}

async function main() {
  console.log("🌱 Seeding demo data...\n");

  // 1. Free plan business
  const majestyFree = await upsertBusiness({
    slug: "majesty",
    name: "Majesty Lavanderia",
    plan: "free"
  });

  // 2. Paid plan business
  const majestyPaid = await upsertBusiness({
    slug: "majestypremium",
    name: "Majesty Premium",
    plan: "paid"
  });

  // 3. Operator for free business
  const operatorFree = await upsertUser({
    email: "operador@majesty.com",
    password: "TiqueteVivo2026!"
  });
  await linkUserToBusiness({ user: operatorFree, business: majestyFree, role: "owner" });

  // 4. Operator for paid business
  const operatorPaid = await upsertUser({
    email: "operadorpago@majesty.com",
    password: "TiqueteVivo2026!"
  });
  await linkUserToBusiness({ user: operatorPaid, business: majestyPaid, role: "owner" });

  // 5. Superadmin
  const superadmin = await upsertUser({
    email: "admin@tiquetevivo.com",
    password: "MiClaveSegura123!"
  });
  await linkUserToBusiness({ user: superadmin, business: majestyPaid, role: "superadmin" });

  console.log("\n✅ Demo data ready!");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
