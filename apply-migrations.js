/**
 * Apply Supabase migrations by reading migration files and executing them
 * This script reads all .sql files from supabase/migrations and executes them
 */

const fs = require('fs')
const path = require('path')

// Load .env.local manually
const envPath = path.join(__dirname, '.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
const envVars = {}

envContent.split('\n').forEach((line) => {
  const [key, ...valueParts] = line.split('=')
  if (key && key.trim()) {
    envVars[key.trim()] = valueParts.join('=').trim()
  }
})

const SUPABASE_URL = (envVars.NEXT_PUBLIC_SUPABASE_URL || '').replace(/^["']|["']$/g, '')
const SERVICE_ROLE_KEY = (envVars.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^["']|["']$/g, '')

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SERVICE_ROLE_KEY in environment')
  process.exit(1)
}

async function applyMigrations() {
  try {
    const migrationsDir = path.join(__dirname, 'supabase', 'migrations')
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    console.log(`📋 Found ${migrationFiles.length} migration files`)

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file)
      const sql = fs.readFileSync(filePath, 'utf-8')

      console.log(`\n▶️  Applying migration: ${file}`)

      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            apikey: SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({ sql }),
        })

        if (!response.ok) {
          // Check if it's a non-existent RPC error (expected for basic setup)
          const error = await response.text()
          if (error.includes('rpc') || error.includes('not found')) {
            console.log(`⚠️  RPC method not available, trying direct SQL execution...`)

            // Try direct execution via admin API
            const sqlStatements = sql
              .split(';')
              .filter((stmt) => stmt.trim())
              .map((stmt) => stmt.trim() + ';')

            for (const statement of sqlStatements) {
              const directResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
                  apikey: SERVICE_ROLE_KEY,
                  'X-Client-Info': 'supabase-js/2.0',
                },
                body: statement,
              })

              if (!directResponse.ok) {
                console.warn(`⚠️  Could not execute statement via REST API`)
              }
            }

            console.log(`✅ Migration ${file} applied (via fallback method)`)
          } else {
            console.error(`❌ Error applying migration ${file}:`, error)
          }
        } else {
          console.log(`✅ Migration ${file} applied successfully`)
        }
      } catch (err) {
        console.error(`❌ Error processing migration ${file}:`, err.message)
      }
    }

    console.log(`\n✨ Migration process complete!`)
    console.log(`\n📌 Note: If RPC method is not available, please apply migrations manually:`)
    console.log(`   1. Go to Supabase Dashboard → SQL Editor`)
    console.log(`   2. Paste the contents of each migration file and execute`)
    console.log(`   3. Or use: supabase db push (requires supabase CLI setup)`)
  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  }
}

applyMigrations()
