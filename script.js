const elCity = document.getElementById("city");
const elBtn  = document.getElementById("btnSearch");
const elStatus = document.getElementById("status");
const elResults = document.getElementById("results");
const elLoc = document.getElementById("loc");
const elCurrent = document.getElementById("current");
const elForecastCards = document.getElementById("forecastCards");
const elTips = document.getElementById("tips");

elBtn.addEventListener("click", run);
elCity.addEventListener("keydown", (e)=> { if (e.key === "Enter") run(); });

async function run() {
  const city = elCity.value.trim();
  if (!city) { setStatus("Please enter a city."); return; }
  setStatus("Loading…"); elResults.classList.add("hidden");

  try {
    const wxRes = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
    const wx = await wxRes.json();
    if (!wxRes.ok) throw new Error(wx.error || "Weather error");

    renderWeather(wx);
    setStatus("Generating tips…");

    const aiRes = await fetch(`/api/ai-advice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wx)
    });
    const ai = await aiRes.json();
    if (!aiRes.ok) throw new Error(ai.error || "AI error");
    renderTips(ai.advice);

    setStatus("Done.");
  } catch (e) {
    console.error(e);
    setStatus("Failed: " + e.message);
  }
}

function renderWeather(wx) {
  elResults.classList.remove("hidden");
  const locLine = [wx.location.name, wx.location.state, wx.location.country].filter(Boolean).join(", ");
  elLoc.textContent = locLine;
  const c = wx.current;
  elCurrent.textContent = `${Math.round(c.temp)}°C (feels ${Math.round(c.feels_like)}°C), ${c.description}. Humidity ${c.humidity}%, Wind ${c.wind_speed} m/s.`;

  elForecastCards.innerHTML = "";
  wx.forecast.forEach(f => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div><strong>${f.day}</strong></div>
      <div>${f.description}</div>
      <div>~ ${Math.round(f.temp)}°C</div>
      <div>Rain chance: ${Math.round((f.pop || 0) * 100)}%</div>
    `;
    elForecastCards.appendChild(div);
  });
}

function renderTips(text) {
  // Try to split into bullets if model returns lines
  const lines = text.split(/\n+/).map(s => s.replace(/^[-•\d.\s]+/, "").trim()).filter(Boolean);
  elTips.innerHTML = "";
  (lines.length ? lines : [text]).forEach(line => {
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.textContent = line;
    elTips.appendChild(tip);
  });
}

function setStatus(msg) { elStatus.textContent = msg; }
