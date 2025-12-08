// functions/weather/weather.js
// MUST BE CommonJS for Netlify Dev

const fs = require("fs");

// -----------------------------
// CONSTANTS
// -----------------------------
const NOAA_TIDE_STATION = "8779750";
const LAT = 26.07139, LON = -97.12872;

// Gulf = BZST2, Bay = PCGT2
const GULF = "BZST2";
const BAY  = "PCGT2";

// -----------------------------
// UTIL FUNCTIONS
// -----------------------------
const toLocal = (d) =>
  new Date(d.toLocaleString("en-US", { timeZone: "America/Chicago" }));

const toHM = (d) => {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
};

const oneDec = n => (n == null ? null : Number(n.toFixed(1)));
const CtoF = c => (c * 9) / 5 + 32;
const mpsToKts = v => v * 1.94384;

// Convert degree → cardinal
function degToCardinal(d) {
  if (d == null) return "--";
  const dirs = [
    "N","NNE","NE","ENE","E","ESE","SE","SSE",
    "S","SSW","SW","WSW","W","WNW","NW","NNW"
  ];
  return dirs[Math.floor((d % 360) / 22.5 + 0.5) % 16];
}

// -----------------------------
// YOUR BUOY PARSER (EXACT COPY)
// -----------------------------
async function fetchBuoy(id) {
  const r = await fetch(
    `https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`
  );
  const text = await r.text();

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headerLine = lines.find(l =>
    l.startsWith("#") && l.includes("WDIR")
  );

  const header = headerLine.replace("#", "").trim().split(/\s+/);
  const col = n => header.indexOf(n);
  const idx = {
    WDIR: col("WDIR"),
    WSPD: col("WSPD"),
    GST:  col("GST"),
    ATMP: col("ATMP"),
    WTMP: col("WTMP")
  };

  const rows = lines
    .filter(l => !l.startsWith("#"))
    .map(line => {
      const c = line.trim().split(/\s+/);
      const get = i => (i >= 0 && i < c.length ? parseFloat(c[i]) : null);
      return {
        WDIR: get(idx.WDIR),
        WSPD: get(idx.WSPD),
        GST:  get(idx.GST),
        ATMP: get(idx.ATMP),
        WTMP: get(idx.WTMP)
      };
    });

  const newest = fn => {
    for (const r of rows) {
      const v = fn(r);
      if (v != null && !isNaN(v)) return v;
    }
    return null;
  };

  const airC   = newest(r => r.ATMP);
  const waterC = newest(r => r.WTMP);
  const wspd   = newest(r => r.WSPD);
  const gust   = newest(r => r.GST);
  const wdir   = newest(r => r.WDIR);

  return {
    airF: airC != null ? oneDec(CtoF(airC)) : null,
    waterF: waterC != null ? oneDec(CtoF(waterC)) : null,
    windKts: wspd != null ? oneDec(mpsToKts(wspd)) : null,
    gustKts: gust != null ? oneDec(mpsToKts(gust)) : null,
    windDirCardinal: degToCardinal(wdir)
  };
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
module.exports.handler = async () => {
  try {
    // -------- BUOYS --------
    const gulfBuoy = await fetchBuoy(GULF);
    const bayBuoy  = await fetchBuoy(BAY);

    // -------- TIDES --------
    let tides = { high: null, low: null };

    try {
      const url =
        `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?` +
        `product=predictions&station=${NOAA_TIDE_STATION}` +
        `&date=today&interval=hilo&units=english&time_zone=gmt&datum=MLLW&format=json`;

      const t = await fetch(url).then(r => r.json());

      if (t.predictions) {
        const H = t.predictions.find(p => p.type === "H");
        const L = t.predictions.find(p => p.type === "L");

        if (H) {
          const d = toLocal(new Date(H.t));
          tides.high = { t: toHM(d), v: parseFloat(H.v).toFixed(1) };
        }
        if (L) {
          const d = toLocal(new Date(L.t));
          tides.low = { t: toHM(d), v: parseFloat(L.v).toFixed(1) };
        }
      }
    } catch {}

    // -------- SUN --------
    let sun = { sunrise: null, sunset: null };
    try {
      const s = await fetch(
        `https://api.sunrise-sunset.org/json?lat=${LAT}&lng=${LON}&formatted=0`
      ).then(r => r.json());

      sun.sunrise = toHM(toLocal(new Date(s.results.sunrise)));
      sun.sunset  = toHM(toLocal(new Date(s.results.sunset)));
    } catch {}

    // -------- WAVES (from GitHub JSON) --------
    let waves = { waveFt: null };

    try {
      const sg = await fetch(
        "https://raw.githubusercontent.com/nottbob/wave-proxy/refs/heads/main/stormglass.json",
        { cache: "no-store" }
      ).then(r => r.json());

      const arr = sg.waves;
      const nowLocal = toLocal(new Date());
      let best = null;

      for (const w of arr) {
        const tLocal = toLocal(new Date(w.time));
        if (tLocal <= nowLocal) best = w;
        else break;
      }

      if (best) waves.waveFt = parseFloat(best.waveFt).toFixed(1);

    } catch {}

    // -------- RETURN --------
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gulf: gulfBuoy,
        bay: bayBuoy,
        waves,
        tides,
        sun,
        usharborsOutdated: false
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.toString() })
    };
  }
};
