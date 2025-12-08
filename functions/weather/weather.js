// functions/weather/weather.js

export default async (event, context) => {
  try {
    const NOAA_TIDE_STATION = "8779750";
    const LAT = 26.07139, LON = -97.12872;
    const TZ = "America/Chicago";

    const toLocal = (d) =>
      new Date(d.toLocaleString("en-US", { timeZone: TZ }));

    const toHM = (d) => {
      const hh = d.getHours().toString().padStart(2, "0");
      const mm = d.getMinutes().toString().padStart(2, "0");
      return `${hh}:${mm}`;
    };

    // -------------------------------------------------------------
    // NOAA BUOY PARSER
    // -------------------------------------------------------------
    async function parseBuoy(station) {
      try {
        const url = `https://www.ndbc.noaa.gov/data/realtime2/${station}.txt`;
        const raw = await fetch(url).then(r => r.text());

        const lines = raw.trim().split("\n");
        const header = lines.find(l => l.startsWith("#"))
          .replace(/^#\s*/, "")
          .split(/\s+/);

        const getIdx = (f) => header.indexOf(f);

        const idx = {
          WDIR: getIdx("WDIR"),
          WSPD: getIdx("WSPD"),
          GST:  getIdx("GST"),
          ATMP: getIdx("ATMP"),
          WTMP: getIdx("WTMP")
        };

        const rows = lines.filter(l => !l.startsWith("#"));
        const cToF = c => (parseFloat(c) * 9/5 + 32);

        for (const row of rows) {
          const col = row.trim().split(/\s+/);

          const wdir   = col[idx.WDIR];
          const wspdMS = col[idx.WSPD];
          const gstMS  = col[idx.GST];
          const airC   = col[idx.ATMP];
          const wtrC   = col[idx.WTMP];

          return {
            airF:   airC !== "MM" ? parseFloat(cToF(airC).toFixed(1)) : null,
            waterF: wtrC !== "MM" ? parseFloat(cToF(wtrC).toFixed(1)) : null,
            windKts: wspdMS !== "MM" ? parseFloat((parseFloat(wspdMS)*1.94384).toFixed(1)) : 0,
            gustKts: gstMS  !== "MM" ? parseFloat((parseFloat(gstMS)*1.94384).toFixed(1))  : 0,
            windDirCardinal: wdir !== "MM" ? wdir : "--"
          };
        }

      } catch {
        return { airF:null, waterF:null, windKts:0, gustKts:0, windDirCardinal:"--" };
      }
    }

    const gulf = await parseBuoy("BZST2");
    const bay  = await parseBuoy("PCGT2");

    // -------------------------------------------------------------
    // NOAA TIDES
    // -------------------------------------------------------------
    let tides = { high:null, low:null };

    try {
      const tURL =
        `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=${NOAA_TIDE_STATION}&date=today&interval=hilo&units=english&time_zone=gmt&datum=MLLW&format=json`;

      const t = await fetch(tURL).then(r => r.json());

      const H = t.predictions.find(x => x.type === "H");
      const L = t.predictions.find(x => x.type === "L");

      if (H) {
        const d = toLocal(new Date(H.t));
        tides.high = { t: toHM(d), v: parseFloat(H.v).toFixed(1) };
      }
      if (L) {
        const d = toLocal(new Date(L.t));
        tides.low = { t: toHM(d), v: parseFloat(L.v).toFixed(1) };
      }
    } catch {}

    // -------------------------------------------------------------
    // SUNRISE / SUNSET
    // -------------------------------------------------------------
    let sun = { sunrise:null, sunset:null };

    try {
      const s = await fetch(
        `https://api.sunrise-sunset.org/json?lat=${LAT}&lng=${LON}&formatted=0`
      ).then(r => r.json());

      const sr = toLocal(new Date(s.results.sunrise));
      const ss = toLocal(new Date(s.results.sunset));

      sun.sunrise = toHM(sr);
      sun.sunset  = toHM(ss);
    } catch {}

    // -------------------------------------------------------------
    // WAVES FROM GITHUB (NEVER STORMGLASS)
    // -------------------------------------------------------------
    let waves = { waveFt:null };

    try {
      const sg = await fetch(
        "https://raw.githubusercontent.com/nottbob/wave-proxy/refs/heads/main/stormglass.json",
        { cache: "no-store" }
      ).then(r => r.json());

      const arr = sg.waves;
      const now = toLocal(new Date());

      let best = null;
      for (const w of arr) {
        const t = toLocal(new Date(w.time));
        if (t <= now) best = w;
        else break;
      }

      if (best) waves.waveFt = parseFloat(best.waveFt).toFixed(1);
    } catch {}

    // -------------------------------------------------------------
    // RETURN A REAL NETLIFY RESPONSE OBJECT
    // -------------------------------------------------------------
    return new Response(
      JSON.stringify({
        gulf,
        bay,
        waves,
        tides,
        sun,
        usharborsOutdated: false
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.toString() }),
      { status: 500 }
    );
  }
};
