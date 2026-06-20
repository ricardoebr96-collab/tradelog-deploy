import { useState, useEffect, useMemo, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const GOLD = "#F59E0B";
const GOLD2 = "#FCD34D";
const mono = "'DM Mono', monospace";
const sans = "'DM Sans', sans-serif";

const STRATEGIES = {
  pcs:  { id:"pcs",   label:"Put Credit Spread",  short:"PCS",  type:"credit", color:"#F59E0B" },
  bcs:  { id:"bcs",   label:"Call Debit Spread",  short:"BCS",  type:"debit",  color:"#38BDF8" },
  ccs:  { id:"ccs",   label:"Call Credit Spread", short:"CCS",  type:"credit", color:"#F87171" },
  pds:  { id:"pds",   label:"Put Debit Spread",   short:"PDS",  type:"debit",  color:"#FB923C" },
  ic:   { id:"ic",    label:"Iron Condor",         short:"IC",   type:"credit", color:"#A78BFA" },
  ib:   { id:"ib",    label:"Iron Butterfly",      short:"IB",   type:"credit", color:"#34D399" },
  swing:{ id:"swing", label:"Swing Trade",         short:"SW",   type:"equity", color:"#C084FC" },
  otras:{ id:"otras", label:"Otras",               short:"OTR",  type:"other",  color:"#64748B" },
  pat:  { id:"pat",   label:"Patrimonio",           short:"PAT",  type:"equity", color:"#38BDF8" },
};

const BIAS_MAP = {
  bull:    { id:"bull",    label:"Bullish",  icon:"↑", color:"#4ADE80", ids:["pcs","bcs","swing"] },
  bear:    { id:"bear",    label:"Bearish",  icon:"↓", color:"#F87171", ids:["ccs","pds"] },
  neutral: { id:"neutral", label:"Neutral",  icon:"→", color:"#A78BFA", ids:["ic","ib","otras"] },
};

// ── Riesgo de estructura: beta y sector por ticker (editables) ──
const BETA_TABLE = {
  HOOD:2.5, PLTR:2.5, TSLA:2.0, NVDA:1.7, META:1.3, AMZN:1.3, AMD:1.8,
  MSFT:1.0, AAPL:1.2, NOW:1.3, IREN:3.0, NVTS:2.5, SPCX:2.0, SPY:1.0, QQQ:1.1, GOOGL:1.1, NFLX:1.3,
};
const SECTOR_TABLE = {
  HOOD:"Fintech", PLTR:"Tech/IA", NVDA:"Semis", AMD:"Semis", META:"Tech/IA",
  MSFT:"Tech/IA", AAPL:"Tech", AMZN:"Consumo/Tech", TSLA:"Auto/Tech", NOW:"Software",
  IREN:"Cripto/IA", NVTS:"Semis", SPCX:"Espacio", SPY:"Índice", QQQ:"Índice", GOOGL:"Tech/IA", NFLX:"Consumo",
};
const DEFAULT_BETA = 1.2;
const DEFAULT_SECTOR = "Otro";
// Signo direccional de delta por estrategia (+ alcista / − bajista / 0 neutral)
const DELTA_SIGN = { pcs:1, bcs:1, ccs:-1, pds:-1, swing:1, pat:1, ic:0, ib:0, otras:0 };
// Estima el delta neto por acción de un spread según su moneyness
function estPerShareDelta(strikesStr, spot){
  const parts = String(strikesStr||"").split("/").map(x=>parseFloat(x)).filter(x=>!isNaN(x));
  if(!parts.length || !spot) return 0.10;
  const near = parts.reduce((a,b)=>Math.abs(b-spot)<Math.abs(a-spot)?b:a);
  const m = Math.abs(near-spot)/spot;
  if(m<0.02) return 0.20;
  if(m<0.04) return 0.13;
  if(m<0.07) return 0.08;
  return 0.05;
}

const SCORECARD = {
  // ── PCS: Put Credit Spread (Alcista/Neutral) ─────────────────────────────
  // Vendemos put OTM — queremos precio ARRIBA o quieto. Strike LEJOS = más seguro.
  pcs:[
    {id:"ivr", label:"IVR — Vendemos volatilidad",
      opts:[{l:"IVR > 50% — volatilidad cara, ideal vender",s:3},{l:"IVR 35–50% — aceptable",s:2},{l:"IVR < 35% — prima muy barata",s:1}], w:3},
    {id:"ivhv",label:"IV vs HV — calidad del edge",
      opts:[{l:"IV >> HV — overpayment claro, edge gordo",s:3},{l:"IV > HV — edge moderado",s:2},{l:"IV ≈ HV — vol justa, sin edge real",s:1},{l:"IV < HV — no vender prima",s:0}], w:3},
    {id:"rr",  label:"R/R — Profit/Loss ratio",
      opts:[{l:"≥ 0.5 — excelente para crédito",s:3},{l:"0.33–0.5 — aceptable",s:2},{l:"0.20–0.33 — pobre",s:1},{l:"< 0.20 — rechazar",s:0}], w:3},
    {id:"prem",label:"Calidad de la prima (% del width)",
      opts:[{l:"≥ 33% — prima excelente",s:3},{l:"25–33% — aceptable",s:2},{l:"15–25% — magra",s:1},{l:"< 15% — no vale el riesgo",s:0}], w:2},
    {id:"dist",label:"Distancia Strike Corto vs Precio",
      opts:[{l:"> 3% por debajo del precio — foso amplio",s:3},{l:"2–3% por debajo — moderado",s:2},{l:"< 2% — muy cerca, riesgo alto",s:0}], w:3},
    {id:"dte", label:"DTE — Tiempo a expiración",
      opts:[{l:"7–21 días — decaimiento theta óptimo",s:3},{l:"21–45 días — aceptable",s:2},{l:"< 7 días — gamma riesgo alto",s:0}], w:2},
    {id:"trend",label:"Tendencia del precio",
      opts:[{l:"Alcista — por encima de MA50 y MA200",s:3},{l:"Lateral con soporte",s:2},{l:"Bajista confirmado",s:0}], w:2},
    {id:"entry",label:"Contexto de entrada",
      opts:[{l:"Retroceso 2–4% en tendencia alcista (dip en soporte)",s:3},{l:"Lateral consolidando en soporte",s:2},{l:"Tras subida fuerte — extensión, evitar",s:0}], w:3},
    {id:"supp",label:"Soporte / air pocket bajo el strike",
      opts:[{l:"Soporte confirmado con piso estructural debajo",s:3},{l:"Soporte histórico relevante",s:2},{l:"Sin soporte / air pocket bajo el strike",s:0}], w:3},
    {id:"risk",label:"Eventos en el DTE",
      opts:[{l:"Sin earnings ni macro relevante",s:3},{l:"Dato menor (no mover precio)",s:1},{l:"Earnings dentro del DTE",s:0}], w:3},
  ],
  // ── BCS: Bull Call Spread (Alcista Direccional) ───────────────────────────
  // Compramos call — queremos precio SUBIR hasta el strike largo. Strike CERCA = más probable ganar.
  bcs:[
    {id:"ivhv",label:"IV vs HV — el edge del débito",
      opts:[{l:"IV << HV — opciones baratas vs movimiento real, edge gordo",s:3},{l:"IV < HV — favorable comprar prima",s:2},{l:"IV ≈ HV — vol justa, sin edge",s:1},{l:"IV > HV — sobrepagas, no comprar débito",s:0}], w:3},
    {id:"ivr", label:"IVR — Nivel de volatilidad (secundario)",
      opts:[{l:"IVR < 25% — prima barata en absoluto",s:3},{l:"IVR 25–50% — aceptable (validar con IV vs HV)",s:2},{l:"IVR > 50% — IV alta; válido solo si IV<HV + catalizador",s:1}], w:2},
    {id:"rr",  label:"R/R — Profit/Loss ratio",
      opts:[{l:"≥ 2.0 — excelente para débito",s:3},{l:"1.0–2.0 — aceptable",s:2},{l:"0.5–1.0 — pobre",s:1},{l:"< 0.5 — rechazar",s:0}], w:3},
    {id:"prem",label:"Costo del débito (% del width)",
      opts:[{l:"< 33% — costo bajo, buen ratio",s:3},{l:"33–50% — moderado",s:2},{l:"50–67% — caro",s:1},{l:"> 67% — muy caro",s:0}], w:2},
    {id:"dist",label:"Distancia Strike Comprado vs Precio",
      opts:[{l:"< 1% del precio — casi ATM, alta prob.",s:3},{l:"1–2.5% OTM — balance costo/prob.",s:2},{l:"> 2.5% OTM — necesita gran movimiento",s:0}], w:3},
    {id:"dte", label:"DTE — Necesita tiempo para moverse",
      opts:[{l:"21–45 días — suficiente tiempo al movimiento",s:3},{l:"14–21 días — ajustado",s:2},{l:"< 14 días — tiempo insuficiente",s:0}], w:2},
    {id:"trend",label:"Tendencia confirmada alcista",
      opts:[{l:"Por encima MA50 y MA200 con momentum",s:3},{l:"Por encima MA50 solamente",s:2},{l:"Por debajo de MAs — en contra",s:0}], w:2},
    {id:"cat",  label:"Catalizador direccional (esencial en débito)",
      opts:[{l:"Earnings, macro o evento concreto con fecha",s:3},{l:"Breakout técnico confirmado",s:2},{l:"Solo momentum — sin catalizador",s:0}], w:3},
    {id:"risk",label:"Timing del catalizador vs expiración",
      opts:[{l:"Catalizador dentro del DTE con margen para reaccionar",s:3},{l:"Catalizador justo en/cerca de la expiración (gamma + binario)",s:1},{l:"Sin catalizador en la ventana del trade",s:0}], w:2},
  ],
  // ── CCS: Call Credit Spread (Bajista/Neutral) ─────────────────────────────
  // Vendemos call OTM — queremos precio ABAJO o quieto. Strike LEJOS por arriba = más seguro.
  ccs:[
    {id:"ivr", label:"IVR — Vendemos volatilidad",
      opts:[{l:"IVR > 50% — volatilidad cara, ideal vender",s:3},{l:"IVR 35–50% — aceptable",s:2},{l:"IVR < 35% — prima muy barata",s:1}], w:3},
    {id:"ivhv",label:"IV vs HV — calidad del edge",
      opts:[{l:"IV >> HV — overpayment claro, edge gordo",s:3},{l:"IV > HV — edge moderado",s:2},{l:"IV ≈ HV — vol justa, sin edge real",s:1},{l:"IV < HV — no vender prima",s:0}], w:3},
    {id:"rr",  label:"R/R — Profit/Loss ratio",
      opts:[{l:"≥ 0.5 — excelente para crédito",s:3},{l:"0.33–0.5 — aceptable",s:2},{l:"0.20–0.33 — pobre",s:1},{l:"< 0.20 — rechazar",s:0}], w:3},
    {id:"prem",label:"Calidad de la prima (% del width)",
      opts:[{l:"≥ 33% — prima excelente",s:3},{l:"25–33% — aceptable",s:2},{l:"15–25% — magra",s:1},{l:"< 15% — no vale el riesgo",s:0}], w:2},
    {id:"dist",label:"Distancia Strike Corto vs Precio",
      opts:[{l:"> 3% por encima del precio — foso amplio",s:3},{l:"2–3% por encima — moderado",s:2},{l:"< 2% — muy cerca, riesgo alto",s:0}], w:3},
    {id:"dte", label:"DTE — Tiempo a expiración",
      opts:[{l:"7–21 días — decaimiento theta óptimo",s:3},{l:"21–45 días — aceptable",s:2},{l:"< 7 días — gamma riesgo alto",s:0}], w:2},
    {id:"trend",label:"Tendencia del precio",
      opts:[{l:"Bajista — por debajo de MA50 y MA200",s:3},{l:"Lateral con resistencia",s:2},{l:"Alcista confirmado — en contra",s:0}], w:2},
    {id:"entry",label:"Contexto de entrada",
      opts:[{l:"Rebote 2–4% en tendencia bajista (a resistencia)",s:3},{l:"Lateral consolidando en resistencia",s:2},{l:"Tras caída fuerte — extensión, evitar",s:0}], w:3},
    {id:"res",  label:"Resistencia / air pocket sobre el strike",
      opts:[{l:"Resistencia confirmada con techo estructural arriba",s:3},{l:"Resistencia histórica relevante",s:2},{l:"Sin resistencia / air pocket sobre el strike",s:0}], w:3},
    {id:"risk",label:"Eventos en el DTE",
      opts:[{l:"Sin earnings ni macro relevante",s:3},{l:"Dato menor (no mover precio)",s:1},{l:"Earnings dentro del DTE",s:0}], w:3},
  ],
  // ── PDS: Put Debit Spread (Bajista Direccional) ───────────────────────────
  // Compramos put — queremos precio BAJAR hasta el strike largo. Strike CERCA = más probable ganar.
  pds:[
    {id:"ivhv",label:"IV vs HV — el edge del débito",
      opts:[{l:"IV << HV — opciones baratas vs movimiento real, edge gordo",s:3},{l:"IV < HV — favorable comprar prima",s:2},{l:"IV ≈ HV — vol justa, sin edge",s:1},{l:"IV > HV — sobrepagas, no comprar débito",s:0}], w:3},
    {id:"ivr", label:"IVR — Nivel de volatilidad (secundario)",
      opts:[{l:"IVR < 25% — prima barata en absoluto",s:3},{l:"IVR 25–50% — aceptable (validar con IV vs HV)",s:2},{l:"IVR > 50% — IV alta; válido solo si IV<HV + catalizador",s:1}], w:2},
    {id:"rr",  label:"R/R — Profit/Loss ratio",
      opts:[{l:"≥ 2.0 — excelente para débito",s:3},{l:"1.0–2.0 — aceptable",s:2},{l:"0.5–1.0 — pobre",s:1},{l:"< 0.5 — rechazar",s:0}], w:3},
    {id:"prem",label:"Costo del débito (% del width)",
      opts:[{l:"< 33% — costo bajo, buen ratio",s:3},{l:"33–50% — moderado",s:2},{l:"50–67% — caro",s:1},{l:"> 67% — muy caro",s:0}], w:2},
    {id:"dist",label:"Distancia Strike Comprado vs Precio",
      opts:[{l:"< 1% del precio — casi ATM, alta prob.",s:3},{l:"1–2.5% OTM — balance costo/prob.",s:2},{l:"> 2.5% OTM — necesita gran caída",s:0}], w:3},
    {id:"dte", label:"DTE — Necesita tiempo para moverse",
      opts:[{l:"21–45 días — suficiente tiempo al movimiento",s:3},{l:"14–21 días — ajustado",s:2},{l:"< 14 días — tiempo insuficiente",s:0}], w:2},
    {id:"trend",label:"Tendencia confirmada bajista",
      opts:[{l:"Por debajo MA50 y MA200 con momentum",s:3},{l:"Por debajo MA50 solamente",s:2},{l:"Por encima de MAs — en contra",s:0}], w:2},
    {id:"cat",  label:"Catalizador bajista (esencial en débito)",
      opts:[{l:"Earnings negativo, macro o evento concreto con fecha",s:3},{l:"Breakdown técnico confirmado",s:2},{l:"Solo momentum bajista — sin catalizador",s:0}], w:3},
    {id:"risk",label:"Timing del catalizador vs expiración",
      opts:[{l:"Catalizador dentro del DTE con margen para reaccionar",s:3},{l:"Catalizador justo en/cerca de la expiración (gamma + binario)",s:1},{l:"Sin catalizador en la ventana del trade",s:0}], w:2},
  ],
  // ── IC: Iron Condor (Neutral) ─────────────────────────────────────────────
  // Vendemos rango — queremos precio QUIETO entre ambos strikes. Mayor distancia a ambos lados = más seguro.
  ic:[
    {id:"ivr",  label:"IVR — Alta volatilidad implícita",
      opts:[{l:"IVR > 60% — rango esperado amplio, prima generosa",s:3},{l:"IVR 40–60% — aceptable",s:2},{l:"IVR < 40% — prima insuficiente",s:0}], w:3},
    {id:"rr",   label:"R/R — Profit/Loss ratio",
      opts:[{l:"≥ 0.5 — excelente",s:3},{l:"0.33–0.5 — aceptable",s:2},{l:"0.20–0.33 — pobre",s:1},{l:"< 0.20 — rechazar",s:0}], w:3},
    {id:"prem", label:"Calidad de la prima (% del width)",
      opts:[{l:"≥ 33% — prima excelente",s:3},{l:"25–33% — aceptable",s:2},{l:"15–25% — magra",s:1},{l:"< 15% — no vale el riesgo",s:0}], w:2},
    {id:"range",label:"Comportamiento del precio",
      opts:[{l:"Lateral consolidado con múltiples toques",s:3},{l:"Formando rango, todavía no consolidado",s:2},{l:"Tendencia activa — riesgo de ruptura",s:0}], w:3},
    {id:"dist", label:"Distancia de ambos strikes al precio",
      opts:[{l:"Ambos strikes > 3% del precio — foso amplio",s:3},{l:"Ambos > 1.5% — moderado",s:2},{l:"Alguno < 1.5% — riesgo de toque",s:0}], w:3},
    {id:"dte",  label:"DTE — Theta decay óptimo",
      opts:[{l:"30–45 días — zona ideal theta/gamma",s:3},{l:"15–30 días — aceptable",s:2},{l:"< 15 días — gamma riesgo elevado",s:1}], w:2},
    {id:"risk", label:"Eventos en el DTE",
      opts:[{l:"Sin earnings ni macro relevante",s:3},{l:"Dato menor controlado",s:1},{l:"Earnings dentro del DTE",s:0}], w:3},
  ],
  // ── IB: Iron Butterfly (Neutral Agresivo) ────────────────────────────────
  // Vendemos ATM — máximo beneficio si precio termina exactamente en el strike central.
  ib:[
    {id:"ivr",  label:"IVR — Necesita volatilidad muy alta",
      opts:[{l:"IVR > 70% — crush de volatilidad potente",s:3},{l:"IVR 50–70% — aceptable",s:2},{l:"IVR < 50% — crush insuficiente",s:0}], w:3},
    {id:"rr",   label:"R/R — Profit/Loss ratio",
      opts:[{l:"≥ 0.5 — excelente",s:3},{l:"0.33–0.5 — aceptable",s:2},{l:"0.20–0.33 — pobre",s:1},{l:"< 0.20 — rechazar",s:0}], w:3},
    {id:"prem", label:"Calidad de la prima (% del width)",
      opts:[{l:"≥ 33% — prima excelente",s:3},{l:"25–33% — aceptable",s:2},{l:"15–25% — magra",s:1},{l:"< 15% — no vale el riesgo",s:0}], w:2},
    {id:"dist", label:"Strike central vs Precio actual",
      opts:[{l:"Strike ATM — precio exactamente en el centro",s:3},{l:"Hasta 0.5% de diferencia",s:2},{l:"> 0.5% — descentrado, reduce ganancia máx",s:0}], w:3},
    {id:"pin",  label:"Probabilidad de pin al strike",
      opts:[{l:"Precio pinning al nivel + soporte/resistencia",s:3},{l:"Consolidación muy estrecha cerca del strike",s:2},{l:"Precio con movimiento activo",s:0}], w:3},
    {id:"dte",  label:"DTE — Ventana de expiración",
      opts:[{l:"7–14 días — expiración inminente, theta máximo",s:3},{l:"14–21 días — aceptable",s:2},{l:"< 7 días — gamma extremo",s:0}], w:2},
    {id:"risk", label:"Eventos en el DTE",
      opts:[{l:"Sin earnings ni macro — precio quieto",s:3},{l:"Dato menor controlado",s:1},{l:"Earnings dentro del DTE",s:0}], w:3},
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const todayStr = () => new Date().toISOString().slice(0,10);
const fmtDate = d => {
  if (!d) return "";
  const p = d.split("-");
  const mo = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return mo[parseInt(p[1])] + " " + parseInt(p[2]);
};
const dteDays = (a,b) => {
  if (!a||!b) return null;
  return Math.round((new Date(b)-new Date(a))/86400000);
};

// ── localStorage ─────────────────────────────────────────────────────────────
function loadData() {
  try { const r = localStorage.getItem("tl_v1"); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveData(d) {
  try { localStorage.setItem("tl_v1", JSON.stringify(d)); } catch {}
  try { localStorage.setItem("tl_v1_ts", new Date().toISOString()); } catch {}
  if (cloudOn()) {
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => cloudPush(d), 800); // debounce: empuja 800ms tras el último cambio
  }
}

// ── Supabase Cloud Sync ───────────────────────────────────────────────────────
// CONFIG · Completa estos 3 valores con tu proyecto Supabase.
// Mientras estén vacíos, la app funciona LOCAL igual que siempre (cero nube, cero riesgo).
const SUPABASE_URL      = "";          // ej: https://abcdxyz.supabase.co
const SUPABASE_ANON_KEY = "";          // la key "anon public" (segura en cliente, protegida por RLS)
const SYNC_USER_KEY     = "ricardo";   // MISMO identificador en móvil y PC (usa algo difícil de adivinar)

const cloudOn = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
let _pushTimer = null;
function emitCloud(s){ try{ window.dispatchEvent(new CustomEvent("tl-cloud",{detail:s})); }catch{} }

async function cloudPull(){
  if(!cloudOn()) return null;
  try{
    const url = SUPABASE_URL+"/rest/v1/tradelab_sync?id=eq."+encodeURIComponent(SYNC_USER_KEY)+"&select=data,updated_at";
    const r = await fetch(url,{ headers:{ apikey:SUPABASE_ANON_KEY, Authorization:"Bearer "+SUPABASE_ANON_KEY } });
    if(!r.ok) return null;
    const rows = await r.json();
    return (rows && rows[0]) ? rows[0] : null;   // { data, updated_at }
  }catch{ return null; }
}

async function cloudPush(data){
  if(!cloudOn()) return false;
  emitCloud("syncing");
  try{
    const r = await fetch(SUPABASE_URL+"/rest/v1/tradelab_sync",{
      method:"POST",
      headers:{ apikey:SUPABASE_ANON_KEY, Authorization:"Bearer "+SUPABASE_ANON_KEY, "Content-Type":"application/json", Prefer:"resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id:SYNC_USER_KEY, data, updated_at:new Date().toISOString() })
    });
    emitCloud(r.ok ? "synced" : "error");
    return r.ok;
  }catch{ emitCloud("offline"); return false; }
}

// ── Metrics ───────────────────────────────────────────────────────────────────
function calcMetrics(list) {
  if (!list.length) return { n:0, wins:0, losses:0, pnl:0, wr:0, avgWin:0, avgLoss:0, pf:0, maxDD:0, nHedges:0, hedgePnl:0, edgeN:0 };
  // ── Separar coberturas de operaciones direccionales (edge trades) ──────────
  // Coberturas: cuentan en P&L total, DD y curva de equity (capital real).
  // No cuentan en métricas de edge: win rate, profit factor, avg win/loss.
  const edgeList = list.filter(t => !t.isHedge && !t.isPatrimony);
  const hedgeList = list.filter(t => t.isHedge);
  const wins = edgeList.filter(t => t.pnl > 0);
  const losses = edgeList.filter(t => t.pnl < 0);
  const pnl = list.reduce((a,t) => a+t.pnl, 0); // P&L total incluye coberturas
  const hedgePnl = hedgeList.reduce((a,t) => a+t.pnl, 0);
  const avgWin = wins.length ? wins.reduce((a,t) => a+t.pnl,0)/wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a,t) => a+Math.abs(t.pnl),0)/losses.length : 0;
  const pf = avgLoss>0 ? avgWin/avgLoss : (avgWin>0 ? Infinity : 0);
  // Drawdown sobre TODO el flujo de capital (coberturas incluidas)
  let peak=0,eq=0,maxDD=0;
  [...list].sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>{
    eq+=t.pnl; if(eq>peak) peak=eq; const dd=peak-eq; if(dd>maxDD) maxDD=dd;
  });
  return {
    n:list.length,
    edgeN:edgeList.length,
    nHedges:hedgeList.length,
    wins:wins.length,
    losses:losses.length,
    pnl,
    hedgePnl,
    wr:edgeList.length?wins.length/edgeList.length:0,
    avgWin,
    avgLoss,
    pf,
    maxDD
  };
}

function buildInsights(trades) {
  if (!trades.length) return [];
  const ins = [];
  // Insights de edge: solo operaciones direccionales, sin coberturas
  const edgeTrades = trades.filter(t=>!t.isHedge);
  const hedgeTrades = trades.filter(t=>t.isHedge);
  if (edgeTrades.length){
    const wr = edgeTrades.filter(t=>t.pnl>0).length/edgeTrades.length;
    if (wr>=0.7) ins.push({tone:"pos",title:"Win rate on target",body:`${(wr*100).toFixed(1)}% supera el benchmark de 70%.`});
    else if (wr>=0.55) ins.push({tone:"neu",title:"Win rate sólido",body:`${(wr*100).toFixed(1)}% — hay margen para afilar entradas.`});
    else if (edgeTrades.length>=5) ins.push({tone:"neg",title:"Win rate bajo",body:`${(wr*100).toFixed(1)}% está por debajo del 55% mínimo.`});
  }
  let bb=null,bp=-Infinity;
  Object.values(BIAS_MAP).forEach(b=>{
    const bt=edgeTrades.filter(t=>b.ids.includes(t.strat));
    if(bt.length>=3){const p=bt.reduce((a,t)=>a+t.pnl,0);if(p>bp){bp=p;bb=b;}}
  });
  if(bb) ins.push({tone:"pos",title:"Mejor bias: "+bb.label,body:"$"+bp.toFixed(2)+" generado con setups "+bb.label.toLowerCase()+"."});
  const lA=edgeTrades.filter(t=>t.pnl<0),wA=edgeTrades.filter(t=>t.pnl>0);
  if(lA.length>=3&&wA.length>=3){
    const r=Math.abs((wA.reduce((a,t)=>a+t.pnl,0)/wA.length)/(lA.reduce((a,t)=>a+t.pnl,0)/lA.length));
    if(r>=2) ins.push({tone:"pos",title:"Excelente R/R",body:"La ganancia promedio es "+r.toFixed(1)+"x la pérdida promedio."});
    else if(r<1) ins.push({tone:"neg",title:"R/R necesita atención",body:"La pérdida promedio supera la ganancia promedio."});
  }
  // Insight de costo de coberturas
  if(hedgeTrades.length>=2){
    const hp=hedgeTrades.reduce((a,t)=>a+t.pnl,0);
    const edgePnl=edgeTrades.reduce((a,t)=>a+t.pnl,0);
    if(hp<0&&edgePnl>0){
      const pct=Math.abs(hp)/edgePnl*100;
      if(pct<15) ins.push({tone:"pos",title:"Coberturas eficientes",body:"Costo de coberturas ($"+Math.abs(hp).toFixed(0)+") representa solo "+pct.toFixed(0)+"% del edge generado."});
      else if(pct>40) ins.push({tone:"neg",title:"Coberturas costosas",body:"Las coberturas consumen "+pct.toFixed(0)+"% del edge — revisa thesis defensivo."});
    }
    if(hp>0) ins.push({tone:"pos",title:"Coberturas rentables",body:"Las coberturas generaron $"+hp.toFixed(0)+" adicionales — defensa convertida en ataque."});
  }
  return ins;
}

// ── Análisis de Despliegues Activos ────────────────────────────────────────
// Devuelve un objeto con métricas calculadas, señales acumuladas y veredicto
function analyzeDeployment(dep){
  const isCredit = STRATEGIES[dep.strat]?.type === "credit" || dep.strat==="ic" || dep.strat==="ib";
  const isDebit = STRATEGIES[dep.strat]?.type === "debit";
  const contracts = parseInt(dep.contracts) || 1;
  const credit = parseFloat(dep.initialCredit) || 0;
  const current = dep.currentPrice===""?null:parseFloat(dep.currentPrice);

  // P&L y profit %
  let profitPct=null, unrealizedPnl=null;
  if(current!==null){
    if(isCredit){
      // Vendiste a `credit`. Si ahora vale `current`, capturaste credit-current
      profitPct = credit>0 ? ((credit-current)/credit)*100 : 0;
      unrealizedPnl = (credit-current)*100*contracts;
    } else {
      // Débito: pagaste credit. Si ahora vale `current`, ganaste current-credit
      profitPct = credit>0 ? ((current-credit)/credit)*100 : 0;
      unrealizedPnl = (current-credit)*100*contracts;
    }
  }

  // DTE y tiempo
  const today = todayStr();
  const totalDays = dep.entryDate && dep.expiry ? dteDays(dep.entryDate, dep.expiry) : null;
  const dteRemaining = dep.expiry ? dteDays(today, dep.expiry) : null;
  const daysElapsed = totalDays!==null && dteRemaining!==null ? totalDays - dteRemaining : null;
  const timePct = (totalDays && totalDays>0 && daysElapsed!==null) ? Math.max(0,Math.min(100,(daysElapsed/totalDays)*100)) : null;

  // TP dinámico según DTE restante (regla velocidad del dinero)
  const tpTarget = dteRemaining!==null ? (dteRemaining<5?30:dteRemaining<15?40:50) : 50;

  // Theta proyectada vs realizada
  let thetaRatio=null, expectedTheta=null, realizedTheta=null;
  if(daysElapsed && daysElapsed>0 && totalDays>0 && current!==null && isCredit){
    expectedTheta = (credit / totalDays); // decay lineal teórico
    realizedTheta = (credit - current) / daysElapsed;
    thetaRatio = expectedTheta>0 ? (realizedTheta/expectedTheta)*100 : null;
  }

  // Velocidad de ganancia (% por día)
  const profitVelocity = (daysElapsed && daysElapsed>0 && profitPct!==null) ? profitPct/daysElapsed : null;

  // Greeks: delta y IV
  const entryDelta = dep.entryDelta!==""&&dep.entryDelta!==undefined?parseFloat(dep.entryDelta):null;
  const currentDelta = dep.currentDelta!==""&&dep.currentDelta!==undefined?parseFloat(dep.currentDelta):null;
  const entryIv = dep.entryIv!==""&&dep.entryIv!==undefined?parseFloat(dep.entryIv):null;
  const currentIv = dep.currentIv!==""&&dep.currentIv!==undefined?parseFloat(dep.currentIv):null;
  const deltaChange = (entryDelta!==null && currentDelta!==null && entryDelta!==0) ? ((currentDelta-entryDelta)/Math.abs(entryDelta))*100 : null;
  const ivChange = (entryIv!==null && currentIv!==null && entryIv!==0) ? ((currentIv-entryIv)/entryIv)*100 : null;

  // Spot tracking
  const entrySpot = dep.entrySpot!==""&&dep.entrySpot!==undefined?parseFloat(dep.entrySpot):null;
  const currentSpot = dep.currentSpot!==""&&dep.currentSpot!==undefined?parseFloat(dep.currentSpot):null;
  const spotChange = (entrySpot && currentSpot) ? ((currentSpot-entrySpot)/entrySpot)*100 : null;

  // Distancia al short strike y breakeven
  let distToShort=null, breakeven=null, distToBE=null;
  if(currentSpot && dep.strikes){
    const parts = dep.strikes.split("/").map(s=>parseFloat(s));
    if(parts.length>=1 && !isNaN(parts[0])){
      const shortStrike = parts[0];
      distToShort = ((shortStrike-currentSpot)/currentSpot)*100;
      if(isCredit){
        breakeven = dep.strat==="pcs"||dep.strat==="pds" ? shortStrike-credit : shortStrike+credit;
        distToBE = ((breakeven-currentSpot)/currentSpot)*100;
      }
    }
  }

  // Capital en riesgo (max loss para credit spreads)
  let capitalAtRisk=null;
  if(dep.strikes){
    const parts = dep.strikes.split("/").map(s=>parseFloat(s));
    if(parts.length>=2 && !isNaN(parts[0]) && !isNaN(parts[1])){
      const width = Math.abs(parts[0]-parts[1]);
      capitalAtRisk = isCredit ? (width-credit)*100*contracts : credit*100*contracts;
    }
  }

  // ── Sistema de Señales Acumuladas ─────────────────────────────────────────
  const signals = [];

  if(profitPct!==null){
    if(profitPct >= tpTarget){
      signals.push({type:"pos",icon:"🟢",text:"Profit "+profitPct.toFixed(0)+"% supera TP de "+tpTarget+"%"});
    } else if(profitPct >= tpTarget*0.7 && profitPct < tpTarget){
      signals.push({type:"neu",icon:"🟡",text:"Profit "+profitPct.toFixed(0)+"% acercándose al TP de "+tpTarget+"%"});
    } else if(profitPct < 0){
      signals.push({type:"neg",icon:"🔴",text:"En pérdida de "+profitPct.toFixed(0)+"%"});
    }
  }

  if(timePct!==null && profitPct!==null){
    if(timePct > 60 && profitPct < 25 && profitPct > 0){
      signals.push({type:"neg",icon:"🟠",text:"Tiempo al "+timePct.toFixed(0)+"% sin progreso significativo"});
    } else if(timePct < 30 && profitPct > tpTarget*0.7){
      signals.push({type:"pos",icon:"🟢",text:"Ganancia rápida con solo "+timePct.toFixed(0)+"% del tiempo consumido"});
    }
  }

  if(deltaChange!==null){
    if(Math.abs(deltaChange) >= 50 && isCredit){
      signals.push({type:"neg",icon:"🟠",text:"Delta del short subió "+deltaChange.toFixed(0)+"% — gamma riesgo creciente"});
    } else if(currentDelta!==null && Math.abs(currentDelta) <= 0.10 && isCredit){
      signals.push({type:"pos",icon:"🟢",text:"Delta del short en "+currentDelta.toFixed(2)+" — zona segura"});
    }
  }

  if(ivChange!==null){
    if(ivChange <= -30 && isCredit){
      signals.push({type:"pos",icon:"🟢",text:"IV crush capturado: "+ivChange.toFixed(0)+"% desde entrada"});
    } else if(ivChange >= 30 && isCredit){
      signals.push({type:"neg",icon:"🟠",text:"IV expandió "+ivChange.toFixed(0)+"% — prima se infló"});
    }
  }

  if(thetaRatio!==null && daysElapsed>=2){
    if(thetaRatio < 60){
      signals.push({type:"neg",icon:"🟡",text:"Theta realizada al "+thetaRatio.toFixed(0)+"% de la proyectada"});
    } else if(thetaRatio > 130){
      signals.push({type:"pos",icon:"🟢",text:"Theta realizada al "+thetaRatio.toFixed(0)+"% — decay acelerado"});
    }
  }

  if(distToShort!==null && isCredit){
    const isPutSide = dep.strat==="pcs"||dep.strat==="ic"||dep.strat==="ib";
    const compromised = isPutSide ? distToShort > -1.5 : distToShort < 1.5;
    if(compromised && Math.abs(distToShort) < 1.5){
      signals.push({type:"neg",icon:"🔴",text:"Spot a "+Math.abs(distToShort).toFixed(1)+"% del short strike — foso comprometido"});
    }
  }

  if(dteRemaining!==null && dteRemaining<=3 && profitPct!==null && profitPct < tpTarget){
    signals.push({type:"neg",icon:"🟠",text:"DTE crítico ("+dteRemaining+"d) con profit parcial — gamma riesgo"});
  }

  // ── Veredicto razonado ───────────────────────────────────────────────────
  let directive = null;
  if(profitPct === null){
    directive = {key:"unknown",color:"#94A3B8",bg:"rgba(148,163,184,0.08)",border:"rgba(148,163,184,0.3)",title:"Sin datos",sub:"Actualiza el precio del contrato para evaluar"};
  } else {
    const negCount = signals.filter(s=>s.type==="neg").length;
    const posCount = signals.filter(s=>s.type==="pos").length;
    const hasRedFlag = signals.some(s=>s.icon==="🔴");

    if(hasRedFlag){
      directive = {key:"alert",color:"#F87171",bg:"rgba(248,113,113,0.08)",border:"rgba(248,113,113,0.35)",title:"ALERTA: Evaluar Estructura",sub:"Bandera roja activa — revisa tu thesis y considera cerrar"};
    } else if(profitPct >= tpTarget){
      directive = {key:"extract",color:"#4ADE80",bg:"rgba(74,222,128,0.08)",border:"rgba(74,222,128,0.35)",title:"DIRECTIVA A: Extraer Capital",sub:"Cumple TP del "+tpTarget+"% — libera capital y busca el próximo despliegue"};
    } else if(profitPct < 0){
      directive = {key:"evaluate",color:"#F87171",bg:"rgba(248,113,113,0.08)",border:"rgba(248,113,113,0.35)",title:"ALERTA: Evaluar Estructura",sub:"Pérdida activa — revisa thesis y considera defensa o cierre"};
    } else if(timePct!==null && timePct > 50){
      directive = {key:"accelerate",color:"#FB923C",bg:"rgba(251,146,60,0.08)",border:"rgba(251,146,60,0.35)",title:"DIRECTIVA C: Acelerar Extracción",sub:"Tiempo consumido > 50% con profit parcial — evalúa salir con lo que hay"};
    } else {
      directive = {key:"hold",color:GOLD,bg:"rgba(245,158,11,0.06)",border:"rgba(245,158,11,0.3)",title:"DIRECTIVA B: Mantener",sub:"Theta trabaja a tu favor — mantén la posición"};
    }
  }

  return {
    isCredit, isDebit,
    profitPct, unrealizedPnl,
    dteRemaining, totalDays, daysElapsed, timePct,
    tpTarget, tpAmount: profitPct!==null ? (credit*100*contracts)*(tpTarget/100) : null,
    thetaRatio, expectedTheta, realizedTheta,
    profitVelocity,
    deltaChange, ivChange, spotChange,
    distToShort, breakeven, distToBE,
    capitalAtRisk,
    signals, directive,
    isStale: dep.lastUpdate ? ((Date.now() - new Date(dep.lastUpdate).getTime()) / 3600000) > 24 : false
  };
}

function exportCSV(trades) {
  const h = ["Date","Expiry","Ticker","Strategy","Strikes","Premium","Contracts","IVR","Score","P&L","Return%","Hedge","Notes"];
  const rows = trades.map(t=>[t.date,t.expiry||"",t.ticker,STRATEGIES[t.strat]?.label||t.strat,t.strikes||"",t.premium||"",t.contracts||"",t.ivr||"",t.score||"",t.pnl.toFixed(2),(t.pct||0).toFixed(2),t.isHedge?"YES":"",(t.notes||"").replace(/"/g,'""')]);
  const csv=[h,...rows].map(r=>r.map(c=>'"'+c+'"').join(",")).join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download="tradelog-"+todayStr()+".csv";
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}

// ── Shared UI Components ──────────────────────────────────────────────────────
function Pill({label,color,small}){
  return <span style={{background:color+"1a",color,border:"1px solid "+color+"30",borderRadius:20,padding:small?"2px 8px":"3px 10px",fontSize:small?9:10,fontFamily:mono,fontWeight:700,letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{label}</span>;
}

function ScoreBar({score}){
  if(!score) return <span style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.2)"}}>—</span>;
  const c=score>=85?"#4ADE80":score>=65?GOLD:"#F87171";
  return(
    <div style={{display:"flex",alignItems:"center",gap:5}}>
      <div style={{width:28,height:3,background:"rgba(255,255,255,0.07)",borderRadius:2,overflow:"hidden"}}>
        <div style={{width:score+"%",height:"100%",background:c,borderRadius:2}}/>
      </div>
      <span style={{fontFamily:mono,fontSize:10,color:c}}>{score}</span>
    </div>
  );
}

function FInput({label,value,onChange,type,placeholder,suffix,error}){
  const [foc,setFoc]=useState(false);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      <label style={{fontSize:9,color:error?"#F87171":"rgba(255,255,255,0.25)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase"}}>
        {label}{error?" — "+error:""}
      </label>
      <div style={{position:"relative"}}>
        <input type={type||"text"} value={value} placeholder={placeholder}
          onChange={e=>onChange(e.target.value)}
          onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
          style={{background:"rgba(255,255,255,0.06)",border:"1px solid "+(foc?GOLD+"80":error?"rgba(248,113,113,0.4)":"rgba(255,255,255,0.1)"),borderRadius:12,padding:"13px "+(suffix?"36px":"14px")+" 13px 14px",color:"#fff",fontSize:14,fontFamily:mono,width:"100%",outline:"none",boxSizing:"border-box",transition:"border-color 0.15s",WebkitAppearance:"none"}}
        />
        {suffix&&<span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:mono}}>{suffix}</span>}
      </div>
    </div>
  );
}

function StratPicker({value,onChange}){
  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {Object.values(BIAS_MAP).map(bias=>(
        <div key={bias.id}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>{bias.label}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {bias.ids.map(sid=>{
              const s=STRATEGIES[sid];const sel=value===sid;
              return(
                <button key={sid} onClick={()=>onChange(sid)} style={{flex:"1 1 80px",background:sel?s.color+"15":"rgba(255,255,255,0.03)",border:"1px solid "+(sel?s.color+"60":"rgba(255,255,255,0.08)"),borderRadius:10,padding:"11px 8px",color:sel?s.color:"rgba(255,255,255,0.3)",fontFamily:mono,fontSize:11,fontWeight:700,transition:"all 0.15s",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                  <span>{s.short}</span>
                  <span style={{fontSize:9,opacity:0.6}}>{s.type}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mini gráfico de líneas (reutilizable) ──────────────────────────────────────
function MiniChart({series,height=72,showZero=false}){
  const all=series.flatMap(s=>s.values).filter(v=>typeof v==="number"&&!isNaN(v));
  if(all.length<2)return <div style={{height,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:10,color:"rgba(255,255,255,0.3)"}}>Se construye cada vez que abres esta pantalla…</div>;
  const W=600,H=height,PL=4,PR=4,PT=8,PB=8;
  let minV=Math.min(...all),maxV=Math.max(...all);
  if(showZero){minV=Math.min(minV,0);maxV=Math.max(maxV,0);}
  const range=(maxV-minV)||1;
  const n=Math.max(...series.map(s=>s.values.length));
  const toX=i=>PL+(i/((n-1)||1))*(W-PL-PR);
  const toY=v=>PT+(1-(v-minV)/range)*(H-PT-PB);
  const zY=toY(0);
  return(
    <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",display:"block"}}>
      {showZero&&minV<0&&maxV>0&&<line x1={PL} y1={zY} x2={W-PR} y2={zY} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="4,4"/>}
      {series.map((s,si)=>{
        const d=s.values.map((v,i)=>(i===0?"M":"L")+toX(i).toFixed(1)+","+toY(v).toFixed(1)).join(" ");
        return <path key={si} d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>;
      })}
    </svg>
  );
}

// ── Equity Curve ──────────────────────────────────────────────────────────────
function HeroEquity({trades,onHover}){
  const [hIdx,setHIdx]=useState(null);
  const sorted=useMemo(()=>[...trades].sort((a,b)=>a.date.localeCompare(b.date)),[trades]);
  const pts=useMemo(()=>{
    let c=0;const p=[{date:"",v:0}];
    sorted.forEach(t=>{c+=t.pnl;p.push({date:t.date,v:parseFloat(c.toFixed(2))});});
    return p;
  },[sorted]);
  const W=600,H=180,PL=8,PR=8,PT=16,PB=28;
  const vals=pts.map(p=>p.v);
  const minV=Math.min(...vals),maxV=Math.max(...vals),range=maxV-minV||1;
  const toX=i=>PL+(i/(pts.length-1||1))*(W-PL-PR);
  const toY=v=>PT+(1-(v-minV)/range)*(H-PT-PB);
  const pathD=pts.map((p,i)=>(i===0?"M":"L")+toX(i).toFixed(1)+","+toY(p.v).toFixed(1)).join(" ");
  const fillD=pathD+" L"+toX(pts.length-1).toFixed(1)+","+(H-PB)+" L"+toX(0).toFixed(1)+","+(H-PB)+" Z";
  const last=pts[pts.length-1]?.v||0;
  const lc=last>=0?GOLD:"#F87171";
  const zY=toY(0);
  const hov=hIdx!==null?pts[hIdx]:null;
  return(
    <div style={{position:"relative",width:"100%"}}>
      <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",display:"block",touchAction:"none"}}
        onMouseLeave={()=>{setHIdx(null);onHover&&onHover(null);}}
        onTouchEnd={()=>{setHIdx(null);onHover&&onHover(null);}}>
        <defs>
          <linearGradient id="eqgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lc} stopOpacity="0.3"/>
            <stop offset="75%" stopColor={lc} stopOpacity="0.04"/>
            <stop offset="100%" stopColor={lc} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {minV<0&&maxV>0&&<line x1={PL} y1={zY} x2={W-PR} y2={zY} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4,4"/>}
        <path d={fillD} fill="url(#eqgrad)"/>
        <path d={pathD} fill="none" stroke={lc} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
        {pts.map((_,i)=>(
          <rect key={i} x={toX(i)-10} y={0} width={20} height={H} fill="transparent"
            onMouseEnter={()=>{setHIdx(i);onHover&&onHover(pts[i]);}}
            onTouchStart={()=>{setHIdx(i);onHover&&onHover(pts[i]);}}/>
        ))}
        {hov&&hIdx!==null&&(
          <g>
            <line x1={toX(hIdx)} y1={PT} x2={toX(hIdx)} y2={H-PB} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3,3"/>
            <circle cx={toX(hIdx)} cy={toY(hov.v)} r="5" fill={lc} stroke="rgba(0,0,0,0.5)" strokeWidth="1.5"/>
            <circle cx={toX(hIdx)} cy={toY(hov.v)} r="10" fill={lc} opacity="0.15"/>
          </g>
        )}
        {hIdx===null&&(
          <g>
            <circle cx={toX(pts.length-1)} cy={toY(last)} r="4" fill={lc}/>
            <circle cx={toX(pts.length-1)} cy={toY(last)} r="9" fill={lc} opacity="0.15"/>
          </g>
        )}
        {[0,Math.floor((pts.length-1)/2),pts.length-1].map(i=>{
          const p=pts[i];if(!p||!p.date)return null;
          return <text key={i} x={toX(i)} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily={mono}>{fmtDate(p.date)}</text>;
        })}
      </svg>
    </div>
  );
}

// ── Animated Counter ──────────────────────────────────────────────────────────
function Counter({value,color}){
  const [disp,setDisp]=useState(0);
  const rafRef=useRef(null);
  useEffect(()=>{
    let start=null;const dur=800;
    const step=ts=>{
      if(!start)start=ts;
      const p=Math.min((ts-start)/dur,1);
      const ease=1-Math.pow(1-p,3);
      setDisp(value*ease);
      if(p<1){rafRef.current=requestAnimationFrame(step);}
    };
    rafRef.current=requestAnimationFrame(step);
    return()=>cancelAnimationFrame(rafRef.current);
  },[value]);
  const sign=value>=0?"+":"-";
  return <span style={{color}}>{sign}${Math.abs(disp).toFixed(0)}</span>;
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function CalendarView({trades,onSelectDay}){
  const now=new Date();
  const [curY,setCurY]=useState(now.getFullYear());
  const [curM,setCurM]=useState(now.getMonth());
  const byDay=useMemo(()=>{
    const m={};trades.forEach(t=>{if(!m[t.date])m[t.date]=[];m[t.date].push(t);});return m;
  },[trades]);
  const first=new Date(curY,curM,1).getDay();
  const days=new Date(curY,curM+1,0).getDate();
  const mPnl=Object.entries(byDay).filter(([k])=>{
    const prefix=curY+'-'+String(curM+1).padStart(2,'0');
    return k.startsWith(prefix);
  }).reduce((a,[,ts])=>a+ts.reduce((b,t)=>b+t.pnl,0),0);
  const DAYS=["D","L","M","M","J","V","S"];
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <button style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:10,padding:"8px 16px",color:"rgba(255,255,255,0.7)",fontSize:20,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}
          onClick={()=>{if(curM===0){setCurY(y=>y-1);setCurM(11);}else setCurM(m=>m-1);}}>‹</button>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:sans,fontSize:15,fontWeight:700,color:"#fff"}}>{new Date(curY,curM).toLocaleDateString("es-MX",{month:"long",year:"numeric"})}</div>
          <div style={{fontFamily:mono,fontSize:13,color:mPnl>=0?"#4ADE80":"#F87171",marginTop:2}}>{mPnl>=0?"+":""}${mPnl.toFixed(2)}</div>
        </div>
        <button style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:10,padding:"8px 16px",color:"rgba(255,255,255,0.7)",fontSize:20,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}
          onClick={()=>{if(curM===11){setCurY(y=>y+1);setCurM(0);}else setCurM(m=>m+1);}}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
        {DAYS.map((d,i)=><div key={i} style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.2)",textAlign:"center",padding:"4px 0",textTransform:"uppercase",letterSpacing:"0.04em"}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
        {Array.from({length:first}).map((_,i)=><div key={"e"+i}/>)}
        {Array.from({length:days}).map((_,i)=>{
          const n=i+1;
          const iso=curY+"-"+String(curM+1).padStart(2,"0")+"-"+String(n).padStart(2,"0");
          const dt=byDay[iso]||[];
          const dp=dt.reduce((a,t)=>a+t.pnl,0);
          const ht=dt.length>0;
          const isT=curY===now.getFullYear()&&curM===now.getMonth()&&n===now.getDate();
          // Detectar si TODAS las operaciones del día son coberturas
          const allHedge=ht&&dt.every(t=>t.isHedge);
          const anyHedge=ht&&dt.some(t=>t.isHedge);
          // Colores: si todo el día es cobertura, usar gris neutro independiente del P&L
          const bg=ht
            ?(allHedge?"rgba(148,163,184,0.08)":(dp>0?"rgba(74,222,128,0.1)":dp<0?"rgba(248,113,113,0.1)":"rgba(245,158,11,0.08)"))
            :"rgba(255,255,255,0.02)";
          const borderColor=isT?"rgba(255,255,255,0.35)":(ht?(allHedge?"rgba(148,163,184,0.3)":(dp>0?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)")):"rgba(255,255,255,0.04)");
          const dotColor=allHedge?"#94A3B8":(dp>0?"#4ADE80":"#F87171");
          const valueColor=allHedge?"#94A3B8":(dp>0?"#4ADE80":dp<0?"#F87171":GOLD);
          return(
            <div key={n} onClick={()=>ht&&onSelectDay(iso,dt)}
              style={{background:bg,border:"1px solid "+borderColor,borderRadius:10,padding:"6px 4px",minHeight:52,cursor:ht?"pointer":"default",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"space-between",position:"relative",WebkitTapHighlightColor:"transparent"}}>
              {ht&&<div style={{position:"absolute",top:3,right:3,width:5,height:5,borderRadius:"50%",background:dotColor}}/>}
              {/* Indicador shield si hay al menos una cobertura en el día */}
              {anyHedge&&!allHedge&&<div style={{position:"absolute",top:3,left:3,fontSize:8,opacity:0.7}}>🛡️</div>}
              <span style={{fontFamily:sans,fontSize:12,color:isT?"#fff":ht?(allHedge?"#CBD5E1":"rgba(255,255,255,0.85)"):"rgba(255,255,255,0.2)",fontWeight:isT?700:400}}>{n}</span>
              {ht&&<div style={{textAlign:"center"}}><div style={{fontFamily:mono,fontSize:10,fontWeight:700,color:valueColor}}>{dp>0?"+":""}${Math.abs(dp).toFixed(0)}</div></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Import Modal ──────────────────────────────────────────────────────────────
// ── Modal: Actualizar Despliegue ─────────────────────────────────────────────
function UpdateDeploymentModal({dep,onClose,onSave}){
  const [currentPrice,setCurrentPrice]=useState(dep.currentPrice||"");
  const [currentSpot,setCurrentSpot]=useState(dep.currentSpot||"");
  const [currentDelta,setCurrentDelta]=useState(dep.currentDelta||"");
  const [currentIv,setCurrentIv]=useState(dep.currentIv||"");
  const [notes,setNotes]=useState(dep.notes||"");
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60,padding:0}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <p style={{fontSize:18,fontWeight:800,color:"#fff",fontFamily:sans,marginBottom:3}}>Actualizar {dep.ticker}</p>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:mono}}>{STRATEGIES[dep.strat]?.label} · strikes {dep.strikes||"—"}</p>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>

        <div style={{padding:"10px 14px",background:"rgba(56,189,248,0.06)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:10,marginBottom:16}}>
          <div style={{fontFamily:mono,fontSize:11,color:"rgba(56,189,248,0.8)"}}>
            Crédito inicial: ${parseFloat(dep.initialCredit).toFixed(2)} · {dep.contracts} contratos
          </div>
        </div>

        <FInput label="Precio actual del contrato $" value={currentPrice} onChange={setCurrentPrice} type="number" placeholder="0.32"/>

        <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,marginTop:16}}>Griegas y subyacente (opcional)</div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <FInput label="Spot actual" value={currentSpot} onChange={setCurrentSpot} type="number" placeholder="612"/>
          <FInput label="Δ Delta short" value={currentDelta} onChange={setCurrentDelta} type="number" placeholder="0.12"/>
        </div>

        <FInput label="IV actual %" value={currentIv} onChange={setCurrentIv} type="number" placeholder="28" suffix="%"/>

        <div style={{marginTop:14,marginBottom:18}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Notas</div>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observaciones, niveles clave..."
            style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 14px",color:"#fff",fontSize:14,fontFamily:mono,width:"100%",outline:"none",resize:"vertical",minHeight:52,boxSizing:"border-box"}}/>
        </div>

        <button onClick={()=>onSave({currentPrice,currentSpot,currentDelta,currentIv,notes})} disabled={!currentPrice}
          style={{width:"100%",background:currentPrice?"linear-gradient(135deg,"+GOLD+","+GOLD2+")":"rgba(255,255,255,0.06)",border:"none",borderRadius:14,padding:"15px",color:currentPrice?"#000":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:14,fontWeight:800,cursor:currentPrice?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
          Guardar Actualización
        </button>
      </div>
    </div>
  );
}

// ── Modal: Cerrar Despliegue ─────────────────────────────────────────────────
function CloseDeploymentModal({dep,onClose,onConfirm}){
  const analysis=useMemo(()=>analyzeDeployment(dep),[dep]);
  const [finalPnl,setFinalPnl]=useState(analysis.unrealizedPnl!==null?analysis.unrealizedPnl.toFixed(2):"");
  const [closeDate,setCloseDate]=useState(todayStr());
  const [notes,setNotes]=useState(dep.notes||"");
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60,padding:0}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(245,158,11,0.3)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <p style={{fontSize:18,fontWeight:800,color:"#fff",fontFamily:sans,marginBottom:3}}>Cerrar {dep.ticker}</p>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:mono}}>Se moverá al Journal como trade cerrado</p>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>

        {analysis.profitPct!==null&&(
          <div style={{padding:"14px 16px",background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:12,marginBottom:16}}>
            <div style={{fontSize:11,fontFamily:sans,color:"rgba(255,255,255,0.5)",marginBottom:5}}>Última actualización</div>
            <div style={{display:"flex",gap:14,alignItems:"baseline"}}>
              <span style={{fontFamily:mono,fontSize:22,fontWeight:700,color:analysis.unrealizedPnl>=0?"#4ADE80":"#F87171"}}>{analysis.unrealizedPnl>=0?"+":""}${analysis.unrealizedPnl.toFixed(2)}</span>
              <span style={{fontFamily:mono,fontSize:13,color:analysis.profitPct>=0?GOLD:"#F87171"}}>{analysis.profitPct>=0?"+":""}{analysis.profitPct.toFixed(0)}%</span>
            </div>
          </div>
        )}

        <FInput label="P&L final realizado $" value={finalPnl} onChange={setFinalPnl} type="number" placeholder="104"/>
        <div style={{marginTop:10}}>
          <FInput label="Fecha de cierre" value={closeDate} onChange={setCloseDate} type="date"/>
        </div>

        <div style={{marginTop:14,marginBottom:18}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Notas finales</div>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Razón de cierre, lecciones, contexto..."
            style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 14px",color:"#fff",fontSize:14,fontFamily:mono,width:"100%",outline:"none",resize:"vertical",minHeight:64,boxSizing:"border-box"}}/>
        </div>

        <button onClick={()=>onConfirm(finalPnl,closeDate,notes)} disabled={finalPnl===""}
          style={{width:"100%",background:finalPnl!==""?"linear-gradient(135deg,"+GOLD+","+GOLD2+")":"rgba(255,255,255,0.06)",border:"none",borderRadius:14,padding:"15px",color:finalPnl!==""?"#000":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:14,fontWeight:800,cursor:finalPnl?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
          Cerrar y Registrar en Journal
        </button>
      </div>
    </div>
  );
}

function ImportModal({onClose,onImport}){
  const [step,setStep]=useState("upload");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [preview,setPreview]=useState([]);
  const [dragging,setDragging]=useState(false);

  const parseLine=line=>{
    const r=[];let cur="",inQ=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'&&line[i+1]==='"'){cur+='"';i++;}
      else if(c==='"'){inQ=!inQ;}
      else if(c===','&&!inQ){r.push(cur);cur="";}
      else{cur+=c;}
    }
    r.push(cur);return r.map(s=>s.trim());
  };
  const normDate=s=>{
    if(!s)return todayStr();
    const c=s.replace(/['"]/g,"").trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(c))return c;
    const us=c.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(us)return us[3]+"-"+us[1].padStart(2,"0")+"-"+us[2].padStart(2,"0");
    try{const d=new Date(c);if(!isNaN(d))return d.toISOString().split("T")[0];}catch{}
    return todayStr();
  };
  const inferS=desc=>{
    if(!desc)return "pcs";const d=desc.toLowerCase();
    if(d.includes("iron condor")||d==="ic")return "ic";
    if(d.includes("iron butterfly")||d==="ib")return "ib";
    if(d.includes("put credit")||d==="pcs")return "pcs";
    if(d.includes("call debit")||d==="bcs")return "bcs";
    if(d.includes("call credit")||d==="ccs")return "ccs";
    if(d.includes("put debit")||d==="pds")return "pds";
    if(d.includes("swing"))return "swing";
    return "pcs";
  };
  const parseCSV=text=>{
    const lines=text.split(/\r?\n/).filter(l=>l.trim().length>0);
    if(lines.length<2)throw new Error("CSV vacío");
    const headers=parseLine(lines[0]).map(h=>h.toLowerCase().replace(/[^a-z0-9]/g,""));
    const rows=lines.slice(1).map(parseLine);
    const fc=(...names)=>{for(const n of names){const idx=headers.findIndex(h=>h===n||h.includes(n));if(idx>=0)return idx;}return -1;};
    const cDate=fc("date","entrydate"),cTicker=fc("ticker","symbol"),cPnl=fc("pnl","pl","profit");
    if(cDate<0||cTicker<0||cPnl<0)throw new Error("CSV necesita columnas: date, ticker, pnl");
    const cStrat=fc("strat","strategy","type"),cPct=fc("pct","return","percent");
    const cStrikes=fc("strikes","strike"),cPrem=fc("premium","credit","debit","price");
    const cContr=fc("contracts","qty"),cIvr=fc("ivr","iv"),cNotes=fc("notes","note"),cExp=fc("expiry","expiration","exp");
    const cHedge=fc("hedge","ishedge","cobertura");
    const parsed=rows.map(r=>({
      id:uid(),date:normDate(cDate>=0?r[cDate]:""),expiry:cExp>=0?normDate(r[cExp]):"",
      ticker:((cTicker>=0?r[cTicker]:"")||"").toUpperCase().replace(/[^A-Z0-9]/g,""),
      strat:inferS(cStrat>=0?r[cStrat]:""),
      pnl:parseFloat((cPnl>=0?r[cPnl]:"0").replace(/[$,"]/g,""))||0,
      pct:parseFloat(String(cPct>=0?r[cPct]:"").replace(/[%"]/g,""))||0,
      strikes:cStrikes>=0?r[cStrikes]:"",premium:cPrem>=0?String(r[cPrem]).replace(/[$,"]/g,""):"",
      contracts:cContr>=0?r[cContr]:"",
      ivr:cIvr>=0&&r[cIvr]!==""?parseFloat(String(r[cIvr]).replace(/[%"]/g,""))||"":"",
      notes:cNotes>=0?r[cNotes]:"",score:null,
      isHedge:cHedge>=0?/^(yes|true|1|y|si|sí)$/i.test(String(r[cHedge]).trim()):false,
    })).filter(t=>t.ticker&&t.pnl!==undefined);
    if(!parsed.length)throw new Error("No se encontraron trades válidos");
    return parsed;
  };
  const processFile=async file=>{
    if(!file)return;setError("");
    if(!file.name.endsWith(".csv")){setError("Por favor sube un archivo .csv");return;}
    setLoading(true);
    try{const text=await file.text();setPreview(parseCSV(text));setStep("preview");}
    catch(e){setError(e.message||"No se pudo parsear el CSV.");}
    setLoading(false);
  };

  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60,padding:0}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"24px 20px 40px"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"0 auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <p style={{fontFamily:sans,fontSize:18,fontWeight:700,color:"#fff",marginBottom:3}}>Importar Trades</p>
            <p style={{fontFamily:sans,fontSize:12,color:"rgba(255,255,255,0.3)"}}>ThinkOrSwim · Tastytrade · IBKR · Webull</p>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>

        {step==="upload"&&(
          <div>
            <label onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
              onDrop={e=>{e.preventDefault();setDragging(false);processFile(e.dataTransfer.files?.[0]);}}
              style={{display:"block",cursor:"pointer",marginBottom:16}}>
              <input type="file" accept=".csv" onChange={e=>processFile(e.target.files?.[0])} style={{display:"none"}}/>
              <div style={{background:dragging?"rgba(245,158,11,0.08)":"rgba(255,255,255,0.02)",border:"1px dashed "+(dragging?GOLD:"rgba(255,255,255,0.12)"),borderRadius:14,padding:"40px 20px",textAlign:"center",transition:"all 0.15s"}}>
                <div style={{fontSize:40,marginBottom:12}}>{dragging?"⬇️":"📄"}</div>
                <div style={{fontFamily:sans,fontSize:15,fontWeight:600,color:"#fff",marginBottom:6}}>{dragging?"Suelta aquí":"Toca o arrastra un CSV"}</div>
                <div style={{fontFamily:sans,fontSize:12,color:"rgba(255,255,255,0.25)"}}>Columnas necesarias: date, ticker, pnl</div>
              </div>
            </label>
            {loading&&<div style={{fontFamily:sans,fontSize:13,color:"rgba(255,255,255,0.4)",textAlign:"center",padding:10}}>Procesando...</div>}
            {error&&<div style={{fontFamily:sans,fontSize:13,color:"#F87171",padding:"12px 16px",background:"rgba(248,113,113,0.08)",borderRadius:10,border:"1px solid rgba(248,113,113,0.2)",marginTop:8}}>{error}</div>}
          </div>
        )}

        {step==="preview"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <span style={{fontFamily:sans,fontSize:14,fontWeight:600,color:"#fff"}}>{preview.filter(t=>!t._skip).length} trades listos</span>
              <button onClick={()=>setStep("upload")} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",fontSize:13,fontFamily:sans,cursor:"pointer"}}>← Volver</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:20,maxHeight:280,overflowY:"auto"}}>
              {preview.map(t=>{
                const s=STRATEGIES[t.strat]||STRATEGIES.otras;
                return(
                  <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:t._skip?"rgba(255,255,255,0.02)":"rgba(255,255,255,0.04)",borderRadius:10,opacity:t._skip?0.4:1,border:"1px solid rgba(255,255,255,0.07)"}}>
                    <input type="checkbox" checked={!t._skip} onChange={()=>setPreview(p=>p.map(x=>x.id===t.id?{...x,_skip:!x._skip}:x))} style={{accentColor:GOLD,flexShrink:0,width:18,height:18}}/>
                    <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:"#fff",minWidth:50}}>{t.ticker}</span>
                    <select value={t.strat} onChange={e=>setPreview(p=>p.map(x=>x.id===t.id?{...x,strat:e.target.value}:x))}
                      style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,color:s.color,fontSize:10,fontFamily:mono,padding:"4px 8px",outline:"none"}}>
                      {Object.values(STRATEGIES).map(st=><option key={st.id} value={st.id}>{st.short}</option>)}
                    </select>
                    <span style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.3)",flex:1}}>{t.date}</span>
                    <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:t.pnl>=0?"#4ADE80":"#F87171"}}>{t.pnl>=0?"+":""}${t.pnl.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{onImport(preview.filter(t=>!t._skip).map(({_skip,...t})=>t));setStep("done");}}
                style={{flex:1,background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",border:"none",borderRadius:12,padding:"14px",color:"#000",fontFamily:sans,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                Importar {preview.filter(t=>!t._skip).length} trades
              </button>
              <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"14px 20px",color:"rgba(255,255,255,0.4)",fontFamily:sans,fontSize:14,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        )}

        {step==="done"&&(
          <div style={{textAlign:"center",padding:"40px 0"}}>
            <div style={{fontSize:52,marginBottom:16}}>✓</div>
            <p style={{fontFamily:sans,fontSize:18,fontWeight:700,color:"#4ADE80",marginBottom:20}}>Importación completa</p>
            <button onClick={onClose} style={{background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",border:"none",borderRadius:12,padding:"13px 44px",color:"#000",fontFamily:sans,fontSize:14,fontWeight:700,cursor:"pointer"}}>Listo</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Side Drawer Menu ──────────────────────────────────────────────────────────
function SideDrawer({open,onClose,onExport,onImport,trades,darkMode,toggleDark,onNavigateInsights,onQuickCalc,onCapital,onConstitution,onBackup,onRestore}){
  const m=useMemo(()=>calcMetrics(trades),[trades]);
  return(
    <>
      {open&&<div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:80,backdropFilter:"blur(4px)"}}/>}
      <div style={{position:"fixed",top:0,left:0,bottom:0,width:280,background:"#0A0F1C",borderRight:"1px solid rgba(255,255,255,0.08)",zIndex:90,transform:open?"translateX(0)":"translateX(-100%)",transition:"transform 0.3s cubic-bezier(0.32,0.72,0,1)",display:"flex",flexDirection:"column",overflowY:"auto"}}>
        <div style={{padding:"56px 20px 24px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
            <div style={{width:44,height:44,borderRadius:13,background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 20px "+GOLD+"50"}}>
              <span style={{fontSize:22}}>📈</span>
            </div>
            <div>
              <div style={{fontFamily:sans,fontSize:18,fontWeight:800,color:"#fff",letterSpacing:"-0.02em"}}>TradeLog</div>
              <div style={{fontFamily:mono,fontSize:10,color:"rgba(255,255,255,0.3)",letterSpacing:"0.1em",textTransform:"uppercase"}}>Terminal</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"10px 12px",border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>P&L</div>
              <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:m.pnl>=0?GOLD:"#F87171"}}>{m.pnl>=0?"+":""}${m.pnl.toFixed(0)}</div>
            </div>
            <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"10px 12px",border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Win Rate</div>
              <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:m.wr>=0.6?"#4ADE80":m.wr>=0.5?GOLD:"#F87171"}}>{m.n?(m.wr*100).toFixed(0):"—"}%</div>
            </div>
          </div>
        </div>

        <div style={{padding:"16px 12px",flex:1}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",padding:"0 8px",marginBottom:8}}>Navegación</div>

          <button onClick={()=>{onNavigateInsights&&onNavigateInsights();onClose();}} style={{display:"flex",alignItems:"center",gap:14,width:"100%",padding:"13px 12px",background:"transparent",border:"none",borderRadius:12,color:"rgba(255,255,255,0.75)",fontFamily:sans,fontSize:14,cursor:"pointer",marginBottom:2,transition:"background 0.15s",WebkitTapHighlightColor:"transparent"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{fontSize:18,width:24,textAlign:"center"}}>◆</span>
            <span>Insights</span>
          </button>

          <button onClick={()=>{onQuickCalc&&onQuickCalc();onClose();}} style={{display:"flex",alignItems:"center",gap:14,width:"100%",padding:"13px 12px",background:"transparent",border:"none",borderRadius:12,color:"rgba(255,255,255,0.75)",fontFamily:sans,fontSize:14,cursor:"pointer",marginBottom:2,transition:"background 0.15s",WebkitTapHighlightColor:"transparent"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{fontSize:18,width:24,textAlign:"center"}}>◈</span>
            <span>Calculadora Rápida</span>
          </button>

          <button onClick={()=>{onCapital&&onCapital();onClose();}} style={{display:"flex",alignItems:"center",gap:14,width:"100%",padding:"13px 12px",background:"transparent",border:"none",borderRadius:12,color:"rgba(255,255,255,0.75)",fontFamily:sans,fontSize:14,cursor:"pointer",marginBottom:2,transition:"background 0.15s",WebkitTapHighlightColor:"transparent"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{fontSize:18,width:24,textAlign:"center"}}>🏛️</span>
            <span>Gestión de Capital</span>
          </button>

          <button onClick={()=>{onConstitution&&onConstitution();onClose();}} style={{display:"flex",alignItems:"center",gap:14,width:"100%",padding:"13px 12px",background:"transparent",border:"none",borderRadius:12,color:"rgba(255,255,255,0.75)",fontFamily:sans,fontSize:14,cursor:"pointer",marginBottom:2,transition:"background 0.15s",WebkitTapHighlightColor:"transparent"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{fontSize:18,width:24,textAlign:"center"}}>📜</span>
            <span>Constitución</span>
          </button>

          <div style={{height:1,background:"rgba(255,255,255,0.06)",margin:"12px 8px"}}/>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",padding:"0 8px",marginBottom:8}}>Herramientas</div>

          {[
            {icon:"⬇️",label:"Importar CSV",action:()=>{onImport();onClose();}},
            {icon:"⬆️",label:"Exportar CSV",action:()=>{onExport();onClose();},disabled:trades.length===0},
            {icon:"💾",label:"Respaldar todo (JSON)",action:()=>{onBackup();onClose();}},
            {icon:"♻️",label:"Restaurar respaldo",action:()=>{onRestore();onClose();}},
          ].map((item,i)=>(
            <button key={i} onClick={item.disabled?undefined:item.action} style={{display:"flex",alignItems:"center",gap:14,width:"100%",padding:"13px 12px",background:"transparent",border:"none",borderRadius:12,color:item.disabled?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.75)",fontFamily:sans,fontSize:14,cursor:item.disabled?"default":"pointer",marginBottom:2,transition:"background 0.15s",WebkitTapHighlightColor:"transparent"}}
              onMouseEnter={e=>{if(!item.disabled)e.currentTarget.style.background="rgba(255,255,255,0.06)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
              <span style={{fontSize:18,width:24,textAlign:"center"}}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}

          <div style={{height:1,background:"rgba(255,255,255,0.06)",margin:"12px 8px"}}/>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",padding:"0 8px",marginBottom:8}}>Apariencia</div>

          <button onClick={()=>{toggleDark();}} style={{display:"flex",alignItems:"center",gap:14,width:"100%",padding:"13px 12px",background:"transparent",border:"none",borderRadius:12,color:"rgba(255,255,255,0.75)",fontFamily:sans,fontSize:14,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{fontSize:18,width:24,textAlign:"center"}}>{darkMode?"☀️":"🌙"}</span>
            <span>{darkMode?"Modo claro":"Modo oscuro"}</span>
          </button>
        </div>

        <div style={{padding:"16px 20px",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:mono,fontSize:10,color:"rgba(255,255,255,0.15)",textAlign:"center"}}>TradeLog v1.0 · {new Date().getFullYear()}</div>
        </div>
      </div>
    </>
  );
}

// ── Constitución de Gestión de Capital ────────────────────────────────────────
const CONSTITUTION=[
  {num:"I",title:"Identidad y Filosofía",sub:"Quién soy en cada decisión, y por qué eso lo cambia todo.",blocks:[
    {t:"lead",text:"Soy un gestor de capital, no un trader."},
    {t:"p",text:"Un trader depende de encontrar oportunidades cada día y rinde por heroísmo; un gestor construye una estructura de motores complementarios donde la eficiencia del sistema —no su esfuerzo diario— genera el retorno."},
    {t:"call",title:"Mi misión",text:"Construir libertad y tranquilidad mediante una estructura financiera sólida. No maximizar riqueza ni ganar 3% diario — edificar un negocio que genere flujo de caja y patrimonio a largo plazo, sin depender de mi presencia constante."},
    {t:"defs",title:"Mis principios",items:[["Opero por","probabilidad y ventaja matemática"],["No por","corazonadas, euforia ni esperanza"],["Mi edge es","estructural, no adivinanza"],["Mi disciplina","decide, no mi estado de ánimo"]]},
    {t:"p",text:"Cada decisión la tomo preguntándome: ¿es esto lo que mi empresa debería hacer? — no ¿cómo me siento al respecto? La ausencia de estrés no valida una posición. Las reglas de la empresa sí."},
  ]},
  {num:"II",title:"La Ventaja Matemática",sub:"De dónde sale el dinero. El edge que justifica todo el sistema.",blocks:[
    {t:"lead",text:"La prima de riesgo de volatilidad."},
    {t:"p",text:"En promedio, la volatilidad implícita (IV) es mayor que la realizada (RV). El mercado paga de más por las opciones, como por cualquier seguro. Vendiendo prima, yo soy la aseguradora: cobro el sobreprecio estructural con la probabilidad de mi lado."},
    {t:"call",title:"El edge en una línea",text:"No predigo dirección — cobro la sobrevaluación del seguro, vendiendo spreads OTM con alta probabilidad de ganar. El gap IV > RV significa que me pagan más que el valor justo del riesgo."},
    {t:"defs",title:"Las dos lecturas de volatilidad",items:[["IV Rank / Percentile","¿dónde está la IV en su propia historia? Vendo con IVR alto."],["IV vs HV","IV>>HV edge gordo · IV>HV moderado · IV≈HV sin edge · IV<HV no vender prima"]]},
    {t:"p",text:"El número absoluto de IV no dice nada. 40% puede ser alto o bajo según el activo. Solo el contexto —IVR, IV vs HV— determina si hay edge."},
    {t:"call",text:"El edge se realiza con consistencia y disciplina, no con aciertos individuales. Mi trabajo no es ganar cada trade — es ejecutar el sistema en cada trade."},
  ]},
  {num:"III",title:"Estructura de Capital",sub:"Los compartimentos de la empresa. Cada uno con su rol.",blocks:[
    {t:"defs",items:[["⛁ Operativo — motor de flujo","Credit spreads (PCS, CCS, IC). Genera flujo de caja: theta + prima. Máximo ~$550 por operación, el resto en pólvora seca."],["▣ Patrimonio — swings","Posiciones en acciones para swings de 30-50%. Con plan de entrada, tamaño y salida — nunca un pozo donde promediar a la baja."],["⛉ Bóveda — la base","Capital intacto que no se toca. La reserva que permite operar sin la presión de necesitar el dinero. Protege a la empresa de sí misma."]]},
    {t:"p",text:"La visión multi-estrategia: Credit spreads → ingreso · La Rueda → ingreso + acumulación · LEAPS/PMCC → direccional apalancado · Acciones → base estable. Cada componente genera retorno de una fuente distinta — para que el retorno no dependa de ninguno solo."},
  ]},
  {num:"IV",title:"Setup A+ · Put Credit Spread",sub:"Mi entrada quirúrgica alcista. Si no cumple, no entro.",blocks:[
    {t:"steps",items:["Tendencia alcista definida — por encima de las medias clave.","Retroceso de 2-4% (un dip), nunca tras una subida fuerte.","Precio en soporte confirmado (histórico, defendido, o resistencia-vuelta-soporte).","Strike corto bajo ese soporte, con piso estructural debajo. Jamás en un air pocket.","IV elevada vs HV — IVR decente + IV > HV. Sin edge de volatilidad, no hay trade.","Crédito ≥ ~1/3 del ancho. Si cobro centavos por el riesgo, no vale.","Delta agregada no sobre-concentrada.","Tamaño ≤ $550 + plan de salida escrito (objetivo e invalidación)."]},
    {t:"call",title:"La regla de oro",text:"Un retroceso solo es oportunidad si el IV Rank lo justifica, el precio se estabilizó en soporte, y no me sobre-concentra. No 'todo retroceso es oportunidad' — esa es la mentira que cuesta caro."},
  ]},
  {num:"V",title:"Setup A+ · Call Credit Spread",sub:"El reverso exacto. Mi entrada quirúrgica bajista.",blocks:[
    {t:"steps",items:["Tendencia bajista definida — por debajo de las medias clave.","Rebote de 2-4% hacia resistencia, nunca tras una caída fuerte.","Precio en resistencia confirmada (histórica, o soporte-vuelto-resistencia).","Strike corto sobre esa resistencia, con techo estructural arriba. Jamás en air pocket.","IV elevada vs HV — vendo prima solo con edge de volatilidad real.","Crédito ≥ ~1/3 del ancho. El riesgo debe pagarse.","Delta agregada no sobre-concentrada.","Tamaño ≤ $550 + plan de salida escrito. Sin excepciones."]},
    {t:"call",text:"PCS busca un piso que aguante por abajo; CCS busca un techo que tope por arriba. En ambos, el strike corto necesita una estructura real que lo defienda. Lo que flota, cae."},
  ]},
  {num:"VI",title:"Gestión de Riesgo",sub:"Las leyes que protegen el capital. Inviolables.",blocks:[
    {t:"steps",items:["La pared de $550 — máximo ~$550 desplegados por operación. Sin excepciones, sin importar la convicción.","Una posición por ticker y dirección — varias posiciones en un nombre son una sola apuesta disfrazada.","Nunca promediar a la baja — mi error más caro y recurrente. Si la tesis se debilita, cierro o mantengo, nunca agrando.","Límite de concentración por nombre — ningún activo individual domina el patrimonio.","Delta agregada bajo control — conozco mi apuesta direccional NETA. Si está sesgada, el próximo trade equilibra."]},
  ]},
  {num:"VII",title:"Reglas de Salida",sub:"El plan se escribe en frío. Se ejecuta sin emoción.",blocks:[
    {t:"steps",items:["Tomar ganancia al 50% del crédito máximo. No espero el último centavo.","Cerrar por invalidación — si rompe el nivel que sostiene la tesis, la tesis murió.","Respetar la zona de gamma — no sostengo un corto ITM/ATM en los últimos 3-5 días.","Salir por el plan, no por el miedo — un negativo con el nivel intacto y la tesis válida es normal."]},
    {t:"call",text:"El trade anterior no existe. Cada operación es independiente. Cerrar un ganador temprano por miedo, o cortar un negativo que iba a revertir, es dejar que las pérdidas pasadas operen el presente."},
  ]},
  {num:"VIII",title:"Conducta y Psicología",sub:"El verdadero techo del negocio. Donde se gana o se pierde.",blocks:[
    {t:"p",text:"El sistema ya es bueno — los datos lo prueban. La psicología determina que funcione. Mis pérdidas grandes nunca fueron del sistema: fueron momentos donde la emoción tomó el volante."},
    {t:"steps",items:["No operar desde euforia ni esperanza — ambas me sacan del sistema.","Disciplina reforzada en mis tickers favoritos — el éxito previo no exime del scorecard.","Ninguna barrera es irrompible — siempre defino qué hago SI se rompe, antes de entrar.","No operar el retroceso de una subida fuerte — eso es extensión, no dip.","El plan escrito en frío manda sobre la emoción del momento."]},
  ]},
  {num:"IX",title:"Métricas de la Empresa",sub:"Lo que mido. Un negocio se mide; un hobby no.",blocks:[
    {t:"p",text:"El win rate solo no dice la verdad. Mido el edge real con métricas de gestor: Expectancy, Profit factor, Win rate por estrategia y ticker, Limpio vs forzado, Drawdown máximo, Retorno sobre capital."},
    {t:"stats",title:"Mi sistema, medido (79 operaciones)",items:[["+$20","Expectancy/trade"],["1.83","Profit factor"],["76%","Win rate"],["13/14","Tickers rentables"],["5/6","Estrategias rentab."],["$799","Drawdown máx"]]},
    {t:"call",title:"Junta directiva mensual",text:"Al cierre de cada mes: P&L, adherencia a las reglas, qué funcionó, qué se rompió, y el costo de los trades forzados. Reviso mi empresa como lo que es."},
  ]},
  {num:"X",title:"Caso de Estudio · META",sub:"La lección fechada. Grabada para no repetirla.",blocks:[
    {t:"p",text:"META fue mi mejor ticker — hasta que dejé de operarla con el sistema que la hizo ganadora."},
    {t:"defs",items:[["Era 1 — disciplina (mayo)","5 PCS consecutivos, 5 ganadores, 100% win rate, +$292. Entradas limpias, salidas ordenadas."],["Era 2 — la euforia (junio)","META rompió $600→$640, creí que el retroceso se podía operar. Sobre-apalancado. Resultado: -$1,134, incluida mi peor pérdida de -$648."]]},
    {t:"steps",items:["Entré tras una subida fuerte (extensión)","'El retroceso se puede operar' (la mentira)","Sobre-apalancado (rompí la pared de $550)","Confié en $600 como irrompible (air pocket)"]},
    {t:"call",text:"El ticker no falló; bajé la guardia. El arreglo no es abandonar META, es volver a tratarla como en mayo: con el sistema, siempre."},
  ]},
  {num:"XI",title:"La Selección de Estructura",sub:"La dirección la marca el gráfico; la estructura, la tesis.",blocks:[
    {t:"p",text:"La dirección la define la lectura técnica multi-temporalidad: el diario filtra, el 4H ubica, el 1H dispara. Pero la estructura la define el tipo de tesis, reforzada por la IV."},
    {t:"defs",items:[["Créditos · PCS y CCS — flujo","No busco movimientos bruscos, solo que la matemática se cumpla. Puro técnico + probabilidad. No necesito que el activo se mueva, solo que el muro aguante. Far-OTM con IVR alto."],["Débitos · CDS y PDS — tesis","Busco movimientos bruscos impulsados por catalizadores. Gano de la dirección, no del tiempo — mayor expiración, menos capital, IVR bajo (compro dirección barata)."],["Swings — cazar el movimiento","Cazar +20% sin preocupación de expiración. 50% técnicos, 50% fundamentales — por eso no los automatizo."]]},
    {t:"call",title:"El árbol de decisión",text:"ALCISTA → probabilidad+IVR alto = PCS · catalizador+IVR bajo = CDS. BAJISTA → probabilidad+IVR alto = CCS · catalizador+IVR bajo = PDS."},
    {t:"p",text:"En construcción: LEAPS (convicción de largo plazo) y La Rueda (generación sobre acciones del patrimonio)."},
  ]},
];

const COMPROMISO=["Ejecuto el sistema, no el estado de ánimo.","Mido lo que importa y reviso mi empresa.","No promedio a la baja. No persigo extensiones.","Ninguna barrera es irrompible.","Mi disciplina se refuerza donde más confío.","El plan escrito en frío manda sobre la emoción.","El capital ya está protegido por la estructura.","Lo único que entreno es la cabeza."];

function ConstitucionScreen({onClose}){
  const GOLD="#F59E0B",GOLD2="#FCD34D";
  const Block=({b})=>{
    if(b.t==="lead") return <p style={{fontFamily:sans,fontSize:16,fontWeight:800,color:GOLD2,margin:"0 0 10px",lineHeight:1.4}}>{b.text}</p>;
    if(b.t==="p") return <p style={{fontFamily:sans,fontSize:13.5,color:"rgba(255,255,255,0.72)",margin:"0 0 12px",lineHeight:1.6}}>{b.text}</p>;
    if(b.t==="call") return (
      <div style={{background:"rgba(245,158,11,0.07)",border:"1px solid rgba(245,158,11,0.25)",borderRadius:12,padding:"13px 15px",margin:"0 0 14px"}}>
        {b.title&&<div style={{fontFamily:mono,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:GOLD,marginBottom:6}}>{b.title}</div>}
        <p style={{fontFamily:sans,fontSize:13,color:"rgba(255,255,255,0.82)",margin:0,lineHeight:1.55}}>{b.text}</p>
      </div>
    );
    if(b.t==="defs") return (
      <div style={{margin:"0 0 14px"}}>
        {b.title&&<div style={{fontFamily:mono,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:10}}>{b.title}</div>}
        {b.items.map((it,i)=>(
          <div key={i} style={{marginBottom:11,paddingLeft:12,borderLeft:"2px solid rgba(245,158,11,0.35)"}}>
            <div style={{fontFamily:sans,fontSize:13,fontWeight:800,color:"#fff",marginBottom:3}}>{it[0]}</div>
            <div style={{fontFamily:sans,fontSize:12.5,color:"rgba(255,255,255,0.65)",lineHeight:1.5}}>{it[1]}</div>
          </div>
        ))}
      </div>
    );
    if(b.t==="steps") return (
      <div style={{margin:"0 0 14px"}}>
        {b.items.map((s,i)=>{
          const parts=s.split(" — ");
          return (
            <div key={i} style={{display:"flex",gap:11,marginBottom:9,alignItems:"flex-start"}}>
              <span style={{flexShrink:0,width:22,height:22,borderRadius:6,background:"rgba(245,158,11,0.13)",border:"1px solid rgba(245,158,11,0.3)",color:GOLD2,fontFamily:mono,fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{i+1}</span>
              <span style={{fontFamily:sans,fontSize:12.5,color:"rgba(255,255,255,0.75)",lineHeight:1.5,paddingTop:2}}>
                {parts.length>1?<><b style={{color:"#fff"}}>{parts[0]}</b> — {parts.slice(1).join(" — ")}</>:s}
              </span>
            </div>
          );
        })}
      </div>
    );
    if(b.t==="stats") return (
      <div style={{margin:"0 0 14px"}}>
        {b.title&&<div style={{fontFamily:mono,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:10}}>{b.title}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          {b.items.map((it,i)=>(
            <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"11px 8px",textAlign:"center"}}>
              <div style={{fontFamily:mono,fontSize:16,fontWeight:700,color:GOLD2,marginBottom:2}}>{it[0]}</div>
              <div style={{fontFamily:sans,fontSize:9.5,color:"rgba(255,255,255,0.5)",lineHeight:1.2}}>{it[1]}</div>
            </div>
          ))}
        </div>
      </div>
    );
    return null;
  };
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,background:"#080B12",display:"flex",flexDirection:"column"}}>
      <div style={{flexShrink:0,padding:"14px 18px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(8,11,18,0.96)",backdropFilter:"blur(20px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          <span style={{fontSize:22}}>📜</span>
          <div>
            <div style={{fontFamily:sans,fontSize:16,fontWeight:800,color:"#fff",lineHeight:1.1}}>Constitución</div>
            <div style={{fontFamily:mono,fontSize:9.5,color:"rgba(245,158,11,0.7)",letterSpacing:"0.08em"}}>GESTIÓN DE CAPITAL · v1.1</div>
          </div>
        </div>
        <button onClick={onClose} style={{width:34,height:34,borderRadius:10,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.7)",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",WebkitTapHighlightColor:"transparent"}}>✕</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px 18px 60px",WebkitOverflowScrolling:"touch"}}>
        <div style={{textAlign:"center",marginBottom:26}}>
          <div style={{fontFamily:sans,fontSize:22,fontWeight:800,color:"#fff",lineHeight:1.2,marginBottom:6}}>El manual de operaciones</div>
          <p style={{fontFamily:sans,fontSize:12.5,color:"rgba(255,255,255,0.5)",margin:0,lineHeight:1.5}}>Las reglas como ley — no como recuerdo.<br/>Ricardo · Operador de Capital</p>
        </div>
        {CONSTITUTION.map((art,i)=>(
          <div key={i} style={{marginBottom:22,background:"rgba(14,20,32,0.6)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:"18px 16px"}}>
            <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:3}}>
              <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:GOLD,letterSpacing:"0.05em"}}>Artículo {art.num}</span>
            </div>
            <div style={{fontFamily:sans,fontSize:18,fontWeight:800,color:"#fff",marginBottom:4,lineHeight:1.2}}>{art.title}</div>
            <div style={{fontFamily:sans,fontSize:12,color:"rgba(255,255,255,0.45)",marginBottom:16,fontStyle:"italic",lineHeight:1.4}}>{art.sub}</div>
            {art.blocks.map((b,j)=><Block key={j} b={b}/>)}
          </div>
        ))}
        <div style={{marginBottom:30,background:"linear-gradient(135deg,rgba(245,158,11,0.12),rgba(252,211,77,0.04))",border:"1px solid rgba(245,158,11,0.35)",borderRadius:16,padding:"22px 18px",textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:6}}>◆</div>
          <div style={{fontFamily:sans,fontSize:18,fontWeight:800,color:GOLD2,marginBottom:16}}>El Compromiso</div>
          {COMPROMISO.map((line,i)=>(
            <p key={i} style={{fontFamily:sans,fontSize:13.5,color:"rgba(255,255,255,0.85)",margin:"0 0 7px",lineHeight:1.5}}>{line}</p>
          ))}
          <div style={{fontFamily:mono,fontSize:11,color:GOLD,marginTop:16,letterSpacing:"0.05em"}}>Ricardo · Gestor de Capital · 2026</div>
        </div>
      </div>
    </div>
  );
}

// ── Bottom Nav ────────────────────────────────────────────────────────────────
function BottomNav({view,setView,drafts,depAlertCount}){
  const tabs=[
    {id:"dashboard",icon:"▦",label:"Overview"},
    {id:"trades",   icon:"📋",label:"Journal"},
    {id:"open",     icon:"🎯",label:"Open"},
    {id:"scorecard",icon:"◉",label:"Score"},
  ];
  return(
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(8,11,18,0.96)",backdropFilter:"blur(20px)",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",zIndex:50,paddingBottom:"env(safe-area-inset-bottom,8px)"}}>
      {tabs.map(tab=>{
        const active=view===tab.id;
        const draftBadge=tab.id==="trades"&&drafts.length>0;
        const alertBadge=tab.id==="open"&&depAlertCount>0;
        const badgeColor=draftBadge?"#A78BFA":alertBadge?"#F87171":null;
        return(
          <button key={tab.id} onClick={()=>setView(tab.id)} style={{flex:1,background:"none",border:"none",padding:"10px 4px 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:4,cursor:"pointer",WebkitTapHighlightColor:"transparent",position:"relative"}}>
            {badgeColor&&<div style={{position:"absolute",top:8,right:"calc(50% - 14px)",width:7,height:7,borderRadius:"50%",background:badgeColor,border:"1.5px solid #080B12"}}/>}
            <span style={{fontSize:17,lineHeight:1,filter:active?"none":"grayscale(1)",opacity:active?1:0.35,transition:"all 0.2s"}}>{tab.icon}</span>
            <span style={{fontFamily:sans,fontSize:9,fontWeight:active?700:400,color:active?GOLD:"rgba(255,255,255,0.3)",letterSpacing:"0.04em",transition:"all 0.2s"}}>{tab.label}</span>
            {active&&<div style={{position:"absolute",bottom:0,left:"50%",transform:"translateX(-50%)",width:20,height:2,background:GOLD,borderRadius:"2px 2px 0 0"}}/>}
          </button>
        );
      })}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({onAdd,onImport}){
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 24px",textAlign:"center",gap:0}}>
      <div style={{fontSize:56,marginBottom:20,opacity:0.6}}>📊</div>
      <h2 style={{fontFamily:sans,fontSize:22,fontWeight:800,color:"#fff",letterSpacing:"-0.03em",marginBottom:10}}>Sin trades aún</h2>
      <p style={{fontFamily:sans,fontSize:14,color:"rgba(255,255,255,0.35)",lineHeight:1.6,maxWidth:260,marginBottom:32}}>Agrega tu primer trade o importa un CSV de tu broker para empezar.</p>
      <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:280}}>
        <button onClick={onAdd} style={{background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",border:"none",borderRadius:14,padding:"16px",color:"#000",fontFamily:sans,fontSize:15,fontWeight:800,cursor:"pointer",boxShadow:"0 4px 20px "+GOLD+"40",WebkitTapHighlightColor:"transparent"}}>
          + Agregar Trade
        </button>
        <button onClick={onImport} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"16px",color:"rgba(255,255,255,0.7)",fontFamily:sans,fontSize:15,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
          ⬇ Importar CSV
        </button>
      </div>
    </div>
  );
}

// ── Calculadora Rápida (drawer modal) ────────────────────────────────────────
function QuickCalcModal({onClose}){
  const [strat,setStrat]=useState("pcs");
  const [premium,setPremium]=useState("");
  const [shortS,setShortS]=useState("");
  const [longS,setLongS]=useState("");
  const [contracts,setContracts]=useState("1");
  const [spot,setSpot]=useState("");

  const calc=useMemo(()=>{
    const p=parseFloat(premium)||0;
    const ss=parseFloat(shortS)||0;
    const ls=parseFloat(longS)||0;
    const c=parseInt(contracts)||1;
    const sp=parseFloat(spot)||0;
    const w=(ss>0&&ls>0)?Math.abs(ss-ls):0;
    if(!p||!w)return null;
    const isCredit=strat==="pcs"||strat==="ccs"||strat==="ic"||strat==="ib";
    let maxProfit,maxLoss,be;
    if(isCredit){
      maxProfit=p*100*c;maxLoss=(w-p)*100*c;
      if(strat==="pcs")be=ss-p;else if(strat==="ccs")be=ss+p;else be=ss;
    } else {
      maxProfit=(w-p)*100*c;maxLoss=p*100*c;
      if(strat==="bcs")be=ss+p;else be=ss-p;
    }
    const rr=maxLoss>0?maxProfit/maxLoss:null;
    let beDist=null;
    if(sp>0&&be)beDist=Math.abs((be-sp)/sp)*100;
    return{maxProfit,maxLoss,be,rr,beDist,isCredit,width:w};
  },[premium,shortS,longS,contracts,spot,strat]);

  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60,padding:0}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
          <div>
            <p style={{fontSize:18,fontWeight:800,color:"#fff",fontFamily:sans,marginBottom:3}}>◈ Calculadora Rápida</p>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:mono}}>Solo números crudos. Sin scoring.</p>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>

        <StratPicker value={strat} onChange={setStrat}/>

        <div style={{height:14}}/>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <FInput label={strat==="bcs"||strat==="pds"?"Débito $":"Crédito $"} value={premium} onChange={setPremium} type="number" placeholder="0.67"/>
          <FInput label="Contratos" value={contracts} onChange={setContracts} type="number" placeholder="3"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <FInput label="Strike Corto $" value={shortS} onChange={setShortS} type="number" placeholder="590"/>
          <FInput label="Strike Largo $" value={longS} onChange={setLongS} type="number" placeholder="587"/>
        </div>
        <FInput label="Spot $ (opcional, para foso)" value={spot} onChange={setSpot} type="number" placeholder="605"/>

        {calc&&(
          <div style={{marginTop:18,background:"linear-gradient(135deg,rgba(245,158,11,0.08),rgba(252,211,77,0.04))",border:"1px solid rgba(245,158,11,0.25)",borderRadius:14,padding:"16px",display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div style={{padding:"10px 12px",background:"rgba(74,222,128,0.08)",borderRadius:9}}>
                <div style={{fontSize:9,color:"rgba(74,222,128,0.7)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Max Profit</div>
                <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:"#4ADE80"}}>+${calc.maxProfit.toFixed(0)}</div>
              </div>
              <div style={{padding:"10px 12px",background:"rgba(248,113,113,0.08)",borderRadius:9}}>
                <div style={{fontSize:9,color:"rgba(248,113,113,0.7)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Max Loss</div>
                <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:"#F87171"}}>-${calc.maxLoss.toFixed(0)}</div>
              </div>
              {calc.be&&(
                <div style={{padding:"10px 12px",background:"rgba(255,255,255,0.04)",borderRadius:9}}>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.5)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Breakeven</div>
                  <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:"#fff"}}>${calc.be.toFixed(2)}</div>
                </div>
              )}
              {calc.rr!==null&&(
                <div style={{padding:"10px 12px",background:"rgba(255,255,255,0.04)",borderRadius:9}}>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.5)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>R/R</div>
                  <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:calc.isCredit?(calc.rr>=0.5?"#4ADE80":calc.rr>=0.33?GOLD:"#F87171"):(calc.rr>=2?"#4ADE80":calc.rr>=1?GOLD:"#F87171")}}>1 : {calc.rr>=1?calc.rr.toFixed(2):(1/calc.rr).toFixed(2)}</div>
                </div>
              )}
            </div>
            {calc.beDist!==null&&(
              <div style={{padding:"10px 12px",background:"rgba(255,255,255,0.03)",borderRadius:9,fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.7)",textAlign:"center"}}>
                🏰 Foso: {calc.beDist.toFixed(2)}% al breakeven
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Capital: Setup inicial ───────────────────────────────────────────────────
function CapitalSetupModal({onClose,onSetup}){
  const [op,setOp]=useState("");
  const [pat,setPat]=useState("");
  const [bov,setBov]=useState("");
  const total=(parseFloat(op)||0)+(parseFloat(pat)||0)+(parseFloat(bov)||0);
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:24}}>🏛️</span>
          <p style={{fontSize:20,fontWeight:800,color:"#fff",fontFamily:sans}}>Configurar Capital</p>
        </div>
        <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",fontFamily:sans,marginBottom:22,lineHeight:1.5}}>
          Define tu punto de partida hoy. A partir de mañana mediremos el crecimiento real de cada compartimento desde estos valores.
        </p>

        <div style={{marginBottom:14,padding:"14px",background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:18}}>💰</span>
            <span style={{fontFamily:sans,fontSize:13,fontWeight:700,color:"#FCD34D"}}>Capital Operativo</span>
          </div>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.45)",fontFamily:sans,marginBottom:10}}>Todo tu dinero de trading en el broker (incluye lo desplegado en posiciones abiertas + lo disponible)</p>
          <FInput label="Monto $" value={op} onChange={setOp} type="number" placeholder="7000"/>
        </div>

        <div style={{marginBottom:14,padding:"14px",background:"rgba(56,189,248,0.06)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:18}}>📊</span>
            <span style={{fontFamily:sans,fontSize:13,fontWeight:700,color:"#38BDF8"}}>Patrimonio</span>
          </div>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.45)",fontFamily:sans,marginBottom:10}}>Capital en acciones a largo plazo</p>
          <FInput label="Monto $" value={pat} onChange={setPat} type="number" placeholder="8000"/>
        </div>

        <div style={{marginBottom:18,padding:"14px",background:"rgba(148,163,184,0.06)",border:"1px solid rgba(148,163,184,0.2)",borderRadius:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:18}}>🏦</span>
            <span style={{fontFamily:sans,fontSize:13,fontWeight:700,color:"#CBD5E1"}}>Bóveda</span>
          </div>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.45)",fontFamily:sans,marginBottom:10}}>Reserva estratégica fuera del broker</p>
          <FInput label="Monto $" value={bov} onChange={setBov} type="number" placeholder="10000"/>
        </div>

        {total>0&&(
          <div style={{padding:"16px",background:"rgba(74,222,128,0.08)",border:"1px solid rgba(74,222,128,0.25)",borderRadius:12,marginBottom:18,textAlign:"center"}}>
            <div style={{fontSize:10,color:"rgba(74,222,128,0.7)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Capital Total Inicial</div>
            <div style={{fontFamily:mono,fontSize:30,fontWeight:800,color:"#4ADE80"}}>${total.toLocaleString()}</div>
          </div>
        )}

        <button onClick={()=>onSetup(op,pat,bov)} disabled={total<=0}
          style={{width:"100%",padding:"16px",background:total>0?"linear-gradient(135deg,#F59E0B,#FCD34D)":"rgba(255,255,255,0.1)",border:"none",borderRadius:14,color:total>0?"#1A1206":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:15,fontWeight:700,cursor:total>0?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
          Establecer Punto de Partida
        </button>
      </div>
    </div>
  );
}

// ── Capital: Mover capital entre compartimentos ──────────────────────────────
function MoveCapitalModal({onClose,onMove,capital}){
  const buckets=[
    {id:"operativo",label:"💰 Capital Operativo"},
    {id:"patrimonio",label:"📊 Patrimonio"},
    {id:"boveda",label:"🏦 Bóveda"},
    {id:"externo",label:"🌐 Externo (depósito/retiro)"},
  ];
  const [from,setFrom]=useState("operativo");
  const [to,setTo]=useState("boveda");
  const [amount,setAmount]=useState("");
  const [reason,setReason]=useState("");
  const amt=parseFloat(amount)||0;
  const valid=amt>0&&from!==to;
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:70}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <p style={{fontSize:18,fontWeight:800,color:"#fff",fontFamily:sans}}>🔄 Mover Capital</p>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Desde</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {buckets.map(b=>(
              <button key={b.id} onClick={()=>setFrom(b.id)} style={{padding:"11px 14px",background:from===b.id?"rgba(245,158,11,0.12)":"rgba(255,255,255,0.02)",border:"1px solid "+(from===b.id?"rgba(245,158,11,0.5)":"rgba(255,255,255,0.08)"),borderRadius:10,color:from===b.id?"#FCD34D":"rgba(255,255,255,0.6)",fontFamily:sans,fontSize:13,fontWeight:from===b.id?600:400,textAlign:"left",cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                {b.label}{capital&&b.id!=="externo"?"  ·  $"+(capital[b.id]||0).toLocaleString():""}
              </button>
            ))}
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"center",margin:"4px 0"}}><span style={{fontSize:20,color:"rgba(255,255,255,0.3)"}}>↓</span></div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Hacia</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {buckets.filter(b=>b.id!==from).map(b=>(
              <button key={b.id} onClick={()=>setTo(b.id)} style={{padding:"11px 14px",background:to===b.id?"rgba(74,222,128,0.12)":"rgba(255,255,255,0.02)",border:"1px solid "+(to===b.id?"rgba(74,222,128,0.5)":"rgba(255,255,255,0.08)"),borderRadius:10,color:to===b.id?"#4ADE80":"rgba(255,255,255,0.6)",fontFamily:sans,fontSize:13,fontWeight:to===b.id?600:400,textAlign:"left",cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                {b.label}{capital&&b.id!=="externo"?"  ·  $"+(capital[b.id]||0).toLocaleString():""}
              </button>
            ))}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:10,marginBottom:18}}>
          <FInput label="Monto $" value={amount} onChange={setAmount} type="number" placeholder="500"/>
          <FInput label="Razón (opcional)" value={reason} onChange={setReason} placeholder="Proteger ganancias del mes"/>
        </div>

        <button onClick={()=>onMove(from,to,amount,reason)} disabled={!valid}
          style={{width:"100%",padding:"16px",background:valid?"linear-gradient(135deg,#F59E0B,#FCD34D)":"rgba(255,255,255,0.1)",border:"none",borderRadius:14,color:valid?"#1A1206":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:15,fontWeight:700,cursor:valid?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
          Confirmar Movimiento
        </button>
      </div>
    </div>
  );
}

// ── Agregar posición de patrimonio ───────────────────────────────────────────
function AddStockModal({onClose,onAdd}){
  const [ticker,setTicker]=useState("");
  const [shares,setShares]=useState("");
  const [entryPrice,setEntryPrice]=useState("");
  const [currentPrice,setCurrentPrice]=useState("");
  const [source,setSource]=useState("operativo");
  const ep=parseFloat(entryPrice)||0;
  const cp=parseFloat(currentPrice)||ep;
  const sh=parseFloat(shares)||0;
  const currentVal=cp*sh;
  const cost=ep*sh;
  const gainLoss=(cp-ep)*sh;
  const gainPct=ep>0?((cp-ep)/ep)*100:0;
  const valid=ticker.trim()&&sh>0&&ep>0;
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:70}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <p style={{fontSize:18,fontWeight:800,color:"#fff",fontFamily:sans}}>📈 Agregar Posición</p>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <FInput label="Ticker" value={ticker} onChange={setTicker} placeholder="HOOD"/>
          <FInput label="Número de acciones" value={shares} onChange={setShares} type="number" placeholder="30.23"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <FInput label="Precio de entrada $" value={entryPrice} onChange={setEntryPrice} type="number" placeholder="76.48"/>
          <FInput label="Precio actual $" value={currentPrice} onChange={v=>{setCurrentPrice(v);}} type="number" placeholder="95.60"/>
        </div>

        {/* Origen del capital */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>¿De dónde sale el capital?</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <button onClick={()=>setSource("operativo")} style={{padding:"12px 14px",textAlign:"left",background:source==="operativo"?"rgba(245,158,11,0.12)":"rgba(255,255,255,0.02)",border:"1px solid "+(source==="operativo"?"rgba(245,158,11,0.5)":"rgba(255,255,255,0.08)"),borderRadius:10,color:source==="operativo"?"#FCD34D":"rgba(255,255,255,0.6)",fontFamily:sans,fontSize:13,fontWeight:source==="operativo"?600:400,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
              💰 Compra nueva — descuenta del Operativo{cost>0?"  ($"+cost.toLocaleString(undefined,{maximumFractionDigits:0})+")":""}
            </button>
            <button onClick={()=>setSource("patrimonio")} style={{padding:"12px 14px",textAlign:"left",background:source==="patrimonio"?"rgba(56,189,248,0.12)":"rgba(255,255,255,0.02)",border:"1px solid "+(source==="patrimonio"?"rgba(56,189,248,0.5)":"rgba(255,255,255,0.08)"),borderRadius:10,color:source==="patrimonio"?"#38BDF8":"rgba(255,255,255,0.6)",fontFamily:sans,fontSize:13,fontWeight:source==="patrimonio"?600:400,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
              📊 Ya está en mi Patrimonio — migración (no toca Operativo)
            </button>
          </div>
        </div>

        {valid&&(
          <div style={{padding:"14px",background:"rgba(56,189,248,0.06)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:12,marginBottom:18}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,textAlign:"center"}}>
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>Valor actual</div>
                <div style={{fontFamily:mono,fontSize:15,fontWeight:700,color:"#38BDF8"}}>${currentVal.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              </div>
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>G/P</div>
                <div style={{fontFamily:mono,fontSize:15,fontWeight:700,color:gainLoss>=0?"#4ADE80":"#F87171"}}>{gainLoss>=0?"+":""}${gainLoss.toFixed(0)}</div>
              </div>
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>Retorno</div>
                <div style={{fontFamily:mono,fontSize:15,fontWeight:700,color:gainPct>=0?"#4ADE80":"#F87171"}}>{gainPct>=0?"+":""}{gainPct.toFixed(1)}%</div>
              </div>
            </div>
          </div>
        )}
        <button onClick={()=>valid&&onAdd(ticker,shares,entryPrice,currentPrice||entryPrice,source)} disabled={!valid}
          style={{width:"100%",padding:"16px",background:valid?"linear-gradient(135deg,#F59E0B,#FCD34D)":"rgba(255,255,255,0.1)",border:"none",borderRadius:14,color:valid?"#1A1206":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:15,fontWeight:700,cursor:valid?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
          Agregar Posición
        </button>
      </div>
    </div>
  );
}

// ── Agregar acciones a posición existente ─────────────────────────────────────
function AddSharesModal({stock,onClose,onAdd}){
  const [shares,setShares]=useState("");
  const [price,setPrice]=useState("");
  const [source,setSource]=useState("operativo");
  const sh=parseFloat(shares)||0;
  const pr=parseFloat(price)||0;
  const cost=sh*pr;
  const valid=sh>0&&pr>0;
  const totalShares=stock.shares+sh;
  const newAvg=totalShares>0?((stock.shares*stock.entryPrice)+(sh*pr))/totalShares:stock.entryPrice;
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:70}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div>
            <p style={{fontSize:20,fontWeight:800,color:"#fff",fontFamily:sans}}>+ Acciones · {stock.ticker}</p>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:mono}}>Tienes {stock.shares} acc @ ${stock.entryPrice.toFixed(2)} promedio</p>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{height:14}}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <FInput label="Acciones a agregar" value={shares} onChange={setShares} type="number" placeholder="10"/>
          <FInput label="Precio de compra $" value={price} onChange={setPrice} type="number" placeholder="95.60"/>
        </div>

        <div style={{marginBottom:16}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>¿De dónde sale el capital?</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <button onClick={()=>setSource("operativo")} style={{padding:"12px 14px",textAlign:"left",background:source==="operativo"?"rgba(245,158,11,0.12)":"rgba(255,255,255,0.02)",border:"1px solid "+(source==="operativo"?"rgba(245,158,11,0.5)":"rgba(255,255,255,0.08)"),borderRadius:10,color:source==="operativo"?"#FCD34D":"rgba(255,255,255,0.6)",fontFamily:sans,fontSize:13,fontWeight:source==="operativo"?600:400,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
              💰 Compra nueva — descuenta del Operativo{cost>0?"  ($"+cost.toLocaleString(undefined,{maximumFractionDigits:0})+")":""}
            </button>
            <button onClick={()=>setSource("patrimonio")} style={{padding:"12px 14px",textAlign:"left",background:source==="patrimonio"?"rgba(56,189,248,0.12)":"rgba(255,255,255,0.02)",border:"1px solid "+(source==="patrimonio"?"rgba(56,189,248,0.5)":"rgba(255,255,255,0.08)"),borderRadius:10,color:source==="patrimonio"?"#38BDF8":"rgba(255,255,255,0.6)",fontFamily:sans,fontSize:13,fontWeight:source==="patrimonio"?600:400,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
              📊 Ya está en mi Patrimonio — migración (no toca Operativo)
            </button>
          </div>
        </div>

        {valid&&(
          <div style={{padding:"14px",background:"rgba(56,189,248,0.06)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:12,marginBottom:18}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,textAlign:"center"}}>
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>Total acciones</div>
                <div style={{fontFamily:mono,fontSize:15,fontWeight:700,color:"#fff"}}>{totalShares.toFixed(2)}</div>
              </div>
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>Nuevo promedio</div>
                <div style={{fontFamily:mono,fontSize:15,fontWeight:700,color:"#FCD34D"}}>${newAvg.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}
        <button onClick={()=>valid&&onAdd(stock.id,shares,price,source)} disabled={!valid}
          style={{width:"100%",padding:"16px",background:valid?"linear-gradient(135deg,#F59E0B,#FCD34D)":"rgba(255,255,255,0.1)",border:"none",borderRadius:14,color:valid?"#1A1206":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:15,fontWeight:700,cursor:valid?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
          Agregar Acciones
        </button>
      </div>
    </div>
  );
}

// ── Cerrar posición de patrimonio ─────────────────────────────────────────────
function CloseStockModal({stock,onClose,onConfirm}){
  const [salePrice,setSalePrice]=useState(String(stock.currentPrice||""));
  const [notes,setNotes]=useState("");
  const sp=parseFloat(salePrice)||0;
  const totalCash=sp*stock.shares;
  const gainLoss=(sp-stock.entryPrice)*stock.shares;
  const gainPct=stock.entryPrice>0?((sp-stock.entryPrice)/stock.entryPrice)*100:0;
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:70}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div>
            <p style={{fontSize:20,fontWeight:800,color:"#fff",fontFamily:sans}}>{stock.ticker}</p>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:mono}}>{stock.shares} acciones · entrada ${stock.entryPrice}</p>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{height:14}}/>
        <FInput label="Precio de venta $" value={salePrice} onChange={setSalePrice} type="number" placeholder={String(stock.currentPrice)}/>
        <div style={{height:10}}/>
        <FInput label="Notas (opcional)" value={notes} onChange={setNotes} placeholder="Trailing stop activado, tomé 50%..."/>
        {sp>0&&(
          <div style={{marginTop:14,padding:"14px",background:gainLoss>=0?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)",border:"1px solid "+(gainLoss>=0?"rgba(74,222,128,0.25)":"rgba(248,113,113,0.25)"),borderRadius:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,textAlign:"center"}}>
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>Efectivo recibido</div>
                <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:"#38BDF8"}}>${totalCash.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              </div>
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>G/P realizada</div>
                <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:gainLoss>=0?"#4ADE80":"#F87171"}}>{gainLoss>=0?"+":""}${gainLoss.toFixed(0)}</div>
              </div>
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>Retorno</div>
                <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:gainPct>=0?"#4ADE80":"#F87171"}}>{gainPct>=0?"+":""}{gainPct.toFixed(1)}%</div>
              </div>
            </div>
            <div style={{marginTop:10,fontSize:11,fontFamily:sans,color:"rgba(255,255,255,0.5)",textAlign:"center"}}>
              💰 ${totalCash.toLocaleString(undefined,{maximumFractionDigits:0})} pasarán a Capital Operativo · G/P registrada en Journal
            </div>
          </div>
        )}
        <button onClick={()=>sp>0&&onConfirm(stock,salePrice,notes)} disabled={sp<=0}
          style={{marginTop:16,width:"100%",padding:"16px",background:sp>0?"linear-gradient(135deg,#F59E0B,#FCD34D)":"rgba(255,255,255,0.1)",border:"none",borderRadius:14,color:sp>0?"#1A1206":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:15,fontWeight:700,cursor:sp>0?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
          Cerrar y registrar en Journal
        </button>
      </div>
    </div>
  );
}

// ── Actualizar precio de acción ───────────────────────────────────────────────
function UpdateStockPriceModal({stock,onClose,onUpdate}){
  const [price,setPrice]=useState(String(stock.currentPrice||""));
  const np=parseFloat(price)||0;
  const gainLoss=np>0?(np-stock.entryPrice)*stock.shares:0;
  const gainPct=np>0&&stock.entryPrice>0?((np-stock.entryPrice)/stock.entryPrice)*100:0;
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:70}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <p style={{fontSize:20,fontWeight:800,color:"#fff",fontFamily:sans}}>{stock.ticker}</p>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:mono}}>{stock.shares} acciones · entrada ${stock.entryPrice}</p>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <FInput label="Precio actual $" value={price} onChange={setPrice} type="number" placeholder={String(stock.currentPrice)}/>
        {np>0&&(
          <div style={{marginTop:12,display:"flex",gap:10,justifyContent:"center"}}>
            <div style={{textAlign:"center",padding:"10px 16px",background:"rgba(255,255,255,0.03)",borderRadius:10}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>Valor total</div>
              <div style={{fontFamily:mono,fontSize:16,fontWeight:700,color:"#38BDF8"}}>${(np*stock.shares).toLocaleString(undefined,{maximumFractionDigits:0})}</div>
            </div>
            <div style={{textAlign:"center",padding:"10px 16px",background:"rgba(255,255,255,0.03)",borderRadius:10}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,textTransform:"uppercase",marginBottom:3}}>G/P</div>
              <div style={{fontFamily:mono,fontSize:16,fontWeight:700,color:gainLoss>=0?"#4ADE80":"#F87171"}}>{gainLoss>=0?"+":""}${gainLoss.toFixed(0)} ({gainPct>=0?"+":""}{gainPct.toFixed(1)}%)</div>
            </div>
          </div>
        )}
        <button onClick={()=>np>0&&onUpdate(stock.id,price)} disabled={np<=0}
          style={{marginTop:16,width:"100%",padding:"16px",background:np>0?"linear-gradient(135deg,#F59E0B,#FCD34D)":"rgba(255,255,255,0.1)",border:"none",borderRadius:14,color:np>0?"#1A1206":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:15,fontWeight:700,cursor:np>0?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
          Actualizar Precio
        </button>
      </div>
    </div>
  );
}

// ── Parser: texto de IA → campos del trade ───────────────────────────────────
function parseAIText(text){
  const result={};
  const stratMap={
    PCS:"pcs",BCS:"bcs",CCS:"ccs",PDS:"pds",
    IC:"ic","IRON CONDOR":"ic",IB:"ib","IRON BUTTERFLY":"ib",
    SW:"swing",SWING:"swing","SWING TRADE":"swing",PAT:"pat",
  };
  const lines=text.split("\n");
  for(const line of lines){
    const idx=line.indexOf(":");
    if(idx===-1)continue;
    const rawKey=line.slice(0,idx).trim();
    const val=line.slice(idx+1).trim();
    if(!val)continue;
    // normalize: remove accents, uppercase
    const key=rawKey.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    switch(key){
      case "TICKER":      result.ticker=val.toUpperCase().replace(/[^A-Z0-9]/g,""); break;
      case "ESTRATEGIA":  result.strat=stratMap[val.toUpperCase().trim()]||"otras"; break;
      case "STRIKES":     result.strikes=val.replace(/\s/g,""); break;
      case "CREDITO":     result.premium=val.replace(/[$,\s]/g,""); break;
      case "DEBITO":      result.premium=val.replace(/[$,\s]/g,""); break;
      case "CONTRATOS":   result.contracts=val.replace(/[^0-9.]/g,""); break;
      case "EXPIRACION":  result.expiry=val.replace(/[^0-9\-]/g,"").slice(0,10); break;
      case "SPOT":        result.spot=val.replace(/[$,\s]/g,""); break;
      case "IVR":         result.ivr=val.replace(/[^0-9.]/g,""); break;
      case "NOTAS":       result.notes=val; break;
    }
  }
  return Object.keys(result).length>2?result:null;
}

// ── PasteFromAIModal ──────────────────────────────────────────────────────────
function PasteFromAIModal({onClose,onConfirm}){
  const [text,setText]=useState("");
  const parsed=useMemo(()=>parseAIText(text),[text]);
  const stratLabels={pcs:"PCS",bcs:"BCS",ccs:"CCS",pds:"PDS",ic:"IC",ib:"IB",swing:"SW",otras:"Otras",pat:"PAT"};
  const fieldLabel=(k,v)=>{
    const labels={ticker:"Ticker",strat:"Estrategia",strikes:"Strikes",premium:"Crédito/Débito",contracts:"Contratos",expiry:"Expiración",spot:"Spot",ivr:"IVR",notes:"Notas"};
    const display=k==="strat"?stratLabels[v]||v:v;
    return{label:labels[k]||k,value:display};
  };
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(56,189,248,0.2)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"92vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <div>
            <p style={{fontSize:19,fontWeight:800,color:"#fff",fontFamily:sans}}>📋 Importar desde IA</p>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:mono,marginTop:3}}>Pega la respuesta de Gemini aquí</p>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>

        {/* Prompt de referencia */}
        <div style={{padding:"12px 14px",background:"rgba(56,189,248,0.05)",border:"1px solid rgba(56,189,248,0.15)",borderRadius:12,marginBottom:14}}>
          <div style={{fontSize:9,color:"#38BDF8",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Prompt para Gemini (cópialo una vez y guárdalo)</div>
          <p style={{fontSize:11,fontFamily:mono,color:"rgba(255,255,255,0.55)",lineHeight:1.7,userSelect:"all"}}>
            {"Analiza esta posición y respóndeme ÚNICAMENTE en este formato, sin texto adicional:\nTICKER: \nESTRATEGIA: (PCS/BCS/CCS/PDS/IC/IB/SW)\nSTRIKES: (ej: 590/587)\nCREDITO: (solo número)\nCONTRATOS: \nEXPIRACION: (YYYY-MM-DD)\nSPOT: (solo número)\nIVR: (solo número)\nNOTAS: (máx una línea)"}
          </p>
        </div>

        {/* Área de pegado */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Respuesta de Gemini</div>
          <textarea value={text} onChange={e=>setText(e.target.value)}
            placeholder={"TICKER: META\nESTRATEGIA: PCS\nSTRIKES: 590/587\nCREDITO: 0.67\nCONTRATOS: 3\nEXPIRACION: 2026-06-14\nSPOT: 605.40\nIVR: 45\nNOTAS: Retroceso desde resistencia"}
            style={{width:"100%",minHeight:180,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"14px",color:"rgba(255,255,255,0.85)",fontFamily:"'DM Mono',monospace",fontSize:12,resize:"none",lineHeight:1.7,outline:"none",boxSizing:"border-box"}}/>
        </div>

        {/* Preview de campos parseados */}
        {parsed&&(
          <div style={{marginBottom:18,padding:"14px",background:"rgba(74,222,128,0.06)",border:"1px solid rgba(74,222,128,0.2)",borderRadius:12}}>
            <div style={{fontSize:9,color:"rgba(74,222,128,0.7)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>✓ Detectado — preview</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {Object.entries(parsed).map(([k,v])=>{
                const {label,value}=fieldLabel(k,v);
                return(
                  <div key={k} style={{padding:"8px 10px",background:"rgba(255,255,255,0.03)",borderRadius:8}}>
                    <div style={{fontSize:8,color:"rgba(255,255,255,0.3)",fontFamily:mono,textTransform:"uppercase",marginBottom:2}}>{label}</div>
                    <div style={{fontSize:12,fontFamily:mono,fontWeight:600,color:"#fff"}}>{value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!parsed&&text.trim()&&(
          <div style={{marginBottom:18,padding:"12px",background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:10,textAlign:"center"}}>
            <span style={{fontSize:12,fontFamily:sans,color:"#F87171"}}>No se pudo parsear — verifica que el formato sea correcto</span>
          </div>
        )}

        {/* Botones de destino */}
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>parsed&&onConfirm(parsed,"score")} disabled={!parsed}
            style={{flex:1,padding:"14px",background:parsed?"rgba(139,92,246,0.15)":"rgba(255,255,255,0.05)",border:"1px solid "+(parsed?"rgba(139,92,246,0.4)":"rgba(255,255,255,0.08)"),borderRadius:12,color:parsed?"#A78BFA":"rgba(255,255,255,0.2)",fontFamily:sans,fontSize:13,fontWeight:600,cursor:parsed?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
            ◉ Evaluar en Score
          </button>
          <button onClick={()=>parsed&&onConfirm(parsed,"form")} disabled={!parsed}
            style={{flex:1,padding:"14px",background:parsed?"linear-gradient(135deg,#F59E0B,#FCD34D)":"rgba(255,255,255,0.05)",border:"none",borderRadius:12,color:parsed?"#1A1206":"rgba(255,255,255,0.2)",fontFamily:sans,fontSize:13,fontWeight:700,cursor:parsed?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
            ⚡ Registro Rápido
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [trades,setTrades]=useState([]);
  const [deployments,setDeployments]=useState([]);
  const [selectedDep,setSelectedDep]=useState(null);
  const [updatingDep,setUpdatingDep]=useState(null);
  const [closingDep,setClosingDep]=useState(null);
  const [drafts,setDrafts]=useState([]);
  const [view,setView]=useState("splash");
  const [loaded,setLoaded]=useState(false);
  const [darkMode,setDarkMode]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const [showDrawer,setShowDrawer]=useState(false);
  const [editId,setEditId]=useState(null);
  const [fromDraft,setFromDraft]=useState(null);
  const [selected,setSelected]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const [filterBias,setFilterBias]=useState("all");
  const [journalMode,setJournalMode]=useState("calendar");
  const [calDay,setCalDay]=useState(null);
  const [hovPt,setHovPt]=useState(null);
  const [errors,setErrors]=useState({});
  const [scoreAnswers,setScoreAnswers]=useState({});
  const [scoreSt,setScoreSt]=useState("pcs");
  const [scTicker,setScTicker]=useState("");
  const [scSpot,setScSpot]=useState("");
  const [scStrikes,setScStrikes]=useState("");
  const [scStrikeShort,setScStrikeShort]=useState("");
  const [scStrikeLong,setScStrikeLong]=useState("");
  const [scIvr,setScIvr]=useState("");
  const [scExpiry,setScExpiry]=useState("");
  const [scPremium,setScPremium]=useState("");
  const [scContracts,setScContracts]=useState("1");
  const [showQuickCalc,setShowQuickCalc]=useState(false);
  // ── Gestión de Capital ──────────────────────────────────────────────────
  const [capital,setCapital]=useState(null);
  const [showCapital,setShowCapital]=useState(false);
  const [showConstitution,setShowConstitution]=useState(false);
  const [showCapitalSetup,setShowCapitalSetup]=useState(false);
  const [movingCapital,setMovingCapital]=useState(false);
  const [showCapitalHistory,setShowCapitalHistory]=useState(false);
  const [showRiskDetail,setShowRiskDetail]=useState(false);
  const [showExpoDetail,setShowExpoDetail]=useState(false);
  const [showAddStock,setShowAddStock]=useState(false);
  const [closingStock,setClosingStock]=useState(null);
  const [updatingStockId,setUpdatingStockId]=useState(null);
  const [addingSharesId,setAddingSharesId]=useState(null);
  const [restoreMsg,setRestoreMsg]=useState(null);
  const [confirmRestoreFile,setConfirmRestoreFile]=useState(null);
  const [showPasteAI,setShowPasteAI]=useState(false);
  const [calc,setCalc]=useState({strategy:"pcs",ticker:"",spot:"",entryDate:todayStr(),expiry:"",contracts:"1",ivr:"",strikeShort:"",strikeLong:"",premium:"",icPutShort:"",icPutLong:"",icCallShort:"",icCallLong:"",icCredit:""});
  const emptyForm={date:todayStr(),expiry:"",ticker:"",strat:"pcs",pnl:"",pct:"",strikes:"",premium:"",contracts:"1",notes:"",score:"",ivr:"",isHedge:false,affectsCapital:false};
  const [form,setForm]=useState(emptyForm);
  const sf=k=>v=>setForm(f=>({...f,[k]:v}));

  const [syncStatus,setSyncStatus]=useState(cloudOn()?"idle":"off");
  useEffect(()=>{
    const h=e=>setSyncStatus(e.detail);
    window.addEventListener("tl-cloud",h);
    return ()=>window.removeEventListener("tl-cloud",h);
  },[]);

  useEffect(()=>{
    const d=loadData();
    if(d){setTrades(d.trades||[]);setDrafts(d.drafts||[]);setDeployments(d.deployments||[]);if(d.dark!==undefined)setDarkMode(d.dark);if(d.capital)setCapital(d.capital);}
    setLoaded(true);
    // ── Pull de la nube al iniciar (solo si Supabase está configurado) ──────────
    if(cloudOn()){
      (async()=>{
        const cloud=await cloudPull();
        const localTs=(()=>{try{return localStorage.getItem("tl_v1_ts")||"";}catch{return "";}})();
        if(!cloud||!cloud.data){
          // Nada en la nube todavía: sube lo local como semilla
          const local=loadData(); if(local) cloudPush(local); else setSyncStatus("synced");
          return;
        }
        const cloudTs=cloud.updated_at||"";
        if(cloudTs>localTs){
          // La nube es MÁS NUEVA → adoptarla (este dispositivo estaba atrás)
          const cd=cloud.data;
          try{localStorage.setItem("tl_v1",JSON.stringify(cd));localStorage.setItem("tl_v1_ts",cloudTs);}catch{}
          setTrades(cd.trades||[]);setDrafts(cd.drafts||[]);setDeployments(cd.deployments||[]);
          if(cd.dark!==undefined)setDarkMode(cd.dark);setCapital(cd.capital||null);
          setSyncStatus("synced");
        } else if(localTs&&localTs>cloudTs){
          // Lo local es MÁS NUEVO → subirlo
          const local=loadData(); if(local) cloudPush(local);
        } else {
          setSyncStatus("synced");
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const persist=(nt,nd,dm,ndep,ncap)=>{
    saveData({trades:nt,drafts:nd,deployments:ndep!==undefined?ndep:deployments,dark:dm!==undefined?dm:darkMode,capital:ncap!==undefined?ncap:capital});
  };

  const validate=()=>{
    const e={};
    if(!form.ticker.trim())e.ticker="requerido";
    if(form.pnl===""||isNaN(parseFloat(form.pnl)))e.pnl="requerido";
    if(!form.date)e.date="requerido";
    setErrors(e);return Object.keys(e).length===0;
  };

  const submitTrade=()=>{
    if(!validate())return;
    const isNew=!editId;
    const t={...form,id:editId||uid(),ticker:form.ticker.toUpperCase(),pnl:parseFloat(form.pnl)||0,pct:parseFloat(form.pct)||0,score:form.score?parseInt(form.score):null,ivr:form.ivr===""?"":parseFloat(form.ivr),contracts:form.contracts||"1",premium:form.premium||"",isHedge:!!form.isHedge};
    const next=editId?trades.map(x=>x.id===editId?t:x):[t,...trades];
    const nd=fromDraft?drafts.filter(d=>d.id!==fromDraft):drafts;
    // Efecto en capital: solo para trades nuevos con toggle activado
    let nCap=capital;
    if(isNew&&form.affectsCapital&&capital){
      const mov={id:uid(),date:t.date,type:"auto",from:null,to:"operativo",amount:t.pnl,reason:t.ticker+" "+(STRATEGIES[t.strat]?.short||t.strat)+" (manual)",linkedTradeId:t.id};
      nCap={...capital,operativo:(capital.operativo||0)+t.pnl,movements:[mov,...(capital.movements||[])]};
      setCapital(nCap);
    }
    setTrades(next);setDrafts(nd);persist(next,nd,undefined,undefined,nCap);
    setForm(emptyForm);setShowForm(false);setEditId(null);setFromDraft(null);setErrors({});
  };

  const deleteTrade=id=>{
    const next=trades.filter(t=>t.id!==id);
    // Revertir efecto en capital si el trade tenía un movimiento vinculado
    let nCap=capital;
    if(capital){
      const linkedMov=(capital.movements||[]).find(mv=>mv.linkedTradeId===id);
      if(linkedMov){
        nCap={...capital};
        // Solo revertimos el efecto sobre operativo (bucket de efectivo)
        if(linkedMov.to==="operativo")nCap.operativo=(nCap.operativo||0)-linkedMov.amount;
        if(linkedMov.from==="operativo")nCap.operativo=(nCap.operativo||0)+linkedMov.amount;
        nCap.movements=(capital.movements||[]).filter(mv=>mv.id!==linkedMov.id);
        setCapital(nCap);
      }
    }
    setTrades(next);persist(next,drafts,undefined,undefined,nCap);
    setConfirmDel(null);if(selected?.id===id)setSelected(null);
  };

  const importTrades=nw=>{
    const next=[...nw,...trades];setTrades(next);persist(next,drafts);
  };

  // ── Respaldo completo: exporta TODO el estado a JSON ──────────────────────
  const exportBackup=()=>{
    const backup={
      version:"tl_v1",
      exportedAt:new Date().toISOString(),
      data:{trades,drafts,deployments,capital,dark:darkMode}
    };
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    const stamp=todayStr();
    a.href=url;a.download="tradelab-respaldo-"+stamp+".json";
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const restoreBackup=(file)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      try{
        const parsed=JSON.parse(e.target.result);
        const d=parsed.data||parsed; // soporta formato {data:{...}} o estado plano
        const nTrades=d.trades||[];
        const nDrafts=d.drafts||[];
        const nDeps=d.deployments||[];
        const nCap=d.capital!==undefined?d.capital:null;
        setTrades(nTrades);
        setDrafts(nDrafts);
        setDeployments(nDeps);
        setCapital(nCap);
        if(d.dark!==undefined)setDarkMode(d.dark);
        saveData({trades:nTrades,drafts:nDrafts,deployments:nDeps,capital:nCap,dark:d.dark!==undefined?d.dark:darkMode});
        setRestoreMsg({ok:true,text:"Respaldo restaurado: "+nTrades.length+" trades, "+nDeps.length+" despliegues"+(nCap?", capital incluido":"")});
      }catch(err){
        setRestoreMsg({ok:false,text:"Archivo inválido. Verifica que sea un respaldo de TradeLab (.json)"});
      }
    };
    reader.readAsText(file);
  };

  const saveDraft=()=>{
    if(!scTicker)return;
    const sc=SCORECARD[scoreSt]||[];
    const max=sc.reduce((a,c)=>a+c.w*3,0);
    const earned=sc.reduce((a,c)=>{const s=mergedAnswers[scoreSt+"_"+c.id];return s===undefined?a:a+c.opts[s].s*c.w;},0);
    const strikes=scStrikeShort&&scStrikeLong?scStrikeShort+"/"+scStrikeLong:scStrikes;
    const nd=[{id:uid(),ticker:scTicker.toUpperCase(),strat:scoreSt,spot:scSpot,strikes,expiry:scExpiry,ivr:scIvr,premium:scPremium,contracts:scContracts,score:max?Math.round((earned/max)*100):0,createdAt:todayStr()},...drafts];
    setDrafts(nd);persist(trades,nd);
    setScTicker("");setScSpot("");setScStrikes("");setScStrikeShort("");setScStrikeLong("");setScIvr("");setScExpiry("");setScPremium("");setScContracts("1");setScoreAnswers({});
  };

  const deleteDraft=id=>{const nd=drafts.filter(d=>d.id!==id);setDrafts(nd);persist(trades,nd);};

  // ── Despliegues: ejecutar draft del Scorecard como Despliegue Activo ─────
  const [executingDraft,setExecutingDraft]=useState(null); // draft seleccionado para ejecutar
  const [executeForm,setExecuteForm]=useState({credit:"",contracts:"1",entryDelta:"",entryIv:"",entrySpot:"",isHedge:false});

  const startExecuteDraft=d=>{
    setExecutingDraft(d);
    setExecuteForm({credit:d.premium||"",contracts:d.contracts||"1",entryDelta:"",entryIv:d.ivr||"",entrySpot:d.spot||"",isHedge:false});
  };

  const confirmExecuteDraft=()=>{
    if(!executingDraft)return;
    const d=executingDraft;
    const credit=parseFloat(executeForm.credit)||0;
    const contracts=parseInt(executeForm.contracts)||1;
    if(credit<=0)return;
    const newDep={
      id:uid(),
      ticker:d.ticker,
      strat:d.strat,
      isHedge:!!executeForm.isHedge,
      entryDate:todayStr(),
      expiry:d.expiry||"",
      strikes:d.strikes||"",
      initialCredit:credit,
      contracts,
      entrySpot:executeForm.entrySpot||d.spot||"",
      entryDelta:executeForm.entryDelta||"",
      entryIv:executeForm.entryIv||d.ivr||"",
      score:d.score||null,
      currentPrice:"",
      currentSpot:"",
      currentDelta:"",
      currentIv:"",
      lastUpdate:null,
      notes:"",
      createdAt:todayStr()
    };
    const nDeps=[newDep,...deployments];
    const nDrafts=drafts.filter(x=>x.id!==d.id);
    setDeployments(nDeps);
    setDrafts(nDrafts);
    persist(trades,nDrafts,undefined,nDeps);
    setExecutingDraft(null);
    setView("open");
  };

  const updateDeployment=(id,updates)=>{
    const nDeps=deployments.map(d=>d.id===id?{...d,...updates,lastUpdate:new Date().toISOString()}:d);
    setDeployments(nDeps);
    persist(trades,drafts,undefined,nDeps);
  };

  const deleteDeployment=id=>{
    const nDeps=deployments.filter(d=>d.id!==id);
    setDeployments(nDeps);
    persist(trades,drafts,undefined,nDeps);
    if(selectedDep?.id===id)setSelectedDep(null);
  };

  // Cerrar despliegue → mueve a Journal como trade cerrado
  const closeDeployment=(dep,finalPnl,closeDate,finalNotes)=>{
    const pnl=parseFloat(finalPnl)||0;
    const maxProfit=(parseFloat(dep.initialCredit)||0)*100*(parseInt(dep.contracts)||1);
    const pct=maxProfit>0?(pnl/maxProfit)*100:0;
    const newTrade={
      id:uid(),
      date:closeDate||todayStr(),
      expiry:dep.expiry,
      ticker:dep.ticker,
      strat:dep.strat,
      pnl,
      pct,
      strikes:dep.strikes,
      premium:String(dep.initialCredit),
      contracts:String(dep.contracts),
      score:dep.score,
      ivr:dep.entryIv,
      notes:finalNotes||"",
      isHedge:!!dep.isHedge
    };
    const nTrades=[newTrade,...trades];
    const nDeps=deployments.filter(d=>d.id!==dep.id);
    setTrades(nTrades);
    setDeployments(nDeps);

    // Auto-acreditar P&L al Capital Operativo si está configurado
    let nCap=capital;
    if(capital){
      const mov={id:uid(),date:closeDate||todayStr(),type:"auto",from:null,to:"operativo",amount:pnl,
        reason:dep.ticker+" "+(STRATEGIES[dep.strat]?.short||dep.strat)+" cerrado",linkedTradeId:newTrade.id};
      nCap={...capital,operativo:(capital.operativo||0)+pnl,movements:[mov,...(capital.movements||[])]};
      setCapital(nCap);
    }
    persist(nTrades,drafts,undefined,nDeps,nCap);
    setClosingDep(null);
    setSelectedDep(null);
  };

  // ── Funciones de Gestión de Capital ──────────────────────────────────────
  const setupCapital=(operativo,patrimonio,boveda)=>{
    const cap={
      operativo:parseFloat(operativo)||0,
      patrimonioCash:parseFloat(patrimonio)||0, // cash/other no trackeado
      patrimonio:parseFloat(patrimonio)||0,     // legacy field kept for migration
      boveda:parseFloat(boveda)||0,
      stocks:[],
      initial:{
        operativo:parseFloat(operativo)||0,
        patrimonio:parseFloat(patrimonio)||0,
        boveda:parseFloat(boveda)||0,
        setupDate:todayStr()
      },
      movements:[{id:uid(),date:todayStr(),type:"setup",from:null,to:null,amount:0,reason:"Configuración inicial de capital"}]
    };
    setCapital(cap);
    persist(trades,drafts,undefined,undefined,cap);
    setShowCapitalSetup(false);
  };

  const [confirmResetCapital,setConfirmResetCapital]=useState(false);

  const resetCapital=()=>{
    setCapital(null);
    persist(trades,drafts,undefined,undefined,null);
    setShowCapital(false);
    setConfirmResetCapital(false);
  };

  const moveCapital=(from,to,amount,reason)=>{
    const amt=parseFloat(amount)||0;
    if(amt<=0||!capital)return;
    const nCap={...capital};
    if(from!=="externo"&&from)nCap[from]=(nCap[from]||0)-amt;
    if(to!=="externo"&&to)nCap[to]=(nCap[to]||0)+amt;
    const mov={id:uid(),date:todayStr(),type:"manual",from,to,amount:amt,reason:reason||"Movimiento manual"};
    nCap.movements=[mov,...(capital.movements||[])];
    setCapital(nCap);
    persist(trades,drafts,undefined,undefined,nCap);
    setMovingCapital(false);
  };

  // ── Funciones de Acciones (Patrimonio Individual) ────────────────────────
  const addStock=(ticker,shares,entryPrice,currentPrice,source)=>{
    if(!capital)return;
    const sh=parseFloat(shares)||0;
    const ep=parseFloat(entryPrice)||0;
    const cost=sh*ep;
    const stock={id:uid(),ticker:ticker.toUpperCase(),shares:sh,entryPrice:ep,currentPrice:parseFloat(currentPrice)||ep,addedDate:todayStr()};
    const nStocks=[stock,...(capital.stocks||[])];
    const nCap={...capital,stocks:nStocks};
    let mov;
    if(source==="operativo"){
      // Compra nueva: el efectivo sale del operativo
      nCap.operativo=(capital.operativo||0)-cost;
      mov={id:uid(),date:todayStr(),type:"auto",from:"operativo",to:"patrimonio",amount:cost,reason:"Compra "+stock.ticker+" — "+sh+" acc × $"+ep.toFixed(2)};
    } else {
      // Migración: ya estaba contado en patrimonio
      const curCash=capital.patrimonioCash!==undefined?capital.patrimonioCash:(capital.patrimonio||0);
      nCap.patrimonioCash=Math.max(0,curCash-(sh*(stock.currentPrice)));
      mov={id:uid(),date:todayStr(),type:"manual",from:null,to:null,amount:0,reason:stock.ticker+" migrado a posición trackeada"};
    }
    nCap.movements=[mov,...(capital.movements||[])];
    setCapital(nCap);
    persist(trades,drafts,undefined,undefined,nCap);
    setShowAddStock(false);
  };

  const addSharesToPosition=(stockId,addShares,addPrice,source)=>{
    if(!capital)return;
    const sh=parseFloat(addShares)||0;
    const pr=parseFloat(addPrice)||0;
    if(sh<=0||pr<=0)return;
    const cost=sh*pr;
    const target=(capital.stocks||[]).find(s=>s.id===stockId);
    if(!target)return;
    const nStocks=(capital.stocks||[]).map(s=>{
      if(s.id!==stockId)return s;
      const totalShares=s.shares+sh;
      const newAvg=totalShares>0?((s.shares*s.entryPrice)+(sh*pr))/totalShares:s.entryPrice;
      return {...s,shares:totalShares,entryPrice:newAvg};
    });
    const nCap={...capital,stocks:nStocks};
    let mov;
    if(source==="operativo"){
      nCap.operativo=(capital.operativo||0)-cost;
      mov={id:uid(),date:todayStr(),type:"auto",from:"operativo",to:"patrimonio",amount:cost,reason:"+"+sh+" acc "+target.ticker+" × $"+pr.toFixed(2)};
    } else {
      const curCash=capital.patrimonioCash!==undefined?capital.patrimonioCash:(capital.patrimonio||0);
      nCap.patrimonioCash=Math.max(0,curCash-cost);
      mov={id:uid(),date:todayStr(),type:"manual",from:null,to:null,amount:0,reason:"+"+sh+" acc "+target.ticker+" migradas"};
    }
    nCap.movements=[mov,...(capital.movements||[])];
    setCapital(nCap);
    persist(trades,drafts,undefined,undefined,nCap);
    setAddingSharesId(null);
  };

  const updateStockPrice=(id,newPrice)=>{
    if(!capital)return;
    const nStocks=(capital.stocks||[]).map(s=>s.id===id?{...s,currentPrice:parseFloat(newPrice)||s.currentPrice}:s);
    const nCap={...capital,stocks:nStocks};
    setCapital(nCap);
    persist(trades,drafts,undefined,undefined,nCap);
    setUpdatingStockId(null);
  };

  const closeStockPosition=(stock,salePrice,notes)=>{
    if(!capital)return;
    const sp=parseFloat(salePrice)||stock.currentPrice;
    const totalCash=sp*stock.shares;
    const gainLoss=(sp-stock.entryPrice)*stock.shares;
    const pct=stock.entryPrice>0?((sp-stock.entryPrice)/stock.entryPrice)*100:0;
    const newTrade={id:uid(),date:todayStr(),expiry:"",ticker:stock.ticker,strat:"pat",pnl:gainLoss,pct,strikes:"",premium:String(stock.entryPrice),contracts:String(stock.shares),notes:notes||"",score:null,ivr:"",isHedge:false,isPatrimony:true};
    const nTrades=[newTrade,...trades];
    const nStocks=(capital.stocks||[]).filter(s=>s.id!==stock.id);
    const mov={id:uid(),date:todayStr(),type:"auto",from:"patrimonio",to:"operativo",amount:totalCash,reason:stock.ticker+" cerrado — "+stock.shares+" acc × $"+sp.toFixed(2),linkedTradeId:newTrade.id};
    const nCap={...capital,operativo:(capital.operativo||0)+totalCash,stocks:nStocks,movements:[mov,...(capital.movements||[])]};
    setTrades(nTrades);
    setCapital(nCap);
    persist(nTrades,drafts,undefined,undefined,nCap);
    setClosingStock(null);
  };

  const executeDraft=d=>{
    // Nuevo flujo: abrir modal de ejecución como Despliegue
    startExecuteDraft(d);
  };

  const openEdit=t=>{
    setForm({date:t.date,expiry:t.expiry||"",ticker:t.ticker,strat:t.strat,pnl:String(t.pnl),pct:String(t.pct||0),strikes:t.strikes||"",premium:String(t.premium||""),contracts:String(t.contracts||"1"),notes:t.notes||"",score:t.score?String(t.score):"",ivr:(t.ivr!==null&&t.ivr!=="")?""+t.ivr:"",isHedge:!!t.isHedge,affectsCapital:false});
    setEditId(t.id);setShowForm(true);
  };

  const closeForm=()=>{setShowForm(false);setEditId(null);setFromDraft(null);setForm(emptyForm);setErrors({});};
  const toggleDark=()=>{const dm=!darkMode;setDarkMode(dm);persist(trades,drafts,dm);};

  // ── Paste from AI handler ────────────────────────────────────────────────
  const handlePasteAI=(parsed,dest)=>{
    if(dest==="score"){
      if(parsed.ticker)setScTicker(parsed.ticker);
      if(parsed.spot)setScSpot(parsed.spot);
      if(parsed.strikes){
        const pts=parsed.strikes.split("/");
        if(pts[0])setScStrikeShort(pts[0].trim());
        if(pts[1])setScStrikeLong(pts[1].trim());
        setScStrikes(parsed.strikes);
      }
      if(parsed.ivr)setScIvr(parsed.ivr);
      if(parsed.expiry)setScExpiry(parsed.expiry);
      if(parsed.premium)setScPremium(parsed.premium);
      if(parsed.contracts)setScContracts(parsed.contracts);
      if(parsed.strat){setScoreSt(parsed.strat);setScoreAnswers({});}
      setView("scorecard");
    } else {
      closeForm();
      setForm(f=>({...f,
        ticker:parsed.ticker||f.ticker,
        strat:parsed.strat||f.strat,
        strikes:parsed.strikes||f.strikes,
        premium:parsed.premium||f.premium,
        contracts:parsed.contracts||f.contracts,
        expiry:parsed.expiry||f.expiry,
        ivr:parsed.ivr||f.ivr,
        notes:parsed.notes||f.notes,
      }));
      setShowForm(true);
      setView("trades");
    }
    setShowPasteAI(false);
  };

  const m=useMemo(()=>calcMetrics(trades),[trades]);
  // ── P&L del mes en curso (se reinicia automáticamente cada 1 de mes) ─────
  const monthly=useMemo(()=>{
    const now=new Date();
    const yStr=now.getFullYear().toString();
    const moStr=String(now.getMonth()+1).padStart(2,'0');
    const prefix=yStr+'-'+moStr; // ej: "2026-06"
    const mt=trades.filter(t=>t.date&&t.date.startsWith(prefix));
    const pnl=mt.reduce((a,t)=>a+t.pnl,0);
    const wins=mt.filter(t=>t.pnl>0).length;
    return{pnl,n:mt.length,wins,monthLabel:now.toLocaleDateString("es-MX",{month:"long",year:"numeric"})};
  },[trades]);
  const sysIns=useMemo(()=>buildInsights(trades),[trades]);

  // ── Análisis de despliegues activos ────────────────────────────────────────
  const depAnalyses=useMemo(()=>{
    return deployments.map(d=>({dep:d,analysis:analyzeDeployment(d)}));
  },[deployments]);

  const depAlertCount=useMemo(()=>{
    return depAnalyses.filter(({analysis})=>analysis.directive&&(analysis.directive.key==="alert"||analysis.directive.key==="accelerate"||analysis.directive.key==="extract")).length;
  },[depAnalyses]);

  const depCapitalAtRisk=useMemo(()=>{
    return depAnalyses.reduce((a,{analysis})=>a+(analysis.capitalAtRisk||0),0);
  },[depAnalyses]);

  const depUnrealized=useMemo(()=>{
    return depAnalyses.reduce((a,{analysis})=>a+(analysis.unrealizedPnl||0),0);
  },[depAnalyses]);

  // ── Métricas de Capital ──────────────────────────────────────────────────
  const capitalMetrics=useMemo(()=>{
    if(!capital)return null;
    // Capital desplegado = suma del max loss de despliegues abiertos (no coberturas)
    const deployed=deployments.reduce((a,d)=>{
      const credit=parseFloat(d.initialCredit)||0;
      const contracts=parseInt(d.contracts)||1;
      // Estimar max loss desde strikes si están disponibles
      let width=0;
      if(d.strikes&&d.strikes.includes("/")){
        const parts=d.strikes.split("/").map(x=>parseFloat(x));
        if(parts.length>=2&&!isNaN(parts[0])&&!isNaN(parts[1]))width=Math.abs(parts[0]-parts[1]);
      }
      const isCredit=d.strat==="pcs"||d.strat==="ccs"||d.strat==="ic"||d.strat==="ib";
      const maxLoss=isCredit?(width-credit)*100*contracts:credit*100*contracts;
      return a+(maxLoss>0?maxLoss:0);
    },0);
    const operativo=capital.operativo||0;
    const available=operativo-deployed;
    // Patrimonio = acciones individuales + cash no trackeado
    const stocks=capital.stocks||[];
    const stocksValue=stocks.reduce((a,s)=>a+(s.shares||0)*(s.currentPrice||0),0);
    // Migration: si no hay patrimonioCash definido, usar capital.patrimonio como fallback
    const patrimonioCash=capital.patrimonioCash!==undefined?capital.patrimonioCash:(capital.patrimonio||0);
    const patrimonio=patrimonioCash+stocksValue;
    const boveda=capital.boveda||0;
    const total=operativo+patrimonio+boveda;
    const init=capital.initial||{};
    const initTotal=(init.operativo||0)+(init.patrimonio||0)+(init.boveda||0);
    const growthTotal=total-initTotal;
    const growthTotalPct=initTotal>0?(growthTotal/initTotal)*100:0;
    const opGrowth=operativo-(init.operativo||0);
    const opGrowthPct=(init.operativo||0)>0?(opGrowth/(init.operativo||0))*100:0;
    const patGrowth=patrimonio-(init.patrimonio||0);
    const patGrowthPct=(init.patrimonio||0)>0?(patGrowth/(init.patrimonio||0))*100:0;
    return{operativo,deployed,available,patrimonioCash,stocks,stocksValue,patrimonio,boveda,total,initTotal,growthTotal,growthTotalPct,opGrowth,opGrowthPct,patGrowth,patGrowthPct,setupDate:init.setupDate};
  },[capital,deployments]);

  // ── Riesgo de estructura: delta agregada, exposición β-ajustada, sectores ──
  const riskMetrics=useMemo(()=>{
    if(!capital)return null;
    const items=[];
    // Spreads abiertos
    (deployments||[]).forEach(dep=>{
      const sign=DELTA_SIGN[dep.strat]??0;
      if(sign===0)return; // neutrales (IC/IB) no aportan delta direccional neta
      const spot=parseFloat(dep.currentSpot||dep.entrySpot)||0;
      if(!spot)return;
      const contracts=parseFloat(dep.contracts)||1;
      const md=parseFloat(dep.currentDelta);
      const perShare=(!isNaN(md)&&md>0)?md:estPerShareDelta(dep.strikes,spot);
      const delta=sign*perShare*100*contracts;
      const beta=BETA_TABLE[dep.ticker]??DEFAULT_BETA;
      const expo=delta*spot*beta*0.01; // $ por 1% de SPY
      // Theta estimada: crédito (+) cobra decaimiento, débito (−) lo paga
      const stype=(STRATEGIES[dep.strat]||{}).type;
      const tSign=stype==="credit"?1:stype==="debit"?-1:0;
      const prem=parseFloat(dep.currentPrice)||parseFloat(dep.initialCredit)||0;
      const dte=Math.max(1,Math.ceil((new Date(dep.expiry)-new Date())/86400000));
      const theta=tSign*prem*100*contracts/dte;
      items.push({ticker:dep.ticker,kind:(dep.strat||"").toUpperCase(),delta,beta,expo,theta,sector:SECTOR_TABLE[dep.ticker]||DEFAULT_SECTOR});
    });
    // Acciones (patrimonio)
    (capital.stocks||[]).forEach(s=>{
      const shares=parseFloat(s.shares)||0;
      const price=parseFloat(s.currentPrice)||0;
      if(!shares||!price)return;
      const beta=BETA_TABLE[s.ticker]??DEFAULT_BETA;
      const expo=shares*price*beta*0.01;
      items.push({ticker:s.ticker,kind:"ACC",delta:shares,beta,expo,theta:0,sector:SECTOR_TABLE[s.ticker]||DEFAULT_SECTOR});
    });
    const rawDelta=items.reduce((a,i)=>a+i.delta,0);
    const totalExpo=items.reduce((a,i)=>a+i.expo,0);
    const totalTheta=items.reduce((a,i)=>a+(i.theta||0),0);
    const longExpo=items.filter(i=>i.expo>0).reduce((a,i)=>a+i.expo,0);
    const shortExpo=items.filter(i=>i.expo<0).reduce((a,i)=>a+Math.abs(i.expo),0);
    const grossExpo=longExpo+shortExpo;
    const bullPct=grossExpo>0?longExpo/grossExpo*100:50;
    const sectorMap={};
    items.forEach(i=>{sectorMap[i.sector]=(sectorMap[i.sector]||0)+Math.abs(i.expo);});
    const sectors=Object.entries(sectorMap).map(([k,v])=>({sector:k,expo:v,pct:grossExpo>0?v/grossExpo*100:0})).sort((a,b)=>b.expo-a.expo);
    const nameMap={};
    items.forEach(i=>{nameMap[i.ticker]=(nameMap[i.ticker]||0)+Math.abs(i.expo);});
    const names=Object.entries(nameMap).map(([k,v])=>({ticker:k,expo:v,pct:grossExpo>0?v/grossExpo*100:0})).sort((a,b)=>b.expo-a.expo);
    const total=capitalMetrics?capitalMetrics.total:0;
    const expoPctTotal=total>0?Math.abs(totalExpo)/total*100:0;
    let light="#4ADE80",lightTxt="Equilibrado";
    if(expoPctTotal>2.5||bullPct>=95||bullPct<=5){light="#FCD34D";lightTxt="Vigilar";}
    if(expoPctTotal>4&&(bullPct>=90||bullPct<=10)){light="#F87171";lightTxt="Sobre-expuesto";}
    return{items,rawDelta,totalExpo,totalTheta,longExpo,shortExpo,bullPct,sectors,names,total,expoPctTotal,light,lightTxt};
  },[capital,deployments,capitalMetrics]);

  // ── Snapshot diario al abrir Gestión de Capital (alimenta los históricos) ──
  useEffect(()=>{
    if(!showCapital||!capital||!capitalMetrics)return;
    const today=new Date().toISOString().slice(0,10);
    const snaps=capital.snapshots||[];
    if(snaps.length&&snaps[snaps.length-1].date===today)return;
    const snap={
      date:today,
      op:Math.round(capitalMetrics.operativo),
      pat:Math.round(capitalMetrics.patrimonio),
      bov:Math.round(capitalMetrics.boveda),
      total:Math.round(capitalMetrics.total),
      rawDelta:riskMetrics?Math.round(riskMetrics.rawDelta):0,
      expo:riskMetrics?Math.round(riskMetrics.totalExpo):0,
    };
    const newSnaps=[...snaps.filter(s=>s.date!==today),snap].slice(-60);
    const nCap={...capital,snapshots:newSnaps};
    setCapital(nCap);
    saveData({trades,drafts,deployments,capital:nCap,dark:darkMode});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[showCapital]);

  const scoreCrit=SCORECARD[scoreSt]||[];

  // ── Auto-respuestas calculadas desde spot / strikes / expiry / ivr ──────────
  const autoAnswers=useMemo(()=>{
    const auto={};
    const spot=parseFloat(scSpot);
    const expiry=scExpiry;
    const dte=expiry?dteDays(todayStr(),expiry):null;
    const ivrN=scIvr===""?null:parseFloat(scIvr);

    // Parse short strike — acepta "590/587" o un número solo
    const parseShort=()=>{
      if(scStrikeShort) return parseFloat(scStrikeShort);
      if(scStrikes){
        const parts=scStrikes.split("/");
        return parseFloat(parts[0]);
      }
      return null;
    };
    const parseLong=()=>{
      if(scStrikeLong) return parseFloat(scStrikeLong);
      if(scStrikes){
        const parts=scStrikes.split("/");
        return parts.length>1?parseFloat(parts[1]):null;
      }
      return null;
    };
    const shortStrike=parseShort();
    const longStrike=parseLong();

    // ── DTE — lógica diferente por estrategia ────────────────────────────────
    if(dte!==null){
      const k=scoreSt+"_dte";
      if(scoreSt==="pcs"||scoreSt==="ccs"){
        // Credit spreads cortos: theta decay óptimo 7–21d
        auto[k]=dte>=7&&dte<=21?0:dte>=21&&dte<=45?1:2;
      } else if(scoreSt==="bcs"||scoreSt==="pds"){
        // Debit spreads direccionales: necesitan tiempo para moverse
        auto[k]=dte>=21&&dte<=45?0:dte>=14&&dte<21?1:2;
      } else if(scoreSt==="ic"){
        auto[k]=dte>=30&&dte<=45?0:dte>=15&&dte<30?1:2;
      } else if(scoreSt==="ib"){
        auto[k]=dte>=7&&dte<=14?0:dte>14&&dte<=21?1:2;
      }
    }

    // ── IVR — lógica opuesta para crédito vs débito ───────────────────────────
    if(ivrN!==null&&!isNaN(ivrN)){
      const k=scoreSt+"_ivr";
      if(scoreSt==="pcs"||scoreSt==="ccs"){
        // Vendemos: queremos IVR alto
        auto[k]=ivrN>50?0:ivrN>=35?1:2;
      } else if(scoreSt==="bcs"||scoreSt==="pds"){
        // Compramos: IVR bajo ayuda, pero el edge REAL es IV<HV (criterio aparte)
        auto[k]=ivrN<25?0:ivrN<=50?1:2;
      } else if(scoreSt==="ic"){
        auto[k]=ivrN>60?0:ivrN>=40?1:2;
      } else if(scoreSt==="ib"){
        auto[k]=ivrN>70?0:ivrN>=50?1:2;
      }
    }

    // ── Distancia Strike vs Precio — lógica OPUESTA crédito vs débito ─────────
    if(spot&&shortStrike){
      const distPct=Math.abs((shortStrike-spot)/spot)*100;

      if(scoreSt==="pcs"){
        // Strike por DEBAJO del precio. Más lejos = más seguro = mejor score
        const isBelow=shortStrike<spot;
        if(isBelow) auto[scoreSt+"_dist"]=distPct>3?0:distPct>=2?1:2;
      }
      if(scoreSt==="ccs"){
        // Strike por ENCIMA del precio. Más lejos = más seguro = mejor score
        const isAbove=shortStrike>spot;
        if(isAbove) auto[scoreSt+"_dist"]=distPct>3?0:distPct>=2?1:2;
      }
      if(scoreSt==="bcs"){
        // Strike comprado CERCA del precio. Más cerca = más probable llegar = mejor score
        auto[scoreSt+"_dist"]=distPct<1?0:distPct<=2.5?1:2;
      }
      if(scoreSt==="pds"){
        // Strike comprado CERCA del precio (put). Más cerca = mejor score
        auto[scoreSt+"_dist"]=distPct<1?0:distPct<=2.5?1:2;
      }
      if(scoreSt==="ib"){
        // Strike ATM exacto. Mínima distancia = mejor score
        auto[scoreSt+"_dist"]=distPct<=0.5?0:distPct<=1?1:2;
      }
    }

    // ── IC: distancia de ambos strikes (short put y short call) ───────────────
    if(scoreSt==="ic"&&spot&&shortStrike&&longStrike){
      const putDist=Math.abs((shortStrike-spot)/spot)*100; // short put abajo
      const callDist=Math.abs((longStrike-spot)/spot)*100; // short call arriba
      const minDist=Math.min(putDist,callDist);
      auto[scoreSt+"_dist"]=minDist>3?0:minDist>=1.5?1:2;
    }

    // ── R/R y Premium Quality (necesitan premium + width) ────────────────────
    const premium = parseFloat(scPremium) || 0;
    const width = (shortStrike!==null && longStrike!==null) ? Math.abs(shortStrike - longStrike) : null;

    if(premium > 0 && width !== null && width > 0){
      const isCredit = scoreSt==="pcs"||scoreSt==="ccs"||scoreSt==="ic"||scoreSt==="ib";
      const isDebit = scoreSt==="bcs"||scoreSt==="pds";

      if(isCredit){
        // Para credit spreads: max_profit = premium, max_loss = width - premium
        const maxProfit = premium;
        const maxLoss = width - premium;
        const rr = maxLoss > 0 ? maxProfit/maxLoss : null;
        if(rr !== null){
          // Mejores opciones = índice menor (s:3 primero)
          // ≥ 0.5 → 0 (s:3) | 0.33–0.5 → 1 (s:2) | 0.20–0.33 → 2 (s:1) | < 0.20 → 3 (s:0)
          auto[scoreSt+"_rr"] = rr >= 0.5 ? 0 : rr >= 0.33 ? 1 : rr >= 0.20 ? 2 : 3;
        }
        // Premium Quality = premium / width × 100
        const premPct = (premium / width) * 100;
        // ≥ 33% → 0 | 25-33% → 1 | 15-25% → 2 | < 15% → 3
        auto[scoreSt+"_prem"] = premPct >= 33 ? 0 : premPct >= 25 ? 1 : premPct >= 15 ? 2 : 3;
      }

      if(isDebit){
        // Para debit spreads: max_profit = width - debit, max_loss = debit
        const maxProfit = width - premium;
        const maxLoss = premium;
        const rr = maxLoss > 0 ? maxProfit/maxLoss : null;
        if(rr !== null){
          // ≥ 2.0 → 0 | 1.0–2.0 → 1 | 0.5–1.0 → 2 | < 0.5 → 3
          auto[scoreSt+"_rr"] = rr >= 2.0 ? 0 : rr >= 1.0 ? 1 : rr >= 0.5 ? 2 : 3;
        }
        // Costo del débito = debit / width × 100 (menos es mejor)
        const debitPct = (premium / width) * 100;
        // < 33% → 0 | 33-50% → 1 | 50-67% → 2 | > 67% → 3
        auto[scoreSt+"_prem"] = debitPct < 33 ? 0 : debitPct < 50 ? 1 : debitPct < 67 ? 2 : 3;
      }
    }

    return auto;
  },[scSpot,scStrikes,scStrikeShort,scStrikeLong,scIvr,scExpiry,scPremium,scoreSt]);

  // Merge: manual answers override auto
  const mergedAnswers=useMemo(()=>({...autoAnswers,...scoreAnswers}),[autoAnswers,scoreAnswers]);

  // ── Setup Numbers: matemática del setup (max profit, max loss, BE, R/R) ───
  const setupNumbers=useMemo(()=>{
    const premium=parseFloat(scPremium)||0;
    const contracts=parseInt(scContracts)||1;
    const spot=parseFloat(scSpot)||0;
    const ss=parseFloat(scStrikeShort)||0;
    const sl=parseFloat(scStrikeLong)||0;
    const width=(ss>0&&sl>0)?Math.abs(ss-sl):0;
    const dte=scExpiry?dteDays(todayStr(),scExpiry):null;
    const isCredit=scoreSt==="pcs"||scoreSt==="ccs"||scoreSt==="ic"||scoreSt==="ib";
    const isDebit=scoreSt==="bcs"||scoreSt==="pds";

    if(!premium||!width)return{ready:false};

    let maxProfit=0,maxLoss=0,breakeven=null;
    if(isCredit){
      maxProfit=premium*100*contracts;
      maxLoss=(width-premium)*100*contracts;
      // BE para PCS = short - credit, para CCS = short + credit
      if(scoreSt==="pcs") breakeven=ss-premium;
      else if(scoreSt==="ccs") breakeven=ss+premium;
      else if(scoreSt==="ib") breakeven=ss; // strike central
    } else if(isDebit){
      maxProfit=(width-premium)*100*contracts;
      maxLoss=premium*100*contracts;
      // BE para BCS = long + debit, para PDS = long - debit
      if(scoreSt==="bcs") breakeven=ss+premium;
      else if(scoreSt==="pds") breakeven=ss-premium;
    }

    const rr=maxLoss>0?maxProfit/maxLoss:null;
    const premQuality=width>0?(premium/width)*100:null;

    // Velocidad del Dinero — TP sugerido según DTE
    const tpPct=dte!==null?(dte<5?30:dte<15?40:50):50;
    const tpAmount=maxProfit*(tpPct/100);

    // Termómetro RoR (return on risk = max_profit / max_loss × 100)
    const ror=maxLoss>0?(maxProfit/maxLoss)*100:null;

    // Foso Defensivo — % que el spot necesita moverse para tocar breakeven
    let beDistance=null,beDirection=null;
    if(spot>0&&breakeven){
      beDistance=Math.abs((breakeven-spot)/spot)*100;
      if(scoreSt==="pcs"||scoreSt==="pds") beDirection="caída";
      else if(scoreSt==="ccs"||scoreSt==="bcs") beDirection="subida";
      else beDirection="movimiento";
    }

    return{ready:true,maxProfit,maxLoss,breakeven,rr,premQuality,tpPct,tpAmount,ror,beDistance,beDirection,dte,isCredit,isDebit,width};
  },[scPremium,scContracts,scSpot,scStrikeShort,scStrikeLong,scExpiry,scoreSt]);

  const scoreRes=useMemo(()=>{
    const max=scoreCrit.reduce((a,c)=>a+c.w*3,0);
    const earned=scoreCrit.reduce((a,c)=>{const s=mergedAnswers[scoreSt+"_"+c.id];return s===undefined?a:a+c.opts[s].s*c.w;},0);
    const answered=scoreCrit.filter(c=>mergedAnswers[scoreSt+"_"+c.id]!==undefined).length;
    return{earned,max,pct:max?Math.round((earned/max)*100):0,answered,total:scoreCrit.length,complete:answered===scoreCrit.length};
  },[mergedAnswers,scoreSt,scoreCrit]);

  const calcRes=useMemo(()=>{
    const sd=STRATEGIES[calc.strategy];if(!sd)return null;
    const c=parseInt(calc.contracts)||1;
    const dte=(calc.entryDate&&calc.expiry)?dteDays(calc.entryDate,calc.expiry):null;
    const ivrN=calc.ivr===""?null:parseFloat(calc.ivr);
    let fit=null;
    if(ivrN!==null&&!isNaN(ivrN)){const v=sd.type==="credit"?ivrN:100-ivrN;fit=v>=70?5:v>=50?4:v>=35?3:v>=20?2:1;}
    const isIC=calc.strategy==="ic"||calc.strategy==="ib";
    if(isIC){
      const ps=parseFloat(calc.icPutShort),pl=parseFloat(calc.icPutLong),cs=parseFloat(calc.icCallShort),cl=parseFloat(calc.icCallLong),cr=parseFloat(calc.icCredit);
      if(!ps||!pl||!cs||!cl||!cr)return{dte,fit,partial:true};
      const mW=Math.max(Math.abs(ps-pl),Math.abs(cs-cl));
      return{dte,fit,maxProfit:cr*100*c,maxLoss:(mW-cr)*100*c,beLow:ps-cr,beHigh:cs+cr,rr:(cr*100*c)/((mW-cr)*100*c),isCredit:true};
    }
    const s=parseFloat(calc.strikeShort),l=parseFloat(calc.strikeLong),p=parseFloat(calc.premium);
    if(!s||!l||!p)return{dte,fit,partial:true};
    const sp=Math.abs(s-l);if(sp<=0)return{dte,fit,partial:true};
    const cr=sd.type==="credit";
    const mP=cr?p*100*c:(sp-p)*100*c,mL=cr?(sp-p)*100*c:p*100*c;
    const be=(calc.strategy==="pcs"||calc.strategy==="pds")?s-p:s+p;
    // ── Velocidad del Dinero: TP sugerido por DTE ─────────────────────────────
    const tpPct=dte!==null?(dte<5?35:dte<15?40:50):50;
    const tpAmt=mP*(tpPct/100);
    // ── RoR: Retorno sobre Riesgo ─────────────────────────────────────────────
    const margin=(sp-p)*100*c; // capital en riesgo (margen retenido)
    const ror=margin>0?(p*100*c/margin)*100:null;
    // ── Foso Defensivo: distancia % al breakeven ──────────────────────────────
    const spot=parseFloat(calc.spot);
    const bePct=(spot&&be)?Math.abs((be-spot)/spot)*100:null;
    const beDir=(calc.strategy==="pcs"||calc.strategy==="ic"||calc.strategy==="ib")?"caída":"subida";
    return{dte,fit,maxProfit:mP,maxLoss:mL,breakeven:be,rr:mL>0?mP/mL:0,isCredit:cr,tpPct,tpAmt,ror,bePct,beDir};
  },[calc]);

  const filtTrades=filterBias==="all"?trades:trades.filter(t=>BIAS_MAP[filterBias]?.ids.includes(t.strat));

  const bg=darkMode?"#080B12":"#F0F2F5";
  const textPrimary=darkMode?"#fff":"#0f172a";
  const textSec=darkMode?"rgba(255,255,255,0.35)":"rgba(15,23,42,0.45)";
  const borderClr=darkMode?"rgba(255,255,255,0.08)":"rgba(15,23,42,0.1)";
  const surfBg=darkMode?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.8)";
  const cardBg=darkMode?"rgba(14,20,32,0.9)":"rgba(255,255,255,0.95)";

  const SectionTitle=({title,sub})=>(
    <div style={{marginBottom:8}}>
      <h1 style={{fontSize:34,fontWeight:900,color:textPrimary,fontFamily:sans,letterSpacing:"-0.04em",lineHeight:1}}>{title}</h1>
      {sub&&<p style={{fontSize:12,color:textSec,fontFamily:sans,marginTop:5}}>{sub}</p>}
    </div>
  );

  const KPI=({label,value,sub,color,icon})=>(
    <div style={{background:surfBg,border:"1px solid "+borderClr,borderRadius:16,padding:"16px 18px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
        <span style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.14em",textTransform:"uppercase"}}>{label}</span>
        {icon&&<span style={{fontSize:14,opacity:0.4}}>{icon}</span>}
      </div>
      <div style={{fontSize:20,fontWeight:700,color:color||"#fff",fontFamily:mono,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:textSec,fontFamily:mono,marginTop:5}}>{sub}</div>}
    </div>
  );

  const SC=({label,value,color})=>(
    <div style={{background:darkMode?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.7)",border:"1px solid "+borderClr,borderRadius:12,padding:"14px 16px",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:color||"rgba(255,255,255,0.2)",opacity:0.5}}/>
      <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:5}}>{label}</div>
      <div style={{fontFamily:mono,fontSize:17,fontWeight:700,color:color||textPrimary,lineHeight:1}}>{value}</div>
    </div>
  );

  if(!loaded)return(
    <div style={{minHeight:"100vh",background:"#080B12",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div style={{width:32,height:32,border:"2px solid "+GOLD+"30",borderTop:"2px solid "+GOLD,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      <span style={{color:"rgba(255,255,255,0.2)",fontFamily:mono,fontSize:11}}>cargando...</span>
    </div>
  );

  if(view==="splash")return(
    <div style={{minHeight:"100vh",background:"#080B12",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden",position:"relative",padding:"0 24px"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;600&family=DM+Sans:wght@300;400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
      <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 70% 50% at 50% 35%,rgba(245,158,11,0.2) 0%,transparent 65%)",pointerEvents:"none"}}/>
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0.035}} xmlns="http://www.w3.org/2000/svg">
        <defs><pattern id="g" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M 56 0 L 0 0 0 56" fill="none" stroke="white" strokeWidth="0.5"/></pattern></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>
      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",animation:"fadeUp 0.7s ease both"}}>
        <div style={{width:96,height:96,borderRadius:26,background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 60px "+GOLD+"55,0 0 120px "+GOLD+"20,0 8px 32px rgba(0,0,0,0.5)",marginBottom:28}}>
          <span style={{fontSize:46}}>📈</span>
        </div>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:60,fontWeight:900,letterSpacing:"-0.05em",color:"#fff",lineHeight:1,marginBottom:10,textAlign:"center"}}>
          Trade<span style={{color:GOLD}}>Log</span>
        </div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(255,255,255,0.3)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:48,textAlign:"center"}}>
          Options · Spreads · Edge
        </div>
        {trades.length>0&&(
          <div style={{display:"flex",gap:0,marginBottom:44,border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,overflow:"hidden",background:"rgba(255,255,255,0.03)"}}>
            {[
              {label:"Trades",value:String(trades.length)},
              {label:"Win Rate",value:m.n?(m.wr*100).toFixed(0)+"%":"—"},
              {label:"P&L",value:(m.pnl>=0?"+":"")+"$"+m.pnl.toFixed(0),color:m.pnl>=0?GOLD:"#F87171"},
            ].map((s,i)=>(
              <div key={i} style={{padding:"16px 24px",borderLeft:i>0?"1px solid rgba(255,255,255,0.07)":"none",textAlign:"center"}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:20,fontWeight:700,color:s.color||"#fff",lineHeight:1,marginBottom:4}}>{s.value}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:"0.14em",textTransform:"uppercase"}}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
        <button onClick={()=>setView("dashboard")}
          style={{background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",border:"none",borderRadius:16,padding:"17px 52px",color:"#000",fontFamily:"'DM Sans',sans-serif",fontSize:16,fontWeight:800,letterSpacing:"-0.01em",cursor:"pointer",boxShadow:"0 4px 28px "+GOLD+"55",WebkitTapHighlightColor:"transparent"}}>
          {trades.length>0?"Abrir Terminal →":"Comenzar →"}
        </button>
        <div style={{marginTop:16,fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(255,255,255,0.15)",letterSpacing:"0.1em"}}>
          {new Date().toLocaleDateString("es-MX",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
        </div>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:bg,color:textPrimary,transition:"background 0.3s"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;600&family=DM+Sans:wght@300;400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:4px;}
        button{cursor:pointer;font-family:'DM Sans',sans-serif;}
        input,textarea,select{color-scheme:dark;font-size:16px!important;}
        input[type=date]::-webkit-calendar-picker-indicator{opacity:0.4;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {darkMode&&<div style={{position:"fixed",top:0,left:0,right:0,height:"50vh",background:"radial-gradient(ellipse 80% 50% at 50% -10%,"+GOLD+"10 0%,transparent 70%)",pointerEvents:"none",zIndex:0}}/>}

      <div style={{position:"sticky",top:0,zIndex:40,background:darkMode?"rgba(8,11,18,0.92)":"rgba(240,242,245,0.95)",backdropFilter:"blur(24px)",borderBottom:"1px solid "+borderClr,height:56,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px"}}>
        <button onClick={()=>setShowDrawer(true)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid "+borderClr,borderRadius:10,width:40,height:40,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,cursor:"pointer",flexShrink:0,WebkitTapHighlightColor:"transparent"}}>
          <div style={{width:18,height:2,background:textPrimary,borderRadius:1}}/>
          <div style={{width:18,height:2,background:textPrimary,borderRadius:1}}/>
          <div style={{width:12,height:2,background:textPrimary,borderRadius:1}}/>
        </button>
        <div style={{display:"flex",alignItems:"center",gap:9,cursor:"pointer"}} onClick={()=>setView("splash")}>
          <div style={{width:32,height:32,borderRadius:9,background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 14px "+GOLD+"50"}}>
            <span style={{fontSize:16}}>📈</span>
          </div>
          <span style={{fontFamily:sans,fontWeight:800,fontSize:17,letterSpacing:"-0.03em",color:textPrimary}}>TradeLog</span>
          {syncStatus!=="off"&&(
            <span title={"Sync: "+syncStatus} style={{width:7,height:7,borderRadius:"50%",flexShrink:0,alignSelf:"center",
              background: syncStatus==="synced"?"#4ADE80":syncStatus==="syncing"?GOLD:syncStatus==="idle"?"#64748B":"#F87171",
              boxShadow: syncStatus==="synced"?"0 0 6px #4ADE80aa":syncStatus==="syncing"?"0 0 6px "+GOLD+"aa":"none",
              transition:"background 0.3s"}}/>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={()=>setShowPasteAI(true)} style={{background:"rgba(56,189,248,0.1)",border:"1px solid rgba(56,189,248,0.3)",borderRadius:11,padding:"9px 13px",color:"#38BDF8",fontSize:13,fontWeight:700,WebkitTapHighlightColor:"transparent"}} title="Importar desde IA">📋</button>
          <button onClick={()=>{closeForm();setShowForm(true);setView("trades");}} style={{background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",border:"none",borderRadius:11,padding:"9px 16px",color:"#000",fontSize:13,fontWeight:800,boxShadow:"0 3px 12px "+GOLD+"40",WebkitTapHighlightColor:"transparent"}}>+ Despliegue</button>
        </div>
      </div>

      <SideDrawer open={showDrawer} onClose={()=>setShowDrawer(false)} onExport={()=>exportCSV(trades)} onImport={()=>setShowImport(true)} trades={trades} darkMode={darkMode} toggleDark={toggleDark} onNavigateInsights={()=>setView("insights")} onQuickCalc={()=>setShowQuickCalc(true)} onCapital={()=>{ if(capital) setShowCapital(true); else setShowCapitalSetup(true); }} onConstitution={()=>setShowConstitution(true)} onBackup={exportBackup} onRestore={()=>{const inp=document.getElementById("tl-restore-input");if(inp)inp.click();}}/>
      <input id="tl-restore-input" type="file" accept="application/json,.json" style={{display:"none"}} onChange={e=>{const f=e.target.files&&e.target.files[0];if(f){setConfirmRestoreFile(f);}e.target.value="";}}/>

      <div style={{maxWidth:680,margin:"0 auto",padding:"20px 16px 100px",position:"relative",zIndex:1}}>

        {view==="dashboard"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp 0.35s ease"}}>
            <SectionTitle title="Overview" sub={m.n+" trades · "+new Date().toLocaleDateString("es-MX",{month:"long",year:"numeric"})}/>

            <button onClick={()=>{ if(capital) setShowCapital(true); else setShowCapitalSetup(true); }} style={{width:"100%",padding:"15px 18px",background:"linear-gradient(135deg,rgba(245,158,11,0.13),rgba(56,189,248,0.06))",border:"1px solid rgba(245,158,11,0.3)",borderRadius:16,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:22}}>🏛️</span>
                <div style={{textAlign:"left"}}>
                  <div style={{fontFamily:sans,fontSize:15,fontWeight:800,color:"#fff"}}>Gestión de Capital</div>
                  <div style={{fontFamily:mono,fontSize:10,color:"rgba(255,255,255,0.45)"}}>{capital?"estructura · riesgo · diversificación":"configurar compartimentos"}</div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {capital&&capitalMetrics&&<span style={{fontFamily:mono,fontSize:16,fontWeight:700,color:"#FCD34D"}}>${capitalMetrics.total.toLocaleString(undefined,{maximumFractionDigits:0})}</span>}
                <span style={{fontSize:18,color:"rgba(255,255,255,0.4)"}}>›</span>
              </div>
            </button>

            {trades.length===0?(
              <EmptyState onAdd={()=>{closeForm();setShowForm(true);setView("trades");}} onImport={()=>setShowImport(true)}/>
            ):(
              <>
                <div style={{background:cardBg,border:"1px solid "+(monthly.pnl>=0?"rgba(245,158,11,0.2)":"rgba(248,113,113,0.2)"),borderRadius:20,padding:"22px 22px 14px",backdropFilter:"blur(20px)",boxShadow:"0 8px 32px rgba(0,0,0,0.3)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                    <div>
                      <div style={{fontSize:10,color:textSec,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:5}}>{monthly.monthLabel}</div>
                      <div style={{fontSize:40,fontWeight:700,letterSpacing:"-0.03em",lineHeight:1,color:monthly.pnl>=0?GOLD:"#F87171"}}>
                        <Counter value={monthly.pnl} color={monthly.pnl>=0?GOLD:"#F87171"}/>
                      </div>
                      <div style={{marginTop:4,fontSize:11,fontFamily:mono,color:textSec}}>
                        Total: <span style={{color:m.pnl>=0?"rgba(252,211,77,0.7)":"rgba(248,113,113,0.7)",fontWeight:700}}>{m.pnl>=0?"+":""}${m.pnl.toFixed(2)}</span>
                      </div>
                      {hovPt&&hovPt.date?(
                        <div style={{marginTop:6,display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontSize:11,color:textSec,fontFamily:mono}}>{fmtDate(hovPt.date)}</span>
                          <span style={{fontSize:12,fontFamily:mono,fontWeight:700,color:hovPt.v>=0?GOLD:"#F87171"}}>{hovPt.v>=0?"+":""}${hovPt.v.toFixed(2)}</span>
                        </div>
                      ):(
                        <div style={{marginTop:6,display:"flex",gap:10,alignItems:"center"}}>
                          <span style={{fontSize:11,color:textSec,fontFamily:sans}}>{m.n} trades</span>
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"flex-end"}}>
                      <Pill label={"PF "+(isFinite(m.pf)?m.pf.toFixed(2):"∞")} color={m.pf>=2?"#4ADE80":m.pf>=1?GOLD:"#F87171"}/>
                      <Pill label={"DD -$"+m.maxDD.toFixed(0)} color={m.maxDD>200?"#F87171":GOLD}/>
                    </div>
                  </div>
                  <HeroEquity trades={trades} onHover={setHovPt}/>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <KPI label="Win Rate" value={(m.wr*100).toFixed(1)+"%"} color={m.wr>=0.65?"#4ADE80":m.wr>=0.5?GOLD:"#F87171"} sub={m.wins+"W · "+m.losses+"L"+(m.nHedges?" · sin coberturas":"")} icon="🎯"/>
                  <KPI label="Profit Factor" value={isFinite(m.pf)?m.pf.toFixed(2):"∞"} color={m.pf>=2?"#4ADE80":m.pf>=1?GOLD:"#F87171"} sub={m.nHedges?"edge directional":"avgWin/avgLoss"} icon="⚡"/>
                  <KPI label="Avg Win" value={"+$"+m.avgWin.toFixed(0)} color="#4ADE80" sub="por trade ganador" icon="↑"/>
                  <KPI label="Avg Loss" value={"-$"+m.avgLoss.toFixed(0)} color="#F87171" sub="por trade perdedor" icon="↓"/>
                </div>

                {/* Card de coberturas — solo aparece si hay coberturas registradas */}
                {m.nHedges>0&&(
                  <div style={{background:"rgba(148,163,184,0.05)",border:"1px solid rgba(148,163,184,0.2)",borderRadius:16,padding:"14px 18px",display:"flex",alignItems:"center",gap:14}}>
                    <div style={{width:38,height:38,borderRadius:11,background:"rgba(148,163,184,0.12)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <span style={{fontSize:18}}>🛡️</span>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:9,color:"#94A3B8",fontFamily:mono,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:3}}>Coberturas</div>
                      <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                        <span style={{fontFamily:mono,fontSize:18,fontWeight:700,color:m.hedgePnl>=0?"#4ADE80":"#F87171"}}>{m.hedgePnl>=0?"+":""}${m.hedgePnl.toFixed(0)}</span>
                        <span style={{fontFamily:sans,fontSize:11,color:textSec}}>· {m.nHedges} operación{m.nHedges>1?"es":""} de protección</span>
                      </div>
                      <div style={{fontFamily:sans,fontSize:10,color:textSec,marginTop:2}}>Excluidas del win rate y profit factor</div>
                    </div>
                  </div>
                )}

                <div style={{background:surfBg,border:"1px solid "+borderClr,borderRadius:18,padding:"18px 20px"}}>
                  <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:14}}>Por Market Bias</div>
                  {Object.values(BIAS_MAP).map(bias=>{
                    const bt=trades.filter(t=>bias.ids.includes(t.strat));
                    if(!bt.length)return null;
                    const bm=calcMetrics(bt);
                    return(
                      <div key={bias.id} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 0",borderTop:"1px solid "+borderClr}}>
                        <div style={{width:34,height:34,borderRadius:9,background:bias.color+"12",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <span style={{fontSize:16,color:bias.color}}>{bias.icon}</span>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                            <span style={{fontSize:13,fontWeight:600,color:textPrimary,fontFamily:sans}}>{bias.label}</span>
                            <span style={{fontSize:12,fontFamily:mono,fontWeight:700,color:bm.pnl>=0?"#4ADE80":"#F87171"}}>{bm.pnl>=0?"+":""}${bm.pnl.toFixed(0)}</span>
                          </div>
                          <div style={{height:3,background:"rgba(255,255,255,0.05)",borderRadius:99,overflow:"hidden"}}>
                            <div style={{height:"100%",width:(bm.wr*100)+"%",background:bias.color,borderRadius:99,transition:"width 0.8s"}}/>
                          </div>
                        </div>
                        <span style={{fontSize:11,fontFamily:mono,color:bm.wr>=0.6?"#4ADE80":bm.wr>=0.5?GOLD:"#F87171",minWidth:32,textAlign:"right"}}>{(bm.wr*100).toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{background:surfBg,border:"1px solid "+borderClr,borderRadius:18,padding:"18px 20px"}}>
                  <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:12}}>Por Estrategia</div>
                  {Object.values(STRATEGIES).map(s=>{
                    const st=trades.filter(t=>t.strat===s.id);if(!st.length)return null;
                    const sm=calcMetrics(st);
                    return(
                      <div key={s.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 0",borderTop:"1px solid "+borderClr}}>
                        <Pill label={s.short} color={s.color} small/>
                        <span style={{fontSize:11,color:textSec,fontFamily:sans,flex:1}}>{s.label}</span>
                        <span style={{fontSize:10,color:textSec,fontFamily:mono}}>{sm.n}t</span>
                        <span style={{fontSize:10,fontFamily:mono,color:sm.wr>=0.6?"#4ADE80":sm.wr>=0.5?GOLD:"#F87171",minWidth:30,textAlign:"right"}}>{(sm.wr*100).toFixed(0)}%</span>
                        <span style={{fontSize:11,fontFamily:mono,fontWeight:700,color:sm.pnl>=0?"#4ADE80":"#F87171",minWidth:64,textAlign:"right"}}>{sm.pnl>=0?"+":""}${sm.pnl.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {view==="trades"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp 0.35s ease"}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
              <SectionTitle title="Journal" sub={trades.length+" trades"+(drafts.length>0?" · "+drafts.length+" draft"+(drafts.length>1?"s":"")+" pendiente":"")}/>
              <div style={{display:"flex",gap:2,background:"rgba(255,255,255,0.05)",borderRadius:10,padding:3,flexShrink:0,marginTop:4}}>
                {["calendar","list"].map(mo=>(
                  <button key={mo} onClick={()=>{setJournalMode(mo);setCalDay(null);}} style={{background:journalMode===mo?"rgba(255,255,255,0.1)":"transparent",border:"none",borderRadius:8,padding:"6px 12px",color:journalMode===mo?textPrimary:textSec,fontSize:11,fontFamily:sans,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                    {mo==="calendar"?"📅":"☰"}
                  </button>
                ))}
              </div>
            </div>

            {drafts.length>0&&(
              <div style={{background:surfBg,border:"1px solid rgba(139,92,246,0.25)",borderRadius:16,padding:"16px 18px"}}>
                <div style={{fontSize:10,color:"#A78BFA",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:12}}>Drafts Pendientes</div>
                {drafts.map(d=>{
                  const s=STRATEGIES[d.strat]||STRATEGIES.otras;
                  return(
                    <div key={d.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:"rgba(139,92,246,0.06)",borderRadius:10,border:"1px solid rgba(139,92,246,0.15)",marginBottom:6}}>
                      <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:"#fff",minWidth:48}}>{d.ticker}</span>
                      <Pill label={s.short} color={s.color} small/>
                      {d.score&&<span style={{fontFamily:mono,fontSize:11,color:d.score>=85?"#4ADE80":d.score>=65?GOLD:"#F87171"}}>{d.score}%</span>}
                      <div style={{flex:1}}/>
                      <button onClick={()=>executeDraft(d)} style={{background:"#8B5CF6",border:"none",borderRadius:8,padding:"6px 14px",color:"#fff",fontSize:12,fontFamily:sans,fontWeight:600,WebkitTapHighlightColor:"transparent"}}>Ejecutar</button>
                      <button onClick={()=>deleteDraft(d.id)} style={{background:"none",border:"none",color:textSec,fontSize:18,padding:"0 4px",WebkitTapHighlightColor:"transparent"}}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {showForm&&(
              <div style={{background:cardBg,border:"1px solid rgba(245,158,11,0.2)",borderRadius:20,padding:"20px",animation:"slideUp 0.3s ease"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                  <div>
                    <div style={{fontSize:16,fontWeight:700,color:textPrimary,fontFamily:sans}}>{editId?"Editar Trade":"Nuevo Trade"}</div>
                    {fromDraft&&<div style={{fontSize:11,color:"#4ADE80",fontFamily:sans,marginTop:2}}>Desde draft ✓</div>}
                  </div>
                  <button onClick={closeForm} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:textSec,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",WebkitTapHighlightColor:"transparent"}}>✕</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  <FInput label="Fecha" value={form.date} onChange={sf("date")} type="date" error={errors.date}/>
                  <FInput label="Ticker" value={form.ticker} onChange={v=>sf("ticker")(v.toUpperCase())} placeholder="META" error={errors.ticker}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  <FInput label="Expiracion" value={form.expiry} onChange={sf("expiry")} type="date"/>
                  {form.date&&form.expiry&&(
                    <div style={{background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"13px 14px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
                      <span style={{fontSize:9,color:textSec,fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.1em"}}>DTE</span>
                      <span style={{fontSize:18,fontFamily:mono,fontWeight:700,color:GOLD}}>{dteDays(form.date,form.expiry)}d</span>
                    </div>
                  )}
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Estrategia</div>
                  <StratPicker value={form.strat} onChange={sf("strat")}/>
                </div>

                {/* ── Toggle de Cobertura ─────────────────────────────────── */}
                <button onClick={()=>sf("isHedge")(!form.isHedge)} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:form.isHedge?"rgba(148,163,184,0.1)":"rgba(255,255,255,0.02)",border:"1px solid "+(form.isHedge?"rgba(148,163,184,0.35)":"rgba(255,255,255,0.08)"),borderRadius:12,cursor:"pointer",WebkitTapHighlightColor:"transparent",marginBottom:14,textAlign:"left",transition:"all 0.15s"}}>
                  <div style={{width:38,height:22,borderRadius:11,background:form.isHedge?"#94A3B8":"rgba(255,255,255,0.1)",position:"relative",transition:"background 0.2s",flexShrink:0}}>
                    <div style={{position:"absolute",top:2,left:form.isHedge?18:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:18}}>🛡️</span>
                      <span style={{fontFamily:sans,fontSize:13,fontWeight:600,color:form.isHedge?"#CBD5E1":textPrimary}}>Operación de cobertura</span>
                    </div>
                    <div style={{fontFamily:sans,fontSize:11,color:textSec,marginTop:2}}>
                      {form.isHedge?"Excluida del win rate y métricas de edge":"Operación direccional regular"}
                    </div>
                  </div>
                </button>

                {!editId&&capital&&(
                  <button onClick={()=>sf("affectsCapital")(!form.affectsCapital)} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:form.affectsCapital?"rgba(245,158,11,0.1)":"rgba(255,255,255,0.02)",border:"1px solid "+(form.affectsCapital?"rgba(245,158,11,0.35)":"rgba(255,255,255,0.08)"),borderRadius:12,cursor:"pointer",WebkitTapHighlightColor:"transparent",marginBottom:14,textAlign:"left",transition:"all 0.15s"}}>
                    <div style={{width:38,height:22,borderRadius:11,background:form.affectsCapital?GOLD:"rgba(255,255,255,0.1)",position:"relative",transition:"background 0.2s",flexShrink:0}}>
                      <div style={{position:"absolute",top:2,left:form.affectsCapital?18:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:18}}>💰</span>
                        <span style={{fontFamily:sans,fontSize:13,fontWeight:600,color:form.affectsCapital?"#FCD34D":textPrimary}}>Afectar capital operativo</span>
                      </div>
                      <div style={{fontFamily:sans,fontSize:11,color:textSec,marginTop:2}}>
                        {form.affectsCapital?"El P&L se sumará/restará del Capital Operativo":"Registro histórico — no toca el capital actual"}
                      </div>
                    </div>
                  </button>
                )}

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <FInput label="P&L $" value={form.pnl} onChange={sf("pnl")} type="number" placeholder="100" error={errors.pnl}/>
                  <FInput label="Retorno %" value={form.pct} onChange={sf("pct")} type="number" placeholder="50" suffix="%"/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <FInput label="Strikes" value={form.strikes} onChange={sf("strikes")} placeholder="585/582"/>
                  <FInput label="Score" value={form.score} onChange={sf("score")} type="number" placeholder="85"/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
                  <FInput label="Prima $" value={form.premium} onChange={sf("premium")} type="number" placeholder="0.67"/>
                  <FInput label="Contratos" value={form.contracts} onChange={sf("contracts")} type="number"/>
                  <FInput label="IVR %" value={form.ivr} onChange={sf("ivr")} type="number" placeholder="35" suffix="%"/>
                </div>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Notas</div>
                  <textarea value={form.notes} onChange={e=>sf("notes")(e.target.value)} placeholder="Thesis, niveles clave, contexto IVR..." style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 14px",color:"#fff",fontSize:14,fontFamily:mono,width:"100%",outline:"none",resize:"vertical",minHeight:64,boxSizing:"border-box"}}/>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={submitTrade} style={{flex:1,background:editId?"rgba(56,189,248,0.1)":"linear-gradient(135deg,"+GOLD+","+GOLD2+")",border:editId?"1px solid rgba(56,189,248,0.3)":"none",borderRadius:14,padding:"14px",color:editId?"#38BDF8":"#000",fontFamily:sans,fontSize:14,fontWeight:700,WebkitTapHighlightColor:"transparent"}}>{editId?"Guardar Cambios":"Agregar Trade"}</button>
                  <button onClick={closeForm} style={{background:"rgba(255,255,255,0.05)",border:"1px solid "+borderClr,borderRadius:14,padding:"14px 18px",color:textSec,fontSize:14,fontFamily:sans,WebkitTapHighlightColor:"transparent"}}>Cancelar</button>
                </div>
              </div>
            )}

            {trades.length===0&&!showForm&&<EmptyState onAdd={()=>{closeForm();setShowForm(true);}} onImport={()=>setShowImport(true)}/>}

            {journalMode==="calendar"&&trades.length>0&&(
              <div style={{background:surfBg,border:"1px solid "+borderClr,borderRadius:18,padding:"20px 16px"}}>
                <CalendarView trades={trades} onSelectDay={(iso,dts)=>setCalDay({iso,trades:dts})}/>
                {calDay&&(
                  <div style={{marginTop:18,paddingTop:18,borderTop:"1px solid "+borderClr}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                      <span style={{fontSize:14,fontWeight:600,color:textPrimary,fontFamily:sans}}>{fmtDate(calDay.iso)} · {calDay.trades.length} trade{calDay.trades.length>1?"s":""}</span>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:calDay.trades.reduce((a,t)=>a+t.pnl,0)>=0?"#4ADE80":"#F87171"}}>
                          {calDay.trades.reduce((a,t)=>a+t.pnl,0)>=0?"+":""}${calDay.trades.reduce((a,t)=>a+t.pnl,0).toFixed(2)}
                        </span>
                        <button onClick={()=>setCalDay(null)} style={{background:"none",border:"none",color:textSec,fontSize:20,WebkitTapHighlightColor:"transparent"}}>×</button>
                      </div>
                    </div>
                    {calDay.trades.map(t=>{
                      const s=STRATEGIES[t.strat]||STRATEGIES.otras;
                      return(
                        <div key={t.id} onClick={()=>setSelected(t)} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:t.isHedge?"rgba(148,163,184,0.05)":"rgba(255,255,255,0.03)",borderRadius:12,marginBottom:6,border:"1px solid "+(t.isHedge?"rgba(148,163,184,0.2)":borderClr),cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                          {t.isHedge&&<span style={{fontSize:12,opacity:0.85}}>🛡️</span>}
                          <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:textPrimary,minWidth:46}}>{t.ticker}</span>
                          <Pill label={s.short} color={t.isHedge?"#94A3B8":s.color} small/>
                          <div style={{flex:1}}/>
                          <ScoreBar score={t.score}/>
                          <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:t.isHedge?"#94A3B8":(t.pnl>=0?"#4ADE80":"#F87171"),minWidth:68,textAlign:"right"}}>{t.pnl>=0?"+":""}${t.pnl.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {journalMode==="list"&&trades.length>0&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[{id:"all",label:"Todos",color:"rgba(255,255,255,0.6)"},...Object.values(BIAS_MAP)].map(b=>(
                    <button key={b.id} onClick={()=>setFilterBias(b.id)} style={{background:filterBias===b.id?"rgba(255,255,255,0.08)":"transparent",border:"1px solid "+(filterBias===b.id?"rgba(255,255,255,0.2)":borderClr),borderRadius:20,padding:"6px 16px",color:filterBias===b.id?(b.color||"#fff"):textSec,fontSize:12,fontWeight:filterBias===b.id?600:400,WebkitTapHighlightColor:"transparent"}}>
                      {b.label||(b.id==="all"?"Todos":"")}
                    </button>
                  ))}
                </div>
                {filtTrades.map((t,i)=>{
                  const s=STRATEGIES[t.strat]||STRATEGIES.otras;
                  const dte=dteDays(t.date,t.expiry);
                  const isPat=!!t.isPatrimony;
                  return(
                    <div key={t.id} onClick={()=>setSelected(t)} style={{display:"flex",alignItems:"center",gap:8,padding:"13px 14px",background:cardBg,borderRadius:14,border:"1px solid "+(t.isHedge?"rgba(148,163,184,0.2)":isPat?"rgba(56,189,248,0.2)":borderClr),cursor:"pointer",animation:"fadeUp 0.3s ease "+(i*0.02)+"s both",WebkitTapHighlightColor:"transparent",opacity:t.isHedge?0.92:1}}>
                      <div style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          {t.isHedge&&<span style={{fontSize:12,opacity:0.85}}>🛡️</span>}
                          {isPat&&<span style={{fontSize:12,opacity:0.85}}>📈</span>}
                          <span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:textPrimary}}>{t.ticker}</span>
                          <Pill label={s.short} color={t.isHedge?"#94A3B8":isPat?"#38BDF8":s.color} small/>
                          {dte!==null&&<span style={{fontSize:10,color:textSec,fontFamily:mono}}>{dte}d</span>}
                          {(t.ivr!==""&&t.ivr!==null)&&<span style={{fontSize:10,color:textSec,fontFamily:mono}}>{t.ivr}%</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,color:textSec,fontFamily:mono}}>{fmtDate(t.date)}</span>
                          <ScoreBar score={t.score}/>
                        </div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                        <span style={{fontSize:13,fontFamily:mono,fontWeight:700,color:t.isHedge?"#94A3B8":isPat?"#38BDF8":(t.pnl>0?"#4ADE80":t.pnl<0?"#F87171":textSec)}}>{t.pnl>0?"+":""}${Math.abs(t.pnl).toFixed(2)}</span>
                        <span style={{fontSize:10,color:t.isHedge?textSec:isPat?"#38BDF8":(t.pct>0?"#4ADE80":t.pct<0?"#F87171":textSec),fontFamily:mono}}>{t.pct>0?"+":""}{(t.pct||0).toFixed(1)}%</span>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:4,marginLeft:4}}>
                        <button onClick={e=>{e.stopPropagation();openEdit(t);}} style={{background:"rgba(56,189,248,0.08)",border:"1px solid rgba(56,189,248,0.15)",borderRadius:8,padding:"5px 8px",color:"#38BDF8",fontSize:11,WebkitTapHighlightColor:"transparent"}}>✎</button>
                        {confirmDel===t.id?(
                          <div style={{display:"flex",gap:3}} onClick={e=>e.stopPropagation()}>
                            <button onClick={()=>deleteTrade(t.id)} style={{background:"rgba(248,113,113,0.12)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:7,padding:"5px 7px",color:"#F87171",fontSize:10,fontFamily:mono,WebkitTapHighlightColor:"transparent"}}>Sí</button>
                            <button onClick={()=>setConfirmDel(null)} style={{background:"transparent",border:"1px solid "+borderClr,borderRadius:7,padding:"5px 7px",color:textSec,fontSize:10,WebkitTapHighlightColor:"transparent"}}>No</button>
                          </div>
                        ):(
                          <button onClick={e=>{e.stopPropagation();setConfirmDel(t.id);}} style={{background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.15)",borderRadius:8,padding:"5px 8px",color:"rgba(248,113,113,0.5)",fontSize:11,WebkitTapHighlightColor:"transparent"}}>✕</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view==="calculator"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp 0.35s ease"}}>
            <SectionTitle title="Calculator" sub="Todas las estrategias · Análisis en tiempo real"/>
            <div style={{background:surfBg,border:"1px solid "+borderClr,borderRadius:18,padding:"20px"}}>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Estrategia</div>
                <StratPicker value={calc.strategy} onChange={v=>setCalc(c=>({...c,strategy:v}))}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <FInput label="Ticker" value={calc.ticker} onChange={v=>setCalc(c=>({...c,ticker:v.toUpperCase()}))} placeholder="META"/>
                <FInput label="Spot" value={calc.spot} onChange={v=>setCalc(c=>({...c,spot:v}))} type="number" placeholder="605"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <FInput label="Entrada" value={calc.entryDate} onChange={v=>setCalc(c=>({...c,entryDate:v}))} type="date"/>
                <FInput label="Expiración" value={calc.expiry} onChange={v=>setCalc(c=>({...c,expiry:v}))} type="date"/>
              </div>
              {calcRes?.dte!=null&&(
                <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10,marginBottom:10,display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:9,color:textSec,fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.1em"}}>DTE</span>
                  <span style={{fontSize:16,fontFamily:mono,fontWeight:700,color:GOLD}}>{calcRes.dte} días</span>
                </div>
              )}
              {calc.strategy!=="ic"&&calc.strategy!=="ib"&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <FInput label="Short Strike" value={calc.strikeShort} onChange={v=>setCalc(c=>({...c,strikeShort:v}))} type="number" placeholder="585"/>
                  <FInput label="Long Strike" value={calc.strikeLong} onChange={v=>setCalc(c=>({...c,strikeLong:v}))} type="number" placeholder="582"/>
                  <FInput label={STRATEGIES[calc.strategy]?.type==="credit"?"Crédito $":"Débito $"} value={calc.premium} onChange={v=>setCalc(c=>({...c,premium:v}))} type="number" placeholder="0.67"/>
                  <FInput label="Contratos" value={calc.contracts} onChange={v=>setCalc(c=>({...c,contracts:v}))} type="number"/>
                </div>
              )}
              {(calc.strategy==="ic"||calc.strategy==="ib")&&(
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:10}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <FInput label="Long Put" value={calc.icPutLong} onChange={v=>setCalc(c=>({...c,icPutLong:v}))} type="number" placeholder="580"/>
                    <FInput label="Short Put" value={calc.icPutShort} onChange={v=>setCalc(c=>({...c,icPutShort:v}))} type="number" placeholder="585"/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <FInput label="Short Call" value={calc.icCallShort} onChange={v=>setCalc(c=>({...c,icCallShort:v}))} type="number" placeholder="625"/>
                    <FInput label="Long Call" value={calc.icCallLong} onChange={v=>setCalc(c=>({...c,icCallLong:v}))} type="number" placeholder="630"/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <FInput label="Crédito Total $" value={calc.icCredit} onChange={v=>setCalc(c=>({...c,icCredit:v}))} type="number" placeholder="1.40"/>
                    <FInput label="Contratos" value={calc.contracts} onChange={v=>setCalc(c=>({...c,contracts:v}))} type="number"/>
                  </div>
                </div>
              )}
              <FInput label="IVR %" value={calc.ivr} onChange={v=>setCalc(c=>({...c,ivr:v}))} type="number" placeholder="35" suffix="%"/>
            </div>
            {calcRes&&!calcRes.partial&&(
              <div style={{background:cardBg,border:"1px solid "+GOLD+"30",borderRadius:18,padding:"20px",display:"flex",flexDirection:"column",gap:14}}>
                <div style={{fontSize:10,color:textSec,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase"}}>
                  {calc.ticker||"—"} · {STRATEGIES[calc.strategy]?.label}
                </div>

                {/* Base metrics grid */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <SC label="Max Profit" value={"$"+calcRes.maxProfit.toFixed(0)} color="#4ADE80"/>
                  <SC label="Max Loss" value={"$"+calcRes.maxLoss.toFixed(0)} color="#F87171"/>
                  {calcRes.breakeven!=null&&<SC label="Breakeven" value={"$"+calcRes.breakeven.toFixed(2)}/>}
                  {calcRes.beLow!=null&&<SC label="BE Bajo" value={"$"+calcRes.beLow.toFixed(2)}/>}
                  {calcRes.beHigh!=null&&<SC label="BE Alto" value={"$"+calcRes.beHigh.toFixed(2)}/>}
                  <SC label="R/R Ratio" value={calcRes.rr.toFixed(2)} color={calcRes.rr>=1.5?"#4ADE80":calcRes.rr>=1?GOLD:"#F87171"}/>
                </div>

                {/* ── 1. Velocidad del Dinero — TP sugerido por DTE ── */}
                {calcRes.isCredit&&calcRes.tpPct!=null&&(
                  <div style={{borderRadius:14,overflow:"hidden",border:"1px solid rgba(252,211,77,0.2)"}}>
                    <div style={{background:"rgba(245,158,11,0.06)",padding:"10px 14px 8px",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid rgba(245,158,11,0.1)"}}>
                      <span style={{fontSize:14}}>⚡</span>
                      <span style={{fontSize:9,fontFamily:mono,color:"rgba(252,211,77,0.7)",letterSpacing:"0.12em",textTransform:"uppercase",fontWeight:700}}>Velocidad del Dinero · DTE {calcRes.dte!=null?calcRes.dte+"d":"?"}</span>
                    </div>
                    <div style={{background:"rgba(245,158,11,0.04)",padding:"14px"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                        <div>
                          <div style={{fontFamily:sans,fontSize:13,color:"rgba(255,255,255,0.7)",marginBottom:3}}>
                            {calcRes.dte!==null&&calcRes.dte<5
                              ? "DTE crítico — extrae rápido"
                              : calcRes.dte!==null&&calcRes.dte<15
                                ? "DTE medio — velocidad estándar"
                                : "DTE holgado — deja correr"}
                          </div>
                          <div style={{fontFamily:mono,fontSize:11,color:textSec}}>
                            Cierra al <span style={{color:GOLD2,fontWeight:700}}>{calcRes.tpPct}%</span> de ganancia máxima
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:mono,fontSize:22,fontWeight:700,color:GOLD,lineHeight:1}}>${calcRes.tpAmt.toFixed(0)}</div>
                          <div style={{fontFamily:mono,fontSize:10,color:textSec,marginTop:2}}>objetivo TP</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        {[{p:30,label:"30%"},{p:40,label:"40%"},{p:50,label:"50%"}].map(opt=>{
                          const active=calcRes.tpPct===opt.p;
                          return(
                            <div key={opt.p} style={{flex:1,background:active?"rgba(245,158,11,0.15)":"rgba(255,255,255,0.03)",border:"1px solid "+(active?GOLD+"50":"rgba(255,255,255,0.07)"),borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                              <div style={{fontFamily:mono,fontSize:12,fontWeight:700,color:active?GOLD:"rgba(255,255,255,0.25)"}}>{opt.label}</div>
                              <div style={{fontFamily:mono,fontSize:10,color:active?GOLD2+"80":textSec}}>${(calcRes.maxProfit*(opt.p/100)).toFixed(0)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 2. Termómetro RoR ── */}
                {calcRes.ror!=null&&(
                  <div style={{borderRadius:14,overflow:"hidden",border:"1px solid "+(calcRes.ror>=20?"rgba(74,222,128,0.25)":calcRes.ror>=12?"rgba(245,158,11,0.25)":"rgba(248,113,113,0.35)")}}>
                    <div style={{background:calcRes.ror>=20?"rgba(74,222,128,0.06)":calcRes.ror>=12?"rgba(245,158,11,0.06)":"rgba(248,113,113,0.08)",padding:"10px 14px 8px",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid "+(calcRes.ror>=20?"rgba(74,222,128,0.1)":calcRes.ror>=12?"rgba(245,158,11,0.1)":"rgba(248,113,113,0.15)")}}>
                      <span style={{fontSize:14}}>🌡️</span>
                      <span style={{fontSize:9,fontFamily:mono,color:calcRes.ror>=20?"rgba(74,222,128,0.7)":calcRes.ror>=12?"rgba(245,158,11,0.7)":"rgba(248,113,113,0.7)",letterSpacing:"0.12em",textTransform:"uppercase",fontWeight:700}}>Termómetro RoR — Eficiencia del Capital</span>
                    </div>
                    <div style={{background:calcRes.ror>=20?"rgba(74,222,128,0.03)":calcRes.ror>=12?"rgba(245,158,11,0.03)":"rgba(248,113,113,0.04)",padding:"14px"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                        <div>
                          <div style={{fontFamily:sans,fontSize:13,color:"rgba(255,255,255,0.7)",marginBottom:3}}>
                            {calcRes.ror>=20?"Capital trabajando duro ✓":calcRes.ror>=12?"Eficiencia aceptable":"⚠️ Demasiada munición para poco botín"}
                          </div>
                          <div style={{fontFamily:mono,fontSize:11,color:textSec}}>Crédito / Margen retenido</div>
                        </div>
                        <div style={{fontFamily:mono,fontSize:28,fontWeight:700,color:calcRes.ror>=20?"#4ADE80":calcRes.ror>=12?GOLD:"#F87171",lineHeight:1}}>
                          {calcRes.ror.toFixed(1)}%
                        </div>
                      </div>
                      <div style={{position:"relative",height:8,background:"rgba(255,255,255,0.05)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{position:"absolute",left:0,top:0,bottom:0,width:Math.min(calcRes.ror,40)/40*100+"%",background:calcRes.ror>=20?"linear-gradient(90deg,#4ADE80,#86EFAC)":calcRes.ror>=12?"linear-gradient(90deg,"+GOLD+","+GOLD2+")":"linear-gradient(90deg,#F87171,#FCA5A5)",borderRadius:99,transition:"width 0.6s cubic-bezier(0.34,1.56,0.64,1)"}}/>
                        {/* threshold markers */}
                        <div style={{position:"absolute",left:"30%",top:0,bottom:0,width:1,background:"rgba(255,255,255,0.2)"}}/>
                        <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:"rgba(255,255,255,0.2)"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
                        <span style={{fontFamily:mono,fontSize:9,color:"#F87171"}}>0%</span>
                        <span style={{fontFamily:mono,fontSize:9,color:GOLD}}>12%</span>
                        <span style={{fontFamily:mono,fontSize:9,color:"#4ADE80"}}>20%+</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 3. Foso Defensivo ── */}
                {calcRes.bePct!=null&&(
                  <div style={{borderRadius:14,overflow:"hidden",border:"1px solid rgba(56,189,248,0.2)"}}>
                    <div style={{background:"rgba(56,189,248,0.06)",padding:"10px 14px 8px",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid rgba(56,189,248,0.1)"}}>
                      <span style={{fontSize:14}}>🏰</span>
                      <span style={{fontSize:9,fontFamily:mono,color:"rgba(56,189,248,0.7)",letterSpacing:"0.12em",textTransform:"uppercase",fontWeight:700}}>Foso Defensivo · Distancia al Breakeven</span>
                    </div>
                    <div style={{background:"rgba(56,189,248,0.03)",padding:"14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12}}>
                        <div style={{flex:1}}>
                          <div style={{fontFamily:sans,fontSize:13,color:"rgba(255,255,255,0.8)",lineHeight:1.5}}>
                            <span style={{color:"#fff",fontWeight:700}}>{calc.ticker||"El activo"}</span> necesita una {calcRes.beDir} de{" "}
                            <span style={{color:"#38BDF8",fontWeight:700,fontFamily:mono}}>-{calcRes.bePct.toFixed(1)}%</span>{" "}
                            para tocar el breakeven
                          </div>
                          <div style={{fontFamily:mono,fontSize:11,color:textSec,marginTop:4}}>
                            Spot ${parseFloat(calc.spot).toFixed(2)} → BE ${calcRes.breakeven!=null?calcRes.breakeven.toFixed(2):calcRes.beLow?.toFixed(2)}
                          </div>
                        </div>
                        <div style={{width:64,height:64,borderRadius:"50%",border:"3px solid "+(calcRes.bePct>=3?"#38BDF8":calcRes.bePct>=1.5?GOLD:"#F87171"),display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,background:calcRes.bePct>=3?"rgba(56,189,248,0.08)":calcRes.bePct>=1.5?"rgba(245,158,11,0.08)":"rgba(248,113,113,0.08)"}}>
                          <span style={{fontFamily:mono,fontSize:14,fontWeight:700,color:calcRes.bePct>=3?"#38BDF8":calcRes.bePct>=1.5?GOLD:"#F87171",lineHeight:1}}>{calcRes.bePct.toFixed(1)}%</span>
                          <span style={{fontFamily:mono,fontSize:8,color:textSec,marginTop:1}}>foso</span>
                        </div>
                      </div>
                      <div style={{padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid rgba(255,255,255,0.06)"}}>
                        <span style={{fontFamily:sans,fontSize:11,color:textSec}}>
                          {calcRes.bePct>=3?"🟢 Foso amplio — margen de seguridad sólido":calcRes.bePct>=1.5?"🟡 Foso moderado — monitorea de cerca":"🔴 Foso estrecho — posición ajustada al precio"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* IVR Fit */}
                {calcRes.fit!==null&&(
                  <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10}}>
                    <span style={{fontSize:9,color:textSec,fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.1em"}}>IVR Fit</span>
                    <div style={{flex:1,height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
                      <div style={{height:"100%",width:((calcRes.fit/5)*100)+"%",background:calcRes.fit>=4?"#4ADE80":calcRes.fit===3?GOLD:"#F87171",borderRadius:2,transition:"width 0.4s"}}/>
                    </div>
                    <span style={{fontSize:11,fontFamily:mono,color:calcRes.fit>=4?"#4ADE80":calcRes.fit===3?GOLD:"#F87171"}}>{calcRes.fit>=4?"Optimal":calcRes.fit===3?"Neutral":"Suboptimal"}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {view==="scorecard"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp 0.35s ease"}}>
            <SectionTitle title="Scorecard" sub="Evalúa tu setup antes de entrar"/>

            {/* ── Datos del setup ── */}
            <div style={{background:surfBg,border:"1px solid "+borderClr,borderRadius:18,padding:"18px",display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <FInput label="Ticker" value={scTicker} onChange={setScTicker} placeholder="META"/>
                <FInput label="Spot $" value={scSpot} onChange={setScSpot} type="number" placeholder="605"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <FInput label="Strike Corto $" value={scStrikeShort} onChange={setScStrikeShort} type="number" placeholder="590"/>
                <FInput label="Strike Largo $" value={scStrikeLong} onChange={setScStrikeLong} type="number" placeholder="587"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <FInput label="IVR %" value={scIvr} onChange={setScIvr} type="number" placeholder="45" suffix="%"/>
                <FInput label="Expiración" value={scExpiry} onChange={setScExpiry} type="date"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <FInput label={scoreSt==="bcs"||scoreSt==="pds"?"Débito por contrato $":"Crédito por contrato $"} value={scPremium} onChange={setScPremium} type="number" placeholder="0.67"/>
                <FInput label="Contratos" value={scContracts} onChange={setScContracts} type="number" placeholder="3"/>
              </div>

              {/* Panel de métricas calculadas automáticamente */}
              {(scExpiry||scSpot)&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:4}}>
                  {scExpiry&&(()=>{
                    const d=dteDays(todayStr(),scExpiry);
                    return(
                      <div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                        <div style={{fontSize:9,color:"rgba(245,158,11,0.6)",fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>DTE</div>
                        <div style={{fontSize:18,fontFamily:mono,fontWeight:700,color:GOLD}}>{d}</div>
                        <div style={{fontSize:9,fontFamily:mono,color:textSec,marginTop:2}}>{d<=5?"crítico":d<=14?"óptimo":d<=30?"estándar":"amplio"}</div>
                      </div>
                    );
                  })()}
                  {scSpot&&scStrikeShort&&(()=>{
                    const spot=parseFloat(scSpot);
                    const strike=parseFloat(scStrikeShort);
                    const dist=Math.abs((strike-spot)/spot)*100;
                    // Para crédito (PCS, CCS, IC, IB): más lejos = mejor
                    // Para débito (BCS, PDS): más cerca = mejor
                    const isDebit=scoreSt==="bcs"||scoreSt==="pds";
                    const c=isDebit
                      ?(dist<1?"#4ADE80":dist<=2.5?GOLD:"#F87171")
                      :(dist>3?"#4ADE80":dist>=2?GOLD:"#F87171");
                    const label=isDebit
                      ?(dist<1?"cerca — óptimo":dist<=2.5?"moderado":"lejos del precio")
                      :(dist>3?"foso amplio":dist>=2?"moderado":"ajustado");
                    const direction=scoreSt==="pcs"||scoreSt==="pds"?"↓ abajo":scoreSt==="bcs"?"↑ arriba":scoreSt==="ccs"?"↑ arriba":"±";
                    return(
                      <div style={{background:c+"10",border:"1px solid "+c+"30",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                        <div style={{fontSize:9,color:c+"99",fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Dist. {direction}</div>
                        <div style={{fontSize:18,fontFamily:mono,fontWeight:700,color:c}}>{dist.toFixed(1)}%</div>
                        <div style={{fontSize:9,fontFamily:mono,color:textSec,marginTop:2}}>{label}</div>
                      </div>
                    );
                  })()}
                  {scIvr&&(()=>{
                    const ivr=parseFloat(scIvr);
                    const c=ivr>50?"#4ADE80":ivr>=35?GOLD:"#F87171";
                    return(
                      <div style={{background:c+"10",border:"1px solid "+c+"30",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                        <div style={{fontSize:9,color:c+"99",fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>IVR</div>
                        <div style={{fontSize:18,fontFamily:mono,fontWeight:700,color:c}}>{ivr}%</div>
                        <div style={{fontSize:9,fontFamily:mono,color:textSec,marginTop:2}}>{ivr>50?"alto":ivr>=35?"medio":"bajo"}</div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* ── Números del Setup (fusión Calc → Score) ──────────────────── */}
            {setupNumbers.ready&&(
              <div style={{background:"linear-gradient(135deg,rgba(245,158,11,0.08),rgba(252,211,77,0.04))",border:"1px solid rgba(245,158,11,0.25)",borderRadius:18,padding:"18px",display:"flex",flexDirection:"column",gap:14}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                  <span style={{fontSize:16}}>📐</span>
                  <span style={{fontSize:11,color:GOLD,fontFamily:mono,letterSpacing:"0.14em",textTransform:"uppercase",fontWeight:700}}>Números del Setup</span>
                </div>

                {/* Grid de números crudos */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div style={{padding:"12px 14px",background:"rgba(74,222,128,0.06)",border:"1px solid rgba(74,222,128,0.2)",borderRadius:10}}>
                    <div style={{fontSize:9,color:"rgba(74,222,128,0.7)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Max Profit</div>
                    <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:"#4ADE80",lineHeight:1}}>+${setupNumbers.maxProfit.toFixed(0)}</div>
                  </div>
                  <div style={{padding:"12px 14px",background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:10}}>
                    <div style={{fontSize:9,color:"rgba(248,113,113,0.7)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Max Loss</div>
                    <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:"#F87171",lineHeight:1}}>-${setupNumbers.maxLoss.toFixed(0)}</div>
                  </div>
                  {setupNumbers.breakeven!==null&&(
                    <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid "+borderClr,borderRadius:10}}>
                      <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Breakeven</div>
                      <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:textPrimary,lineHeight:1}}>${setupNumbers.breakeven.toFixed(2)}</div>
                    </div>
                  )}
                  {setupNumbers.rr!==null&&(
                    <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid "+borderClr,borderRadius:10}}>
                      <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>R/R</div>
                      <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:setupNumbers.isCredit?(setupNumbers.rr>=0.5?"#4ADE80":setupNumbers.rr>=0.33?GOLD:"#F87171"):(setupNumbers.rr>=2?"#4ADE80":setupNumbers.rr>=1?GOLD:"#F87171"),lineHeight:1}}>1 : {setupNumbers.rr>=1?setupNumbers.rr.toFixed(2):(1/setupNumbers.rr).toFixed(2)}</div>
                      <div style={{fontSize:8,fontFamily:mono,color:textSec,marginTop:2}}>{setupNumbers.rr>=1?"risk 1 win "+setupNumbers.rr.toFixed(1):"risk "+(1/setupNumbers.rr).toFixed(1)+" win 1"}</div>
                    </div>
                  )}
                </div>

                {/* Velocidad del Dinero */}
                {setupNumbers.tpPct&&(
                  <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:"1px solid "+borderClr}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                      <span style={{fontSize:13}}>⚡</span>
                      <span style={{fontSize:10,color:textSec,fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:700}}>Velocidad del Dinero</span>
                    </div>
                    <div style={{display:"flex",gap:10,alignItems:"baseline",flexWrap:"wrap"}}>
                      <span style={{fontFamily:mono,fontSize:14,fontWeight:700,color:GOLD}}>TP {setupNumbers.tpPct}%</span>
                      <span style={{fontFamily:mono,fontSize:13,color:"#4ADE80"}}>≈ ${setupNumbers.tpAmount.toFixed(0)}</span>
                      <span style={{fontFamily:sans,fontSize:11,color:textSec,marginLeft:"auto"}}>{setupNumbers.dte!==null&&setupNumbers.dte<5?"DTE crítico — extrae rápido":setupNumbers.dte!==null&&setupNumbers.dte<15?"DTE medio":"DTE holgado"}</span>
                    </div>
                  </div>
                )}

                {/* Foso Defensivo */}
                {setupNumbers.beDistance!==null&&setupNumbers.isCredit&&(
                  <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:"1px solid "+borderClr,display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:48,height:48,borderRadius:"50%",background:setupNumbers.beDistance>=3?"rgba(74,222,128,0.12)":setupNumbers.beDistance>=1.5?"rgba(245,158,11,0.12)":"rgba(248,113,113,0.12)",border:"2px solid "+(setupNumbers.beDistance>=3?"#4ADE80":setupNumbers.beDistance>=1.5?GOLD:"#F87171"),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:setupNumbers.beDistance>=3?"#4ADE80":setupNumbers.beDistance>=1.5?GOLD:"#F87171"}}>{setupNumbers.beDistance.toFixed(1)}%</span>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                        <span style={{fontSize:13}}>🏰</span>
                        <span style={{fontSize:10,color:textSec,fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:700}}>Foso Defensivo</span>
                      </div>
                      <div style={{fontFamily:sans,fontSize:11,color:textPrimary,lineHeight:1.4}}>
                        {scTicker||"El activo"} necesita una {setupNumbers.beDirection} de {setupNumbers.beDistance.toFixed(2)}% para tocar el breakeven
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Estrategia</div>
              <StratPicker value={scoreSt} onChange={v=>{setScoreSt(v);setScoreAnswers({});}}/>
            </div>

            {/* leyenda auto vs manual */}
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:10,border:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:"#38BDF8"}}/>
                <span style={{fontSize:10,fontFamily:sans,color:textSec}}>Auto-calculado</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:GOLD}}/>
                <span style={{fontSize:10,fontFamily:sans,color:textSec}}>Selección manual</span>
              </div>
              <div style={{flex:1}}/>
              <span style={{fontSize:11,color:textSec,fontFamily:mono}}>{scoreRes.answered}/{scoreRes.total}</span>
              <div style={{width:60,height:3,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                <div style={{height:"100%",width:(scoreRes.total?(scoreRes.answered/scoreRes.total)*100:0)+"%",background:GOLD,borderRadius:99,transition:"width 0.3s"}}/>
              </div>
            </div>

            {scoreCrit.map(crit=>{
              const autoKey=scoreSt+"_"+crit.id;
              const isAuto=autoAnswers[autoKey]!==undefined&&scoreAnswers[autoKey]===undefined;
              const isManual=scoreAnswers[autoKey]!==undefined;
              const activeIdx=mergedAnswers[autoKey];
              return(
                <div key={crit.id} style={{background:surfBg,border:"1px solid "+(isAuto?"rgba(56,189,248,0.25)":isManual?"rgba(245,158,11,0.2)":borderClr),borderRadius:16,padding:"16px 18px",position:"relative"}}>
                  {/* Badge auto/manual */}
                  {(isAuto||isManual)&&(
                    <div style={{position:"absolute",top:14,right:14,display:"flex",alignItems:"center",gap:5}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:isAuto?"#38BDF8":GOLD}}/>
                      <span style={{fontSize:9,fontFamily:mono,color:isAuto?"#38BDF8":GOLD,letterSpacing:"0.08em"}}>
                        {isAuto?"AUTO":"MANUAL"}
                      </span>
                    </div>
                  )}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingRight:isAuto||isManual?70:0}}>
                    <span style={{fontSize:13,fontWeight:600,color:textPrimary,fontFamily:sans}}>{crit.label}</span>
                    <span style={{fontSize:10,color:textSec,fontFamily:mono}}>x{crit.w}</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {crit.opts.map((opt,idx)=>{
                      const sel=activeIdx===idx;
                      const isAutoSel=isAuto&&sel;
                      const c=opt.s===3?"#4ADE80":opt.s===2?GOLD:opt.s===1?"rgba(255,255,255,0.4)":"#F87171";
                      return(
                        <button key={idx} onClick={()=>setScoreAnswers(a=>({...a,[autoKey]:idx}))}
                          style={{background:sel?(isAutoSel?"rgba(56,189,248,0.08)":c+"12"):"rgba(255,255,255,0.02)",border:"1px solid "+(sel?(isAutoSel?"rgba(56,189,248,0.4)":c+"60"):borderClr),borderRadius:10,padding:"12px 14px",color:sel?(isAutoSel?"#38BDF8":c):textSec,transition:"all 0.15s",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                          <span style={{fontSize:12,fontFamily:sans,fontWeight:sel?600:400}}>{opt.l}</span>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            {isAutoSel&&<span style={{fontSize:9,fontFamily:mono,color:"#38BDF8",opacity:0.7}}>⚡auto</span>}
                            <span style={{fontSize:10,fontFamily:mono,opacity:0.5}}>{opt.s}/3</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {isAuto&&(
                    <button onClick={()=>setScoreAnswers(a=>{const n={...a};delete n[autoKey];return n;})}
                      style={{marginTop:8,background:"none",border:"none",fontSize:10,fontFamily:sans,color:"rgba(56,189,248,0.4)",cursor:"pointer",padding:0,textDecoration:"underline"}}>
                      Sobrescribir manualmente
                    </button>
                  )}
                </div>
              );
            })}

            {scoreRes.complete&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{background:surfBg,border:"1px solid "+(scoreRes.pct>=85?"rgba(74,222,128,0.35)":scoreRes.pct>=65?"rgba(245,158,11,0.35)":"rgba(248,113,113,0.35)"),borderRadius:18,padding:"22px 24px",display:"flex",alignItems:"center",gap:16}}>
                  <span style={{fontSize:46,fontWeight:700,fontFamily:mono,color:scoreRes.pct>=85?"#4ADE80":scoreRes.pct>=65?GOLD:"#F87171",lineHeight:1}}>{scoreRes.pct}%</span>
                  <div style={{flex:1}}>
                    <p style={{fontSize:15,fontWeight:700,fontFamily:sans,color:scoreRes.pct>=85?"#4ADE80":scoreRes.pct>=65?GOLD:"#F87171",marginBottom:4}}>
                      {scoreRes.pct>=85?"Green light — ejecuta":scoreRes.pct>=65?"Procede con cautela":"No entres"}
                    </p>
                    <p style={{fontSize:11,fontFamily:mono,color:textSec}}>{scoreRes.earned}/{scoreRes.max} pts · {STRATEGIES[scoreSt]?.label}{scTicker?" · "+scTicker:""}</p>
                    <p style={{fontSize:10,fontFamily:mono,color:"rgba(56,189,248,0.5)",marginTop:3}}>
                      {Object.keys(autoAnswers).length} criterios auto-calculados · {Object.keys(scoreAnswers).length} manuales
                    </p>
                  </div>
                  <button onClick={()=>setScoreAnswers({})} style={{background:"rgba(255,255,255,0.06)",border:"1px solid "+borderClr,borderRadius:10,padding:"8px 14px",color:textSec,fontSize:12,fontFamily:sans,WebkitTapHighlightColor:"transparent"}}>Reset</button>
                </div>
                {scTicker?(
                  <button onClick={saveDraft} style={{background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.3)",borderRadius:14,padding:"15px",color:"#A78BFA",fontFamily:sans,fontSize:14,fontWeight:600,width:"100%",WebkitTapHighlightColor:"transparent"}}>
                    Guardar como Draft → ejecutar en Journal
                  </button>
                ):(
                  <div style={{padding:"12px",background:"rgba(255,255,255,0.03)",borderRadius:10,textAlign:"center"}}>
                    <span style={{fontSize:12,color:textSec,fontFamily:sans}}>Agrega un ticker para guardar como draft</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {view==="open"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp 0.35s ease"}}>
            <SectionTitle title="Despliegues Activos" sub={deployments.length+" abiertos · capital en riesgo $"+depCapitalAtRisk.toFixed(0)+" · "+(depUnrealized>=0?"+":"")+"$"+depUnrealized.toFixed(0)+" unrealized"}/>

            {deployments.length===0?(
              <div style={{background:surfBg,border:"1px solid "+borderClr,borderRadius:18,padding:"56px 24px",textAlign:"center"}}>
                <div style={{fontSize:48,marginBottom:16,opacity:0.4}}>🎯</div>
                <p style={{fontSize:14,fontWeight:600,color:textPrimary,fontFamily:sans,marginBottom:8}}>Sin despliegues activos</p>
                <p style={{fontSize:13,color:textSec,fontFamily:sans,lineHeight:1.6,marginBottom:20}}>Crea un draft desde el Scorecard y ejecútalo para empezar a trackear posiciones abiertas.</p>
                <button onClick={()=>setView("scorecard")} style={{background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",border:"none",borderRadius:14,padding:"14px 28px",color:"#000",fontFamily:sans,fontSize:14,fontWeight:700,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>Ir al Scorecard →</button>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {/* Sort by directive urgency: alert > accelerate > extract > hold > unknown */}
                {[...depAnalyses].sort((a,b)=>{
                  const order={alert:0,accelerate:1,extract:2,hold:3,evaluate:0,unknown:4};
                  return (order[a.analysis.directive?.key]??5)-(order[b.analysis.directive?.key]??5);
                }).map(({dep,analysis},i)=>{
                  const s=STRATEGIES[dep.strat]||STRATEGIES.otras;
                  const dir=analysis.directive;
                  return(
                    <div key={dep.id} style={{background:cardBg,border:"1px solid "+(dir?dir.border:borderClr),borderRadius:18,padding:"18px",animation:"fadeUp 0.3s ease "+(i*0.04)+"s both",position:"relative",overflow:"hidden"}}>
                      {/* Barra superior del color de la directiva */}
                      {dir&&<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:dir.color}}/>}

                      {/* Header */}
                      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12,gap:10}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
                            {dep.isHedge&&<span style={{fontSize:13}}>🛡️</span>}
                            <span style={{fontFamily:sans,fontSize:18,fontWeight:800,color:textPrimary,letterSpacing:"-0.02em"}}>{dep.ticker}</span>
                            <Pill label={s.short} color={dep.isHedge?"#94A3B8":s.color} small/>
                            {analysis.dteRemaining!==null&&(
                              <span style={{fontFamily:mono,fontSize:11,color:analysis.dteRemaining<=3?"#F87171":analysis.dteRemaining<=7?GOLD:textSec,fontWeight:700}}>{analysis.dteRemaining}d</span>
                            )}
                          </div>
                          <div style={{fontFamily:mono,fontSize:10,color:textSec}}>
                            {dep.strikes||"—"} · {dep.contracts} contratos · crédito ${parseFloat(dep.initialCredit).toFixed(2)}
                            {dep.score&&" · score "+dep.score+"%"}
                          </div>
                        </div>
                        {analysis.isStale&&(
                          <div title="Más de 24h sin actualizar" style={{padding:"3px 8px",background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:99}}>
                            <span style={{fontFamily:mono,fontSize:9,color:GOLD,fontWeight:700,letterSpacing:"0.06em"}}>⏱ STALE</span>
                          </div>
                        )}
                      </div>

                      {/* Profit y P&L */}
                      {analysis.profitPct!==null?(
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                          <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10}}>
                            <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Profit</div>
                            <div style={{fontFamily:mono,fontSize:22,fontWeight:700,color:analysis.profitPct>=analysis.tpTarget?"#4ADE80":analysis.profitPct>=0?GOLD:"#F87171",lineHeight:1}}>
                              {analysis.profitPct>=0?"+":""}{analysis.profitPct.toFixed(0)}%
                            </div>
                            <div style={{fontSize:9,fontFamily:mono,color:textSec,marginTop:3}}>TP target: {analysis.tpTarget}%</div>
                          </div>
                          <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10}}>
                            <div style={{fontSize:9,color:textSec,fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Unrealized</div>
                            <div style={{fontFamily:mono,fontSize:22,fontWeight:700,color:analysis.unrealizedPnl>=0?"#4ADE80":"#F87171",lineHeight:1}}>
                              {analysis.unrealizedPnl>=0?"+":""}${analysis.unrealizedPnl.toFixed(0)}
                            </div>
                            <div style={{fontSize:9,fontFamily:mono,color:textSec,marginTop:3}}>
                              {analysis.tpAmount!==null&&"objetivo $"+analysis.tpAmount.toFixed(0)}
                            </div>
                          </div>
                        </div>
                      ):(
                        <div style={{padding:"14px",background:"rgba(148,163,184,0.08)",borderRadius:10,border:"1px dashed rgba(148,163,184,0.3)",marginBottom:14,textAlign:"center"}}>
                          <div style={{fontFamily:sans,fontSize:12,color:textSec}}>Actualiza el precio del contrato para ver profit y directiva</div>
                        </div>
                      )}

                      {/* Time progress bar */}
                      {analysis.timePct!==null&&(
                        <div style={{marginBottom:14}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                            <span style={{fontFamily:mono,fontSize:9,color:textSec,letterSpacing:"0.1em",textTransform:"uppercase"}}>Tiempo</span>
                            <span style={{fontFamily:mono,fontSize:10,color:textSec}}>{analysis.daysElapsed}d / {analysis.totalDays}d · {analysis.timePct.toFixed(0)}%</span>
                          </div>
                          <div style={{height:5,background:"rgba(255,255,255,0.05)",borderRadius:99,overflow:"hidden"}}>
                            <div style={{height:"100%",width:analysis.timePct+"%",background:analysis.timePct>80?"#F87171":analysis.timePct>50?GOLD:"#4ADE80",borderRadius:99,transition:"width 0.5s"}}/>
                          </div>
                        </div>
                      )}

                      {/* Métricas avanzadas */}
                      {(analysis.deltaChange!==null||analysis.ivChange!==null||analysis.thetaRatio!==null||analysis.distToShort!==null)&&(
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,marginBottom:14}}>
                          {analysis.deltaChange!==null&&(
                            <div style={{padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:8,border:"1px solid "+borderClr}}>
                              <div style={{fontSize:8,color:textSec,fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>Δ Delta</div>
                              <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:Math.abs(analysis.deltaChange)>50?"#F87171":Math.abs(analysis.deltaChange)>25?GOLD:"#4ADE80"}}>{analysis.deltaChange>0?"+":""}{analysis.deltaChange.toFixed(0)}%</div>
                            </div>
                          )}
                          {analysis.ivChange!==null&&(
                            <div style={{padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:8,border:"1px solid "+borderClr}}>
                              <div style={{fontSize:8,color:textSec,fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>Δ IV</div>
                              <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:analysis.ivChange<=-25?"#4ADE80":analysis.ivChange>=25?"#F87171":textPrimary}}>{analysis.ivChange>0?"+":""}{analysis.ivChange.toFixed(0)}%</div>
                            </div>
                          )}
                          {analysis.thetaRatio!==null&&(
                            <div style={{padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:8,border:"1px solid "+borderClr}}>
                              <div style={{fontSize:8,color:textSec,fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>Theta vs Esp.</div>
                              <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:analysis.thetaRatio>=100?"#4ADE80":analysis.thetaRatio>=60?GOLD:"#F87171"}}>{analysis.thetaRatio.toFixed(0)}%</div>
                            </div>
                          )}
                          {analysis.distToShort!==null&&(
                            <div style={{padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:8,border:"1px solid "+borderClr}}>
                              <div style={{fontSize:8,color:textSec,fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>Foso</div>
                              <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:Math.abs(analysis.distToShort)>2.5?"#4ADE80":Math.abs(analysis.distToShort)>1.5?GOLD:"#F87171"}}>{Math.abs(analysis.distToShort).toFixed(1)}%</div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Directiva */}
                      {dir&&(
                        <div style={{padding:"14px 16px",background:dir.bg,border:"1px solid "+dir.border,borderRadius:12,marginBottom:analysis.signals.length>0?12:14}}>
                          <div style={{fontFamily:sans,fontSize:13,fontWeight:800,color:dir.color,letterSpacing:"-0.01em",marginBottom:4}}>
                            {dir.title}
                          </div>
                          <div style={{fontFamily:sans,fontSize:12,color:textSec,lineHeight:1.5}}>{dir.sub}</div>
                        </div>
                      )}

                      {/* Señales acumuladas */}
                      {analysis.signals.length>0&&(
                        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
                          {analysis.signals.map((sig,si)=>(
                            <div key={si} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:sig.type==="pos"?"rgba(74,222,128,0.05)":sig.type==="neg"?"rgba(248,113,113,0.05)":"rgba(245,158,11,0.05)",borderRadius:8}}>
                              <span style={{fontSize:11}}>{sig.icon}</span>
                              <span style={{fontFamily:sans,fontSize:11,color:textPrimary,flex:1}}>{sig.text}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Acciones */}
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>setUpdatingDep(dep)} style={{flex:1,background:"rgba(56,189,248,0.1)",border:"1px solid rgba(56,189,248,0.3)",borderRadius:12,padding:"12px",color:"#38BDF8",fontFamily:sans,fontSize:13,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>↻ Actualizar</button>
                        <button onClick={()=>setClosingDep(dep)} style={{flex:1,background:"linear-gradient(135deg,"+GOLD+","+GOLD2+")",border:"none",borderRadius:12,padding:"12px",color:"#000",fontFamily:sans,fontSize:13,fontWeight:700,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>Cerrar</button>
                        <button onClick={()=>{if(confirm("¿Eliminar este despliegue sin registrarlo?"))deleteDeployment(dep.id);}} style={{background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:12,padding:"12px 14px",color:"rgba(248,113,113,0.7)",fontFamily:sans,fontSize:13,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>✕</button>
                      </div>

                      {dep.lastUpdate&&(
                        <div style={{marginTop:10,fontFamily:mono,fontSize:9,color:textSec,textAlign:"center"}}>
                          Actualizado hace {(()=>{const h=(Date.now()-new Date(dep.lastUpdate).getTime())/3600000;return h<1?"<1h":h<24?Math.floor(h)+"h":Math.floor(h/24)+"d";})()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view==="insights"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12,animation:"fadeUp 0.35s ease"}}>
            <SectionTitle title="Insights" sub="Patrones detectados en tu historial"/>
            {sysIns.length===0?(
              <div style={{background:surfBg,border:"1px solid "+borderClr,borderRadius:18,padding:"56px 24px",textAlign:"center"}}>
                <div style={{fontSize:48,marginBottom:16,opacity:0.4}}>🔍</div>
                <p style={{fontSize:14,fontWeight:600,color:textPrimary,fontFamily:sans,marginBottom:8}}>Sin insights aún</p>
                <p style={{fontSize:13,color:textSec,fontFamily:sans,lineHeight:1.6}}>Agrega más trades para desbloquear detección de patrones.</p>
              </div>
            ):sysIns.map((ins,i)=>(
              <div key={i} style={{display:"flex",gap:14,padding:"18px 20px",background:ins.tone==="pos"?"rgba(74,222,128,0.06)":ins.tone==="neg"?"rgba(248,113,113,0.06)":"rgba(255,255,255,0.03)",borderLeft:"3px solid "+(ins.tone==="pos"?"#4ADE80":ins.tone==="neg"?"#F87171":GOLD),borderRadius:"0 14px 14px 0",animation:"fadeUp 0.3s ease "+(i*0.05)+"s both"}}>
                <div>
                  <p style={{fontSize:14,fontWeight:700,fontFamily:sans,color:ins.tone==="pos"?"#4ADE80":ins.tone==="neg"?"#F87171":textPrimary,marginBottom:5}}>{ins.title}</p>
                  <p style={{fontSize:13,fontFamily:sans,color:textSec,lineHeight:1.6}}>{ins.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {view!=="splash"&&<BottomNav view={view} setView={v=>{setView(v);setCalDay(null);}} drafts={drafts} depAlertCount={depAlertCount}/>}

      {selected&&(
        <div onClick={()=>setSelected(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:50,padding:0}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"85vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
            <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                  <p style={{fontSize:28,fontWeight:800,color:"#fff",fontFamily:sans,letterSpacing:"-0.03em"}}>{selected.ticker}</p>
                  {selected.isHedge&&(
                    <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",background:"rgba(148,163,184,0.12)",border:"1px solid rgba(148,163,184,0.3)",borderRadius:99}}>
                      <span style={{fontSize:11}}>🛡️</span>
                      <span style={{fontFamily:mono,fontSize:9,fontWeight:700,color:"#CBD5E1",letterSpacing:"0.08em",textTransform:"uppercase"}}>Cobertura</span>
                    </div>
                  )}
                </div>
                <p style={{fontSize:12,color:"rgba(255,255,255,0.35)",fontFamily:mono}}>
                  {fmtDate(selected.date)}{selected.expiry?" → "+fmtDate(selected.expiry)+" · "+dteDays(selected.date,selected.expiry)+"d":""} · {STRATEGIES[selected.strat]?.label}
                </p>
              </div>
              <button onClick={()=>setSelected(null)} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.4)",fontSize:18,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:selected.notes?18:0}}>
              <SC label="P&L" value={(selected.pnl>0?"+":"")+"$"+selected.pnl.toFixed(2)} color={selected.pnl>0?"#4ADE80":selected.pnl<0?"#F87171":"#fff"}/>
              <SC label="Retorno" value={(selected.pct>0?"+":"")+(selected.pct||0).toFixed(1)+"%"} color={selected.pct>0?"#4ADE80":selected.pct<0?"#F87171":"#fff"}/>
              {selected.strikes&&<SC label="Strikes" value={selected.strikes}/>}
              {selected.premium&&<SC label="Prima" value={"$"+selected.premium}/>}
              {selected.contracts&&<SC label="Contratos" value={selected.contracts}/>}
              {(selected.ivr!==""&&selected.ivr!==null)&&<SC label="IVR" value={selected.ivr+"%"}/>}
              {selected.score&&<SC label="Score" value={String(selected.score)} color={selected.score>=85?"#4ADE80":selected.score>=65?GOLD:"#F87171"}/>}
            </div>
            {selected.notes&&(
              <div style={{padding:"16px",background:"rgba(255,255,255,0.04)",borderRadius:12,border:"1px solid rgba(255,255,255,0.07)",marginTop:10}}>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Notas</div>
                <p style={{fontSize:13,fontFamily:sans,color:"rgba(255,255,255,0.7)",lineHeight:1.7}}>{selected.notes}</p>
              </div>
            )}
            <div style={{display:"flex",gap:10,marginTop:18}}>
              <button onClick={()=>{openEdit(selected);setSelected(null);setView("trades");}} style={{flex:1,background:"rgba(56,189,248,0.08)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:12,padding:"13px",color:"#38BDF8",fontFamily:sans,fontSize:13,fontWeight:600,WebkitTapHighlightColor:"transparent"}}>✎ Editar</button>
              {confirmDel===selected.id?(
                <div style={{display:"flex",gap:8,flex:1}}>
                  <button onClick={()=>deleteTrade(selected.id)} style={{flex:1,background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:12,padding:"13px",color:"#F87171",fontFamily:sans,fontSize:13,fontWeight:600,WebkitTapHighlightColor:"transparent"}}>Sí, borrar</button>
                  <button onClick={()=>setConfirmDel(null)} style={{flex:1,background:"transparent",border:"1px solid "+borderClr,borderRadius:12,padding:"13px",color:textSec,fontFamily:sans,fontSize:13,WebkitTapHighlightColor:"transparent"}}>Cancelar</button>
                </div>
              ):(
                <button onClick={()=>setConfirmDel(selected.id)} style={{background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.15)",borderRadius:12,padding:"13px 18px",color:"rgba(248,113,113,0.7)",fontFamily:sans,fontSize:13,WebkitTapHighlightColor:"transparent"}}>✕</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Ejecutar Draft como Despliegue ─────────────────────────── */}
      {executingDraft&&(
        <div onClick={()=>setExecutingDraft(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60,padding:0}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
            <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
              <div>
                <p style={{fontSize:18,fontWeight:800,color:"#fff",fontFamily:sans,marginBottom:3}}>Ejecutar Despliegue</p>
                <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",fontFamily:mono}}>{executingDraft.ticker} · {STRATEGIES[executingDraft.strat]?.label} · score {executingDraft.score}%</p>
              </div>
              <button onClick={()=>setExecutingDraft(null)} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
            </div>

            <div style={{padding:"12px 14px",background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:10,marginBottom:16}}>
              <div style={{fontSize:11,fontFamily:sans,color:GOLD2,marginBottom:5,fontWeight:600}}>Datos del draft</div>
              <div style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.7)"}}>
                Strikes: {executingDraft.strikes||"—"} · Expira: {executingDraft.expiry||"—"} · IVR: {executingDraft.ivr||"—"}%
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <FInput label="Crédito real $" value={executeForm.credit} onChange={v=>setExecuteForm(f=>({...f,credit:v}))} type="number" placeholder="0.67"/>
              <FInput label="Contratos" value={executeForm.contracts} onChange={v=>setExecuteForm(f=>({...f,contracts:v}))} type="number"/>
            </div>

            <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,marginTop:14}}>Coordenadas de entrada (opcional pero recomendado)</div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
              <FInput label="Δ Delta short" value={executeForm.entryDelta} onChange={v=>setExecuteForm(f=>({...f,entryDelta:v}))} type="number" placeholder="0.20"/>
              <FInput label="IV %" value={executeForm.entryIv} onChange={v=>setExecuteForm(f=>({...f,entryIv:v}))} type="number" placeholder="35" suffix="%"/>
              <FInput label="Spot $" value={executeForm.entrySpot} onChange={v=>setExecuteForm(f=>({...f,entrySpot:v}))} type="number" placeholder="605"/>
            </div>

            <button onClick={()=>setExecuteForm(f=>({...f,isHedge:!f.isHedge}))} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"11px 14px",background:executeForm.isHedge?"rgba(148,163,184,0.1)":"rgba(255,255,255,0.02)",border:"1px solid "+(executeForm.isHedge?"rgba(148,163,184,0.35)":"rgba(255,255,255,0.08)"),borderRadius:12,cursor:"pointer",marginBottom:16,WebkitTapHighlightColor:"transparent"}}>
              <div style={{width:34,height:20,borderRadius:10,background:executeForm.isHedge?"#94A3B8":"rgba(255,255,255,0.1)",position:"relative",transition:"background 0.2s",flexShrink:0}}>
                <div style={{position:"absolute",top:2,left:executeForm.isHedge?16:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
              </div>
              <span style={{fontSize:13,color:executeForm.isHedge?"#CBD5E1":"#fff",fontFamily:sans,fontWeight:600}}>🛡️ Marcar como cobertura</span>
            </button>

            <button onClick={confirmExecuteDraft} disabled={!executeForm.credit||parseFloat(executeForm.credit)<=0}
              style={{width:"100%",background:executeForm.credit&&parseFloat(executeForm.credit)>0?"linear-gradient(135deg,"+GOLD+","+GOLD2+")":"rgba(255,255,255,0.06)",border:"none",borderRadius:14,padding:"15px",color:executeForm.credit&&parseFloat(executeForm.credit)>0?"#000":"rgba(255,255,255,0.3)",fontFamily:sans,fontSize:14,fontWeight:800,cursor:executeForm.credit?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>
              Confirmar Despliegue Activo →
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Actualizar Despliegue ──────────────────────────────────── */}
      {updatingDep&&(
        <UpdateDeploymentModal dep={updatingDep} onClose={()=>setUpdatingDep(null)} onSave={updates=>{updateDeployment(updatingDep.id,updates);setUpdatingDep(null);}}/>
      )}

      {/* ── Modal: Cerrar Despliegue ──────────────────────────────────────── */}
      {closingDep&&(
        <CloseDeploymentModal dep={closingDep} onClose={()=>setClosingDep(null)} onConfirm={(finalPnl,closeDate,notes)=>closeDeployment(closingDep,finalPnl,closeDate,notes)}/>
      )}

      {showImport&&<ImportModal onClose={()=>setShowImport(false)} onImport={t=>{importTrades(t);setShowImport(false);}}/>}
      {showQuickCalc&&<QuickCalcModal onClose={()=>setShowQuickCalc(false)}/>}
      {showPasteAI&&<PasteFromAIModal onClose={()=>setShowPasteAI(false)} onConfirm={handlePasteAI}/>}

      {confirmRestoreFile&&(
        <div onClick={()=>setConfirmRestoreFile(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:80,padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(245,158,11,0.3)",borderRadius:18,maxWidth:420,width:"100%",padding:"24px"}}>
            <div style={{fontSize:32,textAlign:"center",marginBottom:12}}>♻️</div>
            <p style={{fontFamily:sans,fontSize:17,fontWeight:800,color:"#fff",textAlign:"center",marginBottom:8}}>Restaurar respaldo</p>
            <p style={{fontFamily:sans,fontSize:13,color:"rgba(255,255,255,0.55)",textAlign:"center",lineHeight:1.5,marginBottom:6}}>
              Esto reemplazará <b style={{color:"#FCD34D"}}>todos</b> los datos actuales (trades, despliegues, capital) con los del archivo.
            </p>
            <p style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.4)",textAlign:"center",marginBottom:20}}>{confirmRestoreFile.name}</p>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setConfirmRestoreFile(null)} style={{flex:1,padding:"13px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,color:"rgba(255,255,255,0.7)",fontFamily:sans,fontSize:14,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>Cancelar</button>
              <button onClick={()=>{restoreBackup(confirmRestoreFile);setConfirmRestoreFile(null);}} style={{flex:1,padding:"13px",background:"linear-gradient(135deg,#F59E0B,#FCD34D)",border:"none",borderRadius:12,color:"#1A1206",fontFamily:sans,fontSize:14,fontWeight:700,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>Restaurar</button>
            </div>
          </div>
        </div>
      )}

      {restoreMsg&&(
        <div onClick={()=>setRestoreMsg(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:80,padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid "+(restoreMsg.ok?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"),borderRadius:18,maxWidth:400,width:"100%",padding:"24px",textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:12}}>{restoreMsg.ok?"✅":"⚠️"}</div>
            <p style={{fontFamily:sans,fontSize:14,color:restoreMsg.ok?"#4ADE80":"#F87171",lineHeight:1.5,marginBottom:18}}>{restoreMsg.text}</p>
            <button onClick={()=>setRestoreMsg(null)} style={{width:"100%",padding:"13px",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:12,color:"#fff",fontFamily:sans,fontSize:14,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>Entendido</button>
          </div>
        </div>
      )}
      {showConstitution&&<ConstitucionScreen onClose={()=>setShowConstitution(false)}/>}
      {showCapitalSetup&&<CapitalSetupModal onClose={()=>setShowCapitalSetup(false)} onSetup={setupCapital}/>}
      {movingCapital&&<MoveCapitalModal onClose={()=>setMovingCapital(false)} onMove={moveCapital} capital={capital}/>}
      {showAddStock&&<AddStockModal onClose={()=>setShowAddStock(false)} onAdd={addStock}/>}
      {addingSharesId&&capital&&(()=>{const s=(capital.stocks||[]).find(x=>x.id===addingSharesId);return s?<AddSharesModal stock={s} onClose={()=>setAddingSharesId(null)} onAdd={addSharesToPosition}/>:null;})()}
      {updatingStockId&&capital&&(()=>{const s=(capital.stocks||[]).find(x=>x.id===updatingStockId);return s?<UpdateStockPriceModal stock={s} onClose={()=>setUpdatingStockId(null)} onUpdate={updateStockPrice}/>:null;})()}
      {closingStock&&<CloseStockModal stock={closingStock} onClose={()=>setClosingStock(null)} onConfirm={closeStockPosition}/>}
      {showCapital&&capitalMetrics&&(
        <div onClick={()=>setShowCapital(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0E1420",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,minHeight:"94vh",maxHeight:"96vh",overflowY:"auto",padding:"0 20px 40px",animation:"slideUp 0.3s ease"}}>
            <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"12px auto 20px"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:24}}>🏛️</span>
                <div>
                  <p style={{fontSize:19,fontWeight:800,color:"#fff",fontFamily:sans}}>Gestión de Capital</p>
                  <p style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:mono}}>desde {capitalMetrics.setupDate}</p>
                </div>
              </div>
              <button onClick={()=>setShowCapital(false)} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,width:36,height:36,color:"rgba(255,255,255,0.5)",fontSize:18,cursor:"pointer"}}>✕</button>
            </div>

            {/* Capital Total */}
            <div style={{padding:"20px",background:"linear-gradient(135deg,rgba(245,158,11,0.1),rgba(252,211,77,0.04))",border:"1px solid rgba(245,158,11,0.3)",borderRadius:16,marginBottom:14,textAlign:"center"}}>
              <div style={{fontSize:10,color:"rgba(245,158,11,0.7)",fontFamily:mono,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>Capital Total</div>
              <div style={{fontFamily:mono,fontSize:36,fontWeight:800,color:"#FCD34D",lineHeight:1}}>${capitalMetrics.total.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              <div style={{marginTop:8,fontSize:12,fontFamily:mono,color:capitalMetrics.growthTotal>=0?"#4ADE80":"#F87171"}}>
                {capitalMetrics.growthTotal>=0?"+":""}${capitalMetrics.growthTotal.toLocaleString(undefined,{maximumFractionDigits:0})} ({capitalMetrics.growthTotalPct>=0?"+":""}{capitalMetrics.growthTotalPct.toFixed(1)}%) desde inicio
              </div>
            </div>

            {/* Capital Operativo */}
            <div style={{padding:"16px",background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:14,marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:18}}>💰</span>
                  <span style={{fontFamily:sans,fontSize:14,fontWeight:700,color:"#FCD34D"}}>Capital Operativo</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:"#fff"}}>${capitalMetrics.operativo.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                  <div style={{fontFamily:mono,fontSize:10,color:capitalMetrics.opGrowth>=0?"#4ADE80":"#F87171"}}>{capitalMetrics.opGrowth>=0?"↑":"↓"} {capitalMetrics.opGrowthPct>=0?"+":""}{capitalMetrics.opGrowthPct.toFixed(1)}%</div>
                </div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1,padding:"10px 12px",background:"rgba(56,189,248,0.08)",borderRadius:9}}>
                  <div style={{fontSize:8,color:"rgba(56,189,248,0.7)",fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:3}}>Desplegado</div>
                  <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:"#38BDF8"}}>${capitalMetrics.deployed.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                </div>
                <div style={{flex:1,padding:"10px 12px",background:"rgba(74,222,128,0.08)",borderRadius:9}}>
                  <div style={{fontSize:8,color:"rgba(74,222,128,0.7)",fontFamily:mono,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:3}}>Disponible</div>
                  <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:capitalMetrics.available>=0?"#4ADE80":"#F87171"}}>${capitalMetrics.available.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                </div>
              </div>
            </div>

            {/* Patrimonio — con acciones individuales */}
            <div style={{padding:"16px",background:"rgba(56,189,248,0.06)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:14,marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:18}}>📊</span>
                  <span style={{fontFamily:sans,fontSize:14,fontWeight:700,color:"#38BDF8"}}>Patrimonio</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:"#fff"}}>${capitalMetrics.patrimonio.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                  <div style={{fontFamily:mono,fontSize:10,color:capitalMetrics.patGrowth>=0?"#4ADE80":"#F87171"}}>{capitalMetrics.patGrowth>=0?"↑":"↓"} {capitalMetrics.patGrowthPct>=0?"+":""}{capitalMetrics.patGrowthPct.toFixed(1)}%</div>
                </div>
              </div>

              {/* Acciones individuales */}
              {capitalMetrics.stocks.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
                  {capitalMetrics.stocks.map(s=>{
                    const val=s.shares*s.currentPrice;
                    const gl=(s.currentPrice-s.entryPrice)*s.shares;
                    const glPct=s.entryPrice>0?((s.currentPrice-s.entryPrice)/s.entryPrice)*100:0;
                    return(
                      <div key={s.id} style={{padding:"12px 13px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:"1px solid rgba(255,255,255,0.06)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontFamily:mono,fontSize:14,fontWeight:700,color:"#fff"}}>{s.ticker}</span>
                            <span style={{fontSize:10,fontFamily:mono,color:"rgba(255,255,255,0.4)"}}>{s.shares} acc</span>
                          </div>
                          <span style={{fontFamily:mono,fontSize:14,fontWeight:700,color:"#38BDF8"}}>${val.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{display:"flex",gap:12}}>
                            <span style={{fontSize:10,fontFamily:mono,color:"rgba(255,255,255,0.35)"}}>entrada ${s.entryPrice.toFixed(2)}</span>
                            <span style={{fontSize:10,fontFamily:mono,color:"rgba(255,255,255,0.5)"}}>actual ${s.currentPrice.toFixed(2)}</span>
                          </div>
                          <span style={{fontFamily:mono,fontSize:11,fontWeight:700,color:gl>=0?"#4ADE80":"#F87171"}}>{gl>=0?"+":""}${gl.toFixed(0)} ({glPct>=0?"+":""}{glPct.toFixed(1)}%)</span>
                        </div>
                        <div style={{display:"flex",gap:6,marginTop:8}}>
                          <button onClick={()=>setAddingSharesId(s.id)} style={{flex:1,padding:"7px",background:"rgba(74,222,128,0.08)",border:"1px solid rgba(74,222,128,0.2)",borderRadius:8,color:"#4ADE80",fontFamily:sans,fontSize:11,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>+ Acciones</button>
                          <button onClick={()=>setUpdatingStockId(s.id)} style={{flex:1,padding:"7px",background:"rgba(56,189,248,0.08)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:8,color:"#38BDF8",fontFamily:sans,fontSize:11,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>↻ Precio</button>
                          <button onClick={()=>setClosingStock(s)} style={{flex:1,padding:"7px",background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:8,color:GOLD,fontFamily:sans,fontSize:11,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>✕ Cerrar</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Cash no trackeado */}
              {capitalMetrics.patrimonioCash>0&&(
                <div style={{padding:"8px 12px",background:"rgba(255,255,255,0.02)",borderRadius:8,display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:11,fontFamily:sans,color:"rgba(255,255,255,0.4)"}}>Otros / efectivo</span>
                  <span style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.5)"}}>${capitalMetrics.patrimonioCash.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
                </div>
              )}

              <button onClick={()=>setShowAddStock(true)} style={{width:"100%",padding:"10px",background:"rgba(56,189,248,0.06)",border:"1px dashed rgba(56,189,248,0.3)",borderRadius:10,color:"#38BDF8",fontFamily:sans,fontSize:13,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                + Agregar posición
              </button>
            </div>

            {/* Bóveda */}
            <div style={{padding:"16px",background:"rgba(148,163,184,0.06)",border:"1px solid rgba(148,163,184,0.2)",borderRadius:14,marginBottom:18,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:18}}>🏦</span>
                <span style={{fontFamily:sans,fontSize:14,fontWeight:700,color:"#CBD5E1"}}>Bóveda</span>
              </div>
              <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:"#fff"}}>${capitalMetrics.boveda.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
            </div>

            {/* ── PANEL DE RIESGO & DIVERSIFICACIÓN ── */}
            {riskMetrics&&(
              <div style={{padding:"16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,marginBottom:18}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>🛡️</span>
                    <span style={{fontFamily:sans,fontSize:14,fontWeight:700,color:"#fff"}}>Riesgo & Diversificación</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:8,background:riskMetrics.light+"1A",border:"1px solid "+riskMetrics.light+"55"}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:riskMetrics.light,boxShadow:"0 0 8px "+riskMetrics.light}}/>
                    <span style={{fontFamily:mono,fontSize:10,fontWeight:600,color:riskMetrics.light}}>{riskMetrics.lightTxt}</span>
                  </div>
                </div>

                {riskMetrics.items.length===0?(
                  <div style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.4)",textAlign:"center",padding:"12px 0"}}>Sin posiciones abiertas para analizar</div>
                ):(
                <>
                  {/* Exposición de mercado β-ajustada */}
                  <div style={{padding:"14px",background:"rgba(245,158,11,0.05)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:12,marginBottom:10,textAlign:"center"}}>
                    <div style={{fontSize:9,color:"rgba(245,158,11,0.7)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Exposición de mercado (β-ajustada)</div>
                    <div style={{fontFamily:mono,fontSize:24,fontWeight:700,color:riskMetrics.totalExpo>=0?"#4ADE80":"#F87171"}}>{riskMetrics.totalExpo>=0?"+":"−"}${Math.abs(riskMetrics.totalExpo).toLocaleString(undefined,{maximumFractionDigits:0})}<span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}> / 1% SPY</span></div>
                    <div style={{fontFamily:mono,fontSize:10,color:"rgba(255,255,255,0.5)",marginTop:3}}>{riskMetrics.expoPctTotal.toFixed(1)}% del capital · {riskMetrics.totalExpo>=0?"sesgo alcista":"sesgo bajista"}</div>
                  </div>

                  {/* Theta agregada (ingreso diario) */}
                  <div style={{display:"flex",gap:8,marginBottom:10}}>
                    <div style={{flex:1,padding:"12px",background:"rgba(74,222,128,0.05)",border:"1px solid rgba(74,222,128,0.2)",borderRadius:12,textAlign:"center"}}>
                      <div style={{fontSize:8,color:"rgba(74,222,128,0.7)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Theta diaria (est.)</div>
                      <div style={{fontFamily:mono,fontSize:17,fontWeight:700,color:riskMetrics.totalTheta>=0?"#4ADE80":"#F87171"}}>{riskMetrics.totalTheta>=0?"+":"−"}${Math.abs(riskMetrics.totalTheta).toLocaleString(undefined,{maximumFractionDigits:0})}<span style={{fontSize:10,color:"rgba(255,255,255,0.4)"}}>/día</span></div>
                    </div>
                    <div style={{flex:1,padding:"12px",background:"rgba(245,158,11,0.05)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:12,textAlign:"center"}}>
                      <div style={{fontSize:8,color:"rgba(245,158,11,0.7)",fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>Theta / mes (est.)</div>
                      <div style={{fontFamily:mono,fontSize:17,fontWeight:700,color:riskMetrics.totalTheta>=0?"#FCD34D":"#F87171"}}>{riskMetrics.totalTheta>=0?"+":"−"}${Math.abs(riskMetrics.totalTheta*30).toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                    </div>
                  </div>

                  {/* Escenarios de caída */}
                  <div style={{display:"flex",gap:6,marginBottom:12}}>
                    {[1,2,3].map(m=>(
                      <div key={m} style={{flex:1,padding:"9px 6px",background:"rgba(248,113,133,0.06)",borderRadius:9,textAlign:"center"}}>
                        <div style={{fontSize:8,color:"rgba(248,113,133,0.7)",fontFamily:mono,letterSpacing:"0.06em",marginBottom:3}}>SPY −{m}%</div>
                        <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:"#F87171"}}>−${Math.abs(riskMetrics.totalExpo*m).toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                      </div>
                    ))}
                  </div>

                  {/* Sesgo direccional */}
                  <div style={{marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                      <span style={{fontSize:9,fontFamily:mono,color:"#4ADE80",letterSpacing:"0.06em"}}>ALCISTA {riskMetrics.bullPct.toFixed(0)}%</span>
                      <span style={{fontSize:9,fontFamily:mono,color:"#F87171",letterSpacing:"0.06em"}}>{(100-riskMetrics.bullPct).toFixed(0)}% BAJISTA</span>
                    </div>
                    <div style={{height:8,borderRadius:4,overflow:"hidden",display:"flex",background:"rgba(248,113,133,0.25)"}}>
                      <div style={{width:riskMetrics.bullPct+"%",background:"#4ADE80"}}/>
                    </div>
                  </div>

                  {/* Concentración por sector */}
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Concentración por sector</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                    {riskMetrics.sectors.slice(0,5).map(s=>(
                      <div key={s.sector} style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.7)",width:95,flexShrink:0}}>{s.sector}</span>
                        <div style={{flex:1,height:6,borderRadius:3,background:"rgba(255,255,255,0.05)",overflow:"hidden"}}>
                          <div style={{width:s.pct+"%",height:"100%",background:s.pct>60?"#F87171":s.pct>40?"#FCD34D":"#38BDF8"}}/>
                        </div>
                        <span style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.6)",width:36,textAlign:"right"}}>{s.pct.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Concentración por nombre */}
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Concentración por nombre</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                    {riskMetrics.names.slice(0,6).map(nm=>(
                      <div key={nm.ticker} style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.75)",width:60,flexShrink:0}}>{nm.ticker}</span>
                        <div style={{flex:1,height:6,borderRadius:3,background:"rgba(255,255,255,0.05)",overflow:"hidden"}}>
                          <div style={{width:nm.pct+"%",height:"100%",background:nm.pct>40?"#F87171":nm.pct>25?"#FCD34D":"#4ADE80"}}/>
                        </div>
                        <span style={{fontFamily:mono,fontSize:11,color:"rgba(255,255,255,0.6)",width:36,textAlign:"right"}}>{nm.pct.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Delta cruda referencia */}
                  <div style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",background:"rgba(255,255,255,0.02)",borderRadius:8,marginBottom:8}}>
                    <span style={{fontSize:10,fontFamily:mono,color:"rgba(255,255,255,0.4)"}}>Delta agregada (cruda)</span>
                    <span style={{fontFamily:mono,fontSize:11,color:riskMetrics.rawDelta>=0?"#4ADE80":"#F87171"}}>{riskMetrics.rawDelta>=0?"+":""}{riskMetrics.rawDelta.toFixed(0)} Δ</span>
                  </div>

                  {/* Desglose de delta por posición (plegable) */}
                  <button onClick={()=>setShowRiskDetail(v=>!v)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",background:"rgba(245,158,11,0.05)",border:"1px solid rgba(245,158,11,0.18)",borderRadius:8,marginBottom:8,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                    <span style={{fontSize:10,fontFamily:mono,color:"rgba(252,211,77,0.8)",letterSpacing:"0.06em"}}>APORTE DE DELTA POR POSICIÓN</span>
                    <span style={{fontSize:12,color:"rgba(255,255,255,0.4)",transform:showRiskDetail?"rotate(180deg)":"none",transition:"transform 0.2s",display:"inline-block"}}>▾</span>
                  </button>
                  {showRiskDetail&&(
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
                      {[...riskMetrics.items].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).map((it,i)=>{
                        const maxAbs=Math.max(...riskMetrics.items.map(x=>Math.abs(x.delta)),1);
                        const w=Math.abs(it.delta)/maxAbs*100;
                        return(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"rgba(255,255,255,0.02)",borderRadius:8}}>
                            <div style={{width:88,flexShrink:0}}>
                              <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.8)"}}>{it.ticker}</span>
                              <span style={{fontFamily:mono,fontSize:8,color:"rgba(255,255,255,0.4)",marginLeft:5}}>{it.kind}</span>
                            </div>
                            <div style={{flex:1,height:5,borderRadius:3,background:"rgba(255,255,255,0.04)",overflow:"hidden",display:"flex",justifyContent:it.delta>=0?"flex-start":"flex-end"}}>
                              <div style={{width:w+"%",height:"100%",background:it.delta>=0?"#4ADE80":"#F87171"}}/>
                            </div>
                            <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:it.delta>=0?"#4ADE80":"#F87171",width:52,textAlign:"right"}}>{it.delta>=0?"+":""}{it.delta.toFixed(0)} Δ</span>
                          </div>
                        );
                      })}
                      <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:mono,textAlign:"center",marginTop:2}}>Ordenado por mayor aporte · verde alcista · rojo bajista</div>
                    </div>
                  )}

                  {/* Desglose de exposición $ por posición (plegable) */}
                  <button onClick={()=>setShowExpoDetail(v=>!v)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",background:"rgba(56,189,248,0.05)",border:"1px solid rgba(56,189,248,0.18)",borderRadius:8,marginBottom:8,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                    <span style={{fontSize:10,fontFamily:mono,color:"rgba(56,189,248,0.85)",letterSpacing:"0.06em"}}>EXPOSICIÓN $ POR POSICIÓN (1% SPY)</span>
                    <span style={{fontSize:12,color:"rgba(255,255,255,0.4)",transform:showExpoDetail?"rotate(180deg)":"none",transition:"transform 0.2s",display:"inline-block"}}>▾</span>
                  </button>
                  {showExpoDetail&&(
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
                      {[...riskMetrics.items].sort((a,b)=>Math.abs(b.expo)-Math.abs(a.expo)).map((it,i)=>{
                        const maxAbs=Math.max(...riskMetrics.items.map(x=>Math.abs(x.expo)),1);
                        const w=Math.abs(it.expo)/maxAbs*100;
                        return(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"rgba(255,255,255,0.02)",borderRadius:8}}>
                            <div style={{width:88,flexShrink:0}}>
                              <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.8)"}}>{it.ticker}</span>
                              <span style={{fontFamily:mono,fontSize:8,color:"rgba(255,255,255,0.4)",marginLeft:5}}>{it.kind}</span>
                            </div>
                            <div style={{flex:1,height:5,borderRadius:3,background:"rgba(255,255,255,0.04)",overflow:"hidden",display:"flex",justifyContent:it.expo>=0?"flex-start":"flex-end"}}>
                              <div style={{width:w+"%",height:"100%",background:"#38BDF8"}}/>
                            </div>
                            <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:"#38BDF8",width:52,textAlign:"right"}}>{it.expo>=0?"+":"−"}${Math.abs(it.expo).toFixed(0)}</span>
                          </div>
                        );
                      })}
                      <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:mono,textAlign:"center",marginTop:2}}>Cuánto $ mueve cada posición si SPY se mueve 1%</div>
                    </div>
                  )}

                  <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:mono,lineHeight:1.5,textAlign:"center"}}>Estimado por tipo y moneyness · ajusta el delta en cada despliegue para mayor precisión</div>
                </>
                )}
              </div>
            )}

            {/* ── HISTÓRICOS (se construyen al abrir esta pantalla) ── */}
            {capital.snapshots&&capital.snapshots.length>0&&(
              <>
                {/* Histórico de delta agregada */}
                <div style={{padding:"16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <span style={{fontFamily:sans,fontSize:13,fontWeight:700,color:"#fff"}}>📈 Histórico de Delta</span>
                    <span style={{fontFamily:mono,fontSize:10,color:"rgba(255,255,255,0.4)"}}>{capital.snapshots.length} {capital.snapshots.length===1?"día":"días"}</span>
                  </div>
                  <MiniChart showZero series={[{name:"delta",color:"#F59E0B",values:capital.snapshots.map(s=>s.rawDelta)}]}/>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:mono,textAlign:"center",marginTop:6}}>¿Tu sesgo direccional crece o se equilibra?</div>
                </div>

                {/* Mini equity por compartimento */}
                <div style={{padding:"16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,marginBottom:18}}>
                  <div style={{marginBottom:10}}>
                    <span style={{fontFamily:sans,fontSize:13,fontWeight:700,color:"#fff"}}>📊 Equity por compartimento</span>
                  </div>
                  <MiniChart series={[
                    {name:"Operativo",color:"#FCD34D",values:capital.snapshots.map(s=>s.op)},
                    {name:"Patrimonio",color:"#38BDF8",values:capital.snapshots.map(s=>s.pat)},
                    {name:"Bóveda",color:"#94A3B8",values:capital.snapshots.map(s=>s.bov)},
                  ]}/>
                  <div style={{display:"flex",gap:14,justifyContent:"center",marginTop:8}}>
                    <span style={{fontFamily:mono,fontSize:9,color:"#FCD34D"}}>● Operativo</span>
                    <span style={{fontFamily:mono,fontSize:9,color:"#38BDF8"}}>● Patrimonio</span>
                    <span style={{fontFamily:mono,fontSize:9,color:"#94A3B8"}}>● Bóveda</span>
                  </div>
                </div>
              </>
            )}

            <div style={{display:"flex",gap:10,marginBottom:18}}>
              <button onClick={()=>setMovingCapital(true)} style={{flex:1,padding:"14px",background:"linear-gradient(135deg,#F59E0B,#FCD34D)",border:"none",borderRadius:12,color:"#1A1206",fontFamily:sans,fontSize:14,fontWeight:700,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>🔄 Mover Capital</button>
              <button onClick={()=>setShowCapitalHistory(h=>!h)} style={{flex:1,padding:"14px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,color:"rgba(255,255,255,0.7)",fontFamily:sans,fontSize:14,fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>📜 Historial</button>
            </div>

            {showCapitalHistory&&(
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Historial de Movimientos</div>
                {(capital.movements||[]).map(mv=>{
                  const bucketLabel={operativo:"Operativo",patrimonio:"Patrimonio",boveda:"Bóveda",externo:"Externo"};
                  return(
                    <div key={mv.id} style={{padding:"11px 13px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:"1px solid rgba(255,255,255,0.05)"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                        <span style={{fontSize:11,fontFamily:mono,color:"rgba(255,255,255,0.5)"}}>{fmtDate(mv.date)}</span>
                        {mv.type==="auto"&&<span style={{fontSize:8,fontFamily:mono,color:"#38BDF8",background:"rgba(56,189,248,0.1)",padding:"2px 6px",borderRadius:5,letterSpacing:"0.08em"}}>AUTO</span>}
                        {mv.type==="setup"&&<span style={{fontSize:8,fontFamily:mono,color:"#FCD34D",background:"rgba(245,158,11,0.1)",padding:"2px 6px",borderRadius:5,letterSpacing:"0.08em"}}>SETUP</span>}
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:12,fontFamily:sans,color:"rgba(255,255,255,0.8)"}}>
                          {mv.type==="setup"?"Configuración inicial":mv.type==="auto"?mv.reason:((mv.from?bucketLabel[mv.from]:"?")+" → "+(mv.to?bucketLabel[mv.to]:"?"))}
                        </span>
                        {mv.amount>0&&<span style={{fontSize:13,fontFamily:mono,fontWeight:700,color:mv.type==="auto"?(mv.amount>=0?"#4ADE80":"#F87171"):"#FCD34D"}}>{mv.type==="auto"?(mv.amount>=0?"+":""):""}{"$"+Math.abs(mv.amount).toLocaleString()}</span>}
                      </div>
                      {mv.reason&&mv.type==="manual"&&<div style={{fontSize:10,fontFamily:sans,color:"rgba(255,255,255,0.35)",marginTop:3}}>{mv.reason}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Zona de reinicio */}
            <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
              {!confirmResetCapital?(
                <button onClick={()=>setConfirmResetCapital(true)}
                  style={{width:"100%",padding:"12px",background:"transparent",border:"1px solid rgba(248,113,113,0.2)",borderRadius:12,color:"rgba(248,113,113,0.5)",fontFamily:sans,fontSize:13,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                  ↺ Reiniciar configuración de capital
                </button>
              ):(
                <div style={{padding:"14px",background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:12}}>
                  <p style={{fontFamily:sans,fontSize:13,color:"#F87171",fontWeight:600,marginBottom:6,textAlign:"center"}}>¿Confirmas el reinicio?</p>
                  <p style={{fontFamily:sans,fontSize:11,color:"rgba(255,255,255,0.4)",textAlign:"center",marginBottom:14}}>Se borrarán todos los montos, acciones y movimientos. No se puede deshacer.</p>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={()=>setConfirmResetCapital(false)}
                      style={{flex:1,padding:"12px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,color:"rgba(255,255,255,0.6)",fontFamily:sans,fontSize:13,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                      Cancelar
                    </button>
                    <button onClick={resetCapital}
                      style={{flex:1,padding:"12px",background:"rgba(248,113,113,0.15)",border:"1px solid rgba(248,113,113,0.4)",borderRadius:10,color:"#F87171",fontFamily:sans,fontSize:13,fontWeight:700,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                      Sí, reiniciar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}