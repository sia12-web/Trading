import fs from 'fs'

const envContent = fs.readFileSync('.env.local', 'utf-8')
const envMatch = envContent.match(/OPENAI_API_KEY=(.+)/)
const apiKey = envMatch[1].trim()

async function testTTS() {
  console.log('Testing OpenAI TTS speech synthesis...')
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'alloy',
        input: 'Leo is live on your trading desk partner. Standing by for index execution.',
        response_format: 'mp3',
      }),
    })

    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      console.log(`✅ SUCCESS! Received MP3 audio buffer: ${buf.length} bytes`)
    } else {
      const err = await res.text()
      console.error('❌ TTS Error:', res.status, err)
    }
  } catch (err) {
    console.error('ERROR:', err)
  }
}

testTTS()
