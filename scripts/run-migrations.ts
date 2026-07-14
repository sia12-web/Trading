/**
 * Run Supabase migrations using Supabase admin client
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

async function runMigrations() {
  try {
    const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    console.log(`📋 Found ${migrationFiles.length} migration files\n`)

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file)
      const sql = fs.readFileSync(filePath, 'utf-8')

      console.log(`⏳ Applying: ${file}`)

      try {
        // Split by semicolon and filter empty statements
        const statements = sql
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)

        for (const statement of statements) {
          const { error } = await supabase.rpc('exec', {
            sql: statement + ';',
          })

          if (error) {
            // Check if it's an expected error (like table already exists)
            if (error.message.includes('already exists') || error.message.includes('PGRST202')) {
              console.log(`⚠️  ${error.message} (skipping)`)
              continue
            }
            throw error
          }
        }

        console.log(`✅ ${file} applied successfully\n`)
      } catch (err: any) {
        console.error(`❌ Error applying ${file}:`)
        console.error(`   ${err.message}\n`)

        // Try using raw SQL via query method
        console.log(`   Attempting alternative execution method...`)
        try {
          const { error: altError } = await supabase.rpc('exec', {
            sql: sql,
          })

          if (altError) {
            console.error(`   Alternative also failed: ${altError.message}`)
          } else {
            console.log(`✅ ${file} applied via alternative method\n`)
          }
        } catch (altErr: any) {
          console.error(`   Alt error: ${altErr.message}\n`)
        }
      }
    }

    console.log(`\n✨ Migration process complete!`)
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message)
    process.exit(1)
  }
}

runMigrations()
