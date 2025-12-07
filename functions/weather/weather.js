// ======================================================================
// SPI WEATHER BOARD — FINAL VERSION
// NOAA (BZST2, PCGT2) + Stormglass Waves + NOAA Tides (8779750) +
// Sunrise/Sunset from GitHub
// ======================================================================

// ----------------------------------------------------------
// ENVIRONMENT
// ----------------------------------------------------------
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_REPO    = process.env.GITHUB_REPO;      // nottbob/wave-proxy
const GITHUB_BRANCH  = process.env.GITHUB_BRANCH;    // main
const STORMGLASS_KEY = process.env.STORMGLASS_KEY;


// ======================================================================
// GITHUB LOADER — sunrise/sunset file ONLY
// ======================================================================
async function githubGet(path) {
  if (!GITHUB_TOKEN || !GITHUB_REPO || !GITHUB_BRANCH) return null;

  const url =
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "User-Agent": "spi-weather-board",
      Accept: "application/vnd.github+json"
    }
  });

  if (!res.ok) return null;

  const json = await res.json();
  const text = Buffer.from(json.content, "base64").toString("utf8");
  return { content: text };
}


// ======================================================================
// NOAA TIDE PREDICTIONS — Station 8779750 (High + Low)
// ======================================================================
async function getNoaaTides() {
  const station = "8779750";

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2,"0");
  const d = String(now.getDate()).padStart(2,"0");

  const begin = `${y}${m}${d}`;
  const end   = `${y}${m}${d}`;

  const url =
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` +
    `?product=predictions&application=SPI-Board&format=json` +
    `&station=${station}&begin_date=${begin}&end_date=${end}` +
    `&interval=hilo&datum=MLLW&time_zone=lst_ldt`;

  const res = await fetch(url);
  if (!res.ok) {
    return { high: null, low: null };
  }

  const json = await res.json();
  if (!json.predictions) return { high: null, low: null };

  let high = null;
  let low  = null;

  for (const p of json.predictions) {
    const parts = p.t.split(" ");   // ["2025-12-07","20:33"]
    const timeStr = parts[1];
    const [hh, mm] = timeStr.split(":");

    const formatted = {
      time: `${hh.padStart(2,"0")}:${mm.padStart(2,"0")}`,
      v: parseFloat(p.v)
    };

    if (p.type === "H") high = formatted;
    if (p.type === "L") low  = formatted;
  }

  return { high, low };
}


// ======================================================================
// NOAA BUOYS
// ======================================================================
function cToF(c){ return (c*9)/5 + 32; }
function mpsToKts(m){ return m * 1.94384; }
function parseNum(n){ const x = parseFloat(n); return isNaN(x) ? null : x; }

function degToCard(d) {
  if (d == null) return "--";
  const dirs = [
    "N","NNE","NE","ENE","E","ESE","SE","SSE",
    "S","SSW","SW","WSW","W","WNW","NW","NNW"
  ];
  return dirs[Math.floor((d % 360) / 22.5 + 0.5) % 16];
}

async function fetchBuoy(id) {
  const url = `https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Buoy fetch failed");

  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);

  const headerLine = lines.find(l => l.startsWith("#"));
  if (!headerLine) throw new Error("Missing header");

  const header = headerLine.replace("#","").trim().split(/\s+/);
  const getIdx = f => header.indexOf(f);

  const idx = {
    WDIR: getIdx("WDIR"),
    WSPD: getIdx("WSPD"),
    GST:  getIdx("GST"),
    ATMP: getIdx("ATMP"),
    WTMP: getIdx("WTMP")
  };

  const dataLines = lines.filter(l => !l.startsWith("#"))
    .map(l => l.trim().split(/\s+/));

  let air=null, water=null, wspd=null, gust=null, wdir=null;

  for (const r of dataLines) {
    if (air   == null && idx.ATMP !== -1) air   = parseNum(r[idx.ATMP]);
    if (water == null && idx.WTMP !== -1) water = parseNum(r[idx.WTMP]);
    if (wspd  == null && idx.WSPD !== -1) wspd  = parseNum(r[idx.WSPD]);
    if (gust  == null && idx.GST  !== -1) gust  = parseNum(r[idx.GST]);

    if (wdir == null && idx.WDIR !== -1) {
      const dd = parseNum(r[idx.WDIR]);
      if (dd != null) wdir = dd;
    }
  }

  return {
    airF:    air   != null ? Math.round(cToF(air)*10)/10 : null,
    waterF:  water != null ? Math.round(cToF(water)*10)/10 : null,
    windKts: wspd  != null ? Math.round(mpsToKts(wspd)*10)/10 : null,
    gustKts: gust  != null ? Math.round(mpsToKts(gust)*10)/10 : null,
    windDirCardinal: wdir != null ? degToCard(wdir) : "--"
  };
}

async function safeBuoy(id){
  try { return await fetchBuoy(id); }
  catch { return { airF:null, waterF:null, windKts:null, gustKts:null, windDirCardinal:"--" }; }
}


// ======================================================================
// STORMGLASS (waves from SG)
// ======================================================================
const STORMGLASS_URL =
  "https://api.stormglass.io/v2/weather/point?lat=26.071389&lng=-97.128722&params=waveHeight&source=sg";

async function fetchStormglassFresh(){
  const res = await fetch(STORMGLASS_URL, {
    headers: { Authorization: STORMGLASS_KEY }
  });
  if (!res.ok) throw new Error("StormGlass fetch failed");

  const json = await res.json();
  const waves = json.hours.map(h=>{
    const m = h.waveHeight?.sg;
    const ft = typeof m === "number" ? Math.round(m*3.28084*10)/10 : null;
    return { time:h.time, waveFt:ft };
  });

  return { timestamp: Date.now(), waves };
}

async function getStormglassForecast(){
  return await fetchStormglassFresh(); // always fresh (no writing)
}

function pickCurrentWave(f){
  if (!f || !f.waves || !f.waves.length) return { waveFt:null };
  const now = Date.now();
  let best = null;
  let diff = Infinity;

  for (const w of f.waves){
    if (w.waveFt == null) continue;
    const dt = Math.abs(new Date(w.time).getTime() - now);
    if (dt < diff){ diff = dt; best = w; }
  }

  return best ? { waveFt: best.waveFt } : { waveFt:null };
}


// ======================================================================
// SUNRISE / SUNSET (from GitHub file)
// ======================================================================
async function getSunData(){
  const file = await githubGet("sun.json");
  if (!file) return { sunrise:null, sunset:null };
  try {
    return JSON.parse(file.content);
  } catch {
    return { sunrise:null, sunset:null };
  }
}


// ======================================================================
// MAIN HANDLER
// ======================================================================
exports.handler = async () => {
  try {
    const [gulf, bay, sg, tides, sun] = await Promise.all([
      safeBuoy("BZST2"),
      safeBuoy("PCGT2"),
      getStormglassForecast(),
      getNoaaTides(),
      getSunData()
    ]);

    const wave = pickCurrentWave(sg);

    return {
      statusCode:200,
      headers:{
        "Access-Control-Allow-Origin":"*",
        "Content-Type":"application/json"
      },
      body: JSON.stringify({
        gulf,
        bay,
        waves: wave,
        tides,
        sun,
        usharborsOutdated:false
      })
    };

  } catch (err){
    return {
      statusCode:200,
      headers:{ "Access-Control-Allow-Origin":"*", "Content-Type":"application/json" },
      body: JSON.stringify({
        error:String(err),
        gulf:null, bay:null,
        waves:{ waveFt:null },
        tides:{ high:null, low:null },
        sun:{ sunrise:null, sunset:null },
        usharborsOutdated:true
      })
    };
  }
};
