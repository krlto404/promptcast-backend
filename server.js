import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Modality } from '@google/genai';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3001;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY manquante dans .env');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Origine non autorisee'));
  }
}));

app.use(express.json({ limit: '10kb' }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requetes. Reessayez dans quelques minutes.' }
});

const episodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Limite episodes atteinte (10/heure).' }
});

app.use(globalLimiter);

app.post('/api/generate-script', episodeLimiter, async (req, res) => {
  const { prompt, language, speakers, targetMinutes } = req.body;
  if (!prompt || prompt.length < 5 || prompt.length > 1000) {
    return res.status(400).json({ error: 'Prompt invalide.' });
  }
  const speakerNames = speakers.map(s => s.name).join(', ');
  try {
    const result = await ai.models.generateContent({
      model:'gemini-2.5-flash-preview-04-17',
      contents: `Tu es un producteur de podcasts. Genere un script en 
"${language}". Duree: ${targetMinutes} minutes. Sujet: ${prompt}. 
Intervenants: ${speakerNames}. Format strict: NOM: Texte. Commence 
directement par le script.`
    });
    const script = result.text;
    if (!script) throw new Error('Script vide.');
    res.json({ script });
  } catch (err) {
    console.error('[script]', err.message);
    if (err.message?.includes('429')) {
      return res.status(429).json({ error: 'Quota Gemini atteint.' });
    }
    res.status(500).json({ error: 'Erreur generation script.' });
  }
});

app.post('/api/tts', async (req, res) => {
  const { text, voice } = req.body;
  const allowedVoices = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'];
  if (!text || text.length > 2000 || !allowedVoices.includes(voice)) {
    return res.status(400).json({ error: 'Parametres invalides.' });
  }
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
        }
      }
    });
    const audioData = result.candidates?.[0]?.content?.parts
      ?.find(p => p.inlineData)?.inlineData?.data;
    if (!audioData) throw new Error('Pas de donnees audio.');
    res.json({ audio: audioData });
  } catch (err) {
    console.error('[tts]', err.message);
    if (err.message?.includes('429')) {
      return res.status(429).json({ error: 'Quota TTS atteint.' });
    }
    res.status(500).json({ error: 'Erreur synthese vocale.' });
  }
});

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Serveur PromptCast demarre sur http://localhost:${PORT}`);
});
