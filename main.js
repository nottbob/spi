import { fetchBuoy } from "./buoys.js";
import { renderWeather } from "./ui.js";
import { applyOfflineData, saveData } from "./offline.js";
import { toHM } from "./util.js";

let offlineMode = false;

async function updateBoard(){
  try{
    const gulf = await fetchBuoy("BZST2");
    const bay  = await fetchBuoy("PCGT2");

    const data = { gulf, bay };

    saveData(data);
    offlineMode = false;

    renderWeather(data, new Date());
  }
  catch(e){
    offlineMode = true;
    applyOfflineData();
  }
}

updateBoard();

/* Sync refresh at :00 and :30 seconds */
function syncRefresh(){
  const s = new Date().getSeconds();
  if(s === 0 || s === 30){
    updateBoard();
  }
  setTimeout(syncRefresh, 1000);
}
syncRefresh();
