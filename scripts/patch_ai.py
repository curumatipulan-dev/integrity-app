import io

s = io.open('app.js', encoding='utf-8').read()
if 'LOVABLE_AI_URL' in s:
    print('already patched')
    raise SystemExit(0)

start = s.index('const AI_APIS = [')
end = s.index('];', start) + 2

new = """// Cheia Lovable AI (se salveaza local, o singura data)
let LOVABLE_API_KEY = '';
const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

const AI_APIS = [
  { name: 'Gemini 3.6 Flash', url: LOVABLE_AI_URL, model: 'google/gemini-3.6-flash', free: true },
  { name: 'Gemini 3.1 Pro', url: LOVABLE_AI_URL, model: 'google/gemini-3.1-pro-preview', free: false },
  { name: 'GPT-5.4', url: LOVABLE_AI_URL, model: 'openai/gpt-5.4', free: false },
  { name: 'GPT-5.4 Mini', url: LOVABLE_AI_URL, model: 'openai/gpt-5.4-mini', free: false },
  { name: 'Gemini 3.5 Flash', url: LOVABLE_AI_URL, model: 'google/gemini-3.5-flash', free: true }
];

const aiHeaders = () => ({
  'Content-Type': 'application/json',
  'Lovable-API-Key': LOVABLE_API_KEY
});"""

s = s[:start] + new + s[end:]

s = s.replace("""          headers: {
            'Authorization': `Bearer ${api.key}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000""", """          headers: aiHeaders(),
          timeout: 60000""")

s = s.replace("""          headers: {
            'Authorization': `Bearer ${api.key}`,
            'Content-Type': 'application/json'
          }
        }""", """          headers: aiHeaders()
        }""")

s = s.replace("  const loadGitHubToken = async () => {", """  const loadLovableKey = async () => {
    try {
      const k = await RNFS.readFile(STORAGE_PATH + '/lovable_api_key.txt', 'utf8');
      if (k.trim()) LOVABLE_API_KEY = k.trim();
    } catch (error) {}
  };

  const loadGitHubToken = async () => {""", 1)

s = s.replace("    loadGitHubToken();", "    loadGitHubToken();\n    loadLovableKey();", 1)

io.open('app.js', 'w', encoding='utf-8').write(s)
print('patched')
