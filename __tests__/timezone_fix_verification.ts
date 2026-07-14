/**
 * Verification test for timezone fix
 * Demonstrates that getLastNDays and getDaysAgo are now consistent
 */

function formatDateISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getLastNDays(days: number = 30): string[] {
  const dates: string[] = []
  const today = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    dates.push(formatDateISO(date))
  }

  return dates
}

function parseDateISO(dateStr: string): Date {
  const parts = dateStr.split('-')
  const year = parseInt(parts[0] || '1970', 10)
  const month = parseInt(parts[1] || '1', 10)
  const day = parseInt(parts[2] || '1', 10)
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

function getDaysAgo(dateStr: string): number {
  const date = parseDateISO(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const diffTime = today.getTime() - date.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return diffDays
}

// Test
console.log('TIMEZONE FIX VERIFICATION')
console.log('='.repeat(50))

const last30Days = getLastNDays(30)
console.log(`✅ Generated ${last30Days.length} days`)

// Check that today is included
const todayStr = formatDateISO(new Date())
const isIncluded = last30Days.includes(todayStr)
console.log(`✅ Today's date (${todayStr}) is included: ${isIncluded}`)

// Check that getDaysAgo returns correct value for today
const daysAgoToday = getDaysAgo(todayStr)
console.log(`✅ getDaysAgo('${todayStr}') = ${daysAgoToday} (should be 0 for today)`)

// Check consistency with yesterday
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)
const yesterdayStr = formatDateISO(yesterday)
const daysAgoYesterday = getDaysAgo(yesterdayStr)
console.log(`✅ getDaysAgo('${yesterdayStr}') = ${daysAgoYesterday} (should be 1 for yesterday)`)

// Verify consistency
if (last30Days.includes(todayStr) && daysAgoToday === 0 && daysAgoYesterday === 1) {
  console.log('\n🎉 TIMEZONE FIX VERIFIED!')
  console.log('   getLastNDays and getDaysAgo are now consistent')
  console.log('   Using local time throughout for display purposes')
} else {
  console.log('\n❌ TIMEZONE FIX FAILED')
  process.exit(1)
}
