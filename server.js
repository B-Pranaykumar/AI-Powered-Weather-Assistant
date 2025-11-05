import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves your index.html, css, js files

const PORT = process.env.PORT || 3000;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USE_MOCK_AI = process.env.USE_MOCK_AI === "true"; // for local fallback mode

// In-memory cache to reduce API calls
const cache = new Map();
const cacheTTLms = 5 * 60 * 1000; // 5 minutes

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > cacheTTLms) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ---------------------------------------------
// WEATHER API ROUTE
// ---------------------------------------------
app.get("/api/weather", async (req, res) => {
  try {
    const city = (req.query.city || "").trim();
    if (!city) return res.status(400).json({ error: "city is required" });

    const cacheKey = `wx:${city.toLowerCase()}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    // Step 1: Get coordinates
    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${WEATHER_API_KEY}`;
    const geoResp = await fetch(geoUrl);
    if (!geoResp.ok) throw new Error("Failed geocoding");
    const geo = await geoResp.json();
    if (!geo?.length) return res.status(404).json({ error: "City not found" });

    const { lat, lon, name, country, state } = geo[0];

    // Step 2: Current + 5-day forecast
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`;
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`;

    const [curResp, fcResp] = await Promise.all([fetch(currentUrl), fetch(forecastUrl)]);
    if (!curResp.ok || !fcResp.ok) throw new Error("Weather fetch failed");

    const current = await curResp.json();
    const forecast = await fcResp.json();

    const normalized = {
      location: { name, state: state || "", country, lat, lon },
      current: {
        description: current.weather?.[0]?.description || "",
        temp: current.main?.temp,
        feels_like: current.main?.feels_like,
        humidity: current.main?.humidity,
        wind_speed: current.wind?.speed,
        clouds: current.clouds?.all,
        dt: current.dt
      },
      forecast: forecast.list
        .reduce((days, item) => {
          const day = item.dt_txt.split(" ")[0];
          if (!days.find(d => d.day === day)) {
            days.push({
              day,
              temp: item.main?.temp,
              pop: item.pop,
              description: item.weather?.[0]?.description || ""
            });
          }
          return days;
        }, [])
        .slice(0, 5)
    };

    setCache(cacheKey, normalized);
    res.json(normalized);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching weather" });
  }
});

// ---------------------------------------------
// AI ADVICE ROUTE (with fallback mode)
// ---------------------------------------------
app.post("/api/ai-advice", async (req, res) => {
  try {
    const { location = {}, current = {}, forecast = [] } = req.body || {};

    // ---- Local Rule-Based Fallback Logic ----
    const ruleBasedAdvice = () => {
      const tips = [];
      const t = Number(current.temp);
      const feels = Number(current.feels_like);
      const hum = Number(current.humidity || 0);
      const wind = Number(current.wind_speed || 0);
      const desc = String(current.description || "").toLowerCase();
      const pop = Math.round(((forecast?.[0]?.pop) || 0) * 100);

      if (!Number.isNaN(t)) {
        if (t >= 32 || feels >= 34) tips.push("It’s hot; wear light cotton and drink plenty of water.");
        else if (t <= 15) tips.push("Cool weather; wear a light jacket or sweater.");
        else tips.push("Pleasant temperature; ideal for outdoor tasks.");
      }
      if (hum >= 70) tips.push("High humidity; choose breathable clothes and stay hydrated.");
      if (wind >= 8) tips.push("Breezy; secure loose items and avoid lightweight umbrellas.");
      if (desc.includes("rain") || pop >= 40) tips.push("Carry an umbrella; showers expected.");
      if (desc.includes("haze") || desc.includes("smoke")) tips.push("Air quality might be low; consider a mask if sensitive.");
      if (desc.includes("clear")) tips.push("Clear skies; good day for a walk or outing.");

      return (tips.length ? tips : ["Plan your day with basic precautions."])
        .slice(0, 4)
        .map(t => `- ${t}`)
        .join("\n");
    };

    // ---- If Mock AI Mode is ON ----
    if (USE_MOCK_AI) {
      console.log("⚙️  Using local rule-based AI mode");
      return res.json({ advice: ruleBasedAdvice() });
    }

    // ---- If OpenAI Key Missing ----
    if (!OPENAI_API_KEY) {
      console.warn("⚠️ OpenAI key missing. Falling back to rule-based tips.");
      return res.json({ advice: ruleBasedAdvice() });
    }

    // ---- Try OpenAI API ----
    const prompt = `
You are a concise weather coach. Based on the data below, give 3–4 short, practical tips.
Each tip under 18 words. Mix safety, clothing, commute, and health (hydration/sunscreen/etc.) if relevant.
Avoid repeating numbers shown. No apologies or disclaimers.

LOCATION: ${location?.name || "Unknown"}, ${location?.country || ""}
CURRENT: ${current.temp}°C, feels like ${current.feels_like}°C, ${current.description}, humidity ${current.humidity}%, wind ${current.wind_speed} m/s
FORECAST: ${forecast.map(f => `${f.day}: ${f.description}, ${Math.round(f.temp)}°C, POP ${Math.round((f.pop || 0) * 100)}%`).join(" | ")}
`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You write crisp, friendly weather tips." },
          { role: "user", content: prompt }
        ],
        temperature: 0.6,
        max_tokens: 150
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("OpenAI error:", text);
      return res.json({ advice: ruleBasedAdvice() }); // fallback
    }

    const data = await resp.json();
    const advice = data.choices?.[0]?.message?.content?.trim() || ruleBasedAdvice();
    res.json({ advice });

  } catch (e) {
    console.error("AI Advice route error:", e);
    res.json({ advice: "- Weather looks manageable; stay safe and carry water." });
  }
});

// ---------------------------------------------
// START SERVER
// ---------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ AI Weather Assistant running on http://localhost:${PORT}`);
});
