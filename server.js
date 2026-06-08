#!/usr/bin/env node
/**
 * Kate's SEPTA Train Finder — proxy server
 * Port: 8686
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const PORT     = process.env.PORT || 8686;
const BASE_API = 'https://api.septa.org/api';
const CACHE_MS = 10000;

const cache = new Map();
function getCached(key) {
  const h = cache.get(key);
  return h && Date.now() - h.ts < CACHE_MS ? h.data : null;
}
function setCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Bad JSON from SEPTA')); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('SEPTA timeout')));
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    return;
  }

  // /api/nexttoarrive?from=X&to=Y&n=6
  if (req.method === 'GET' && u.pathname === '/api/nexttoarrive') {
    const from = u.searchParams.get('from');
    const to   = u.searchParams.get('to');
    const n    = u.searchParams.get('n') || '6';
    if (!from || !to) { send(res, 400, { error: 'from and to required' }); return; }

    const key = `nta:${from}:${to}`;
    const cached = getCached(key);
    if (cached) { send(res, 200, cached); return; }

    try {
      const url = `${BASE_API}/NextToArrive/index.php?req1=${encodeURIComponent(from)}&req2=${encodeURIComponent(to)}&req3=${n}`;
      const data = await fetchJSON(url);
      setCache(key, data);
      send(res, 200, data);
    } catch(e) {
      console.error(`NextToArrive error ${from}→${to}:`, e.message);
      send(res, 502, { error: e.message });
    }
    return;
  }

  // /api/arrivals?station=X  (kept for fallback)
  if (req.method === 'GET' && u.pathname === '/api/arrivals') {
    const station = u.searchParams.get('station');
    if (!station) { send(res, 400, { error: 'station required' }); return; }

    const cached = getCached(`arr:${station}`);
    if (cached) { send(res, 200, cached); return; }

    try {
      const url = `${BASE_API}/Arrivals/index.php?station=${encodeURIComponent(station)}&results=8`;
      const data = await fetchJSON(url);
      setCache(`arr:${station}`, data);
      send(res, 200, data);
    } catch(e) {
      send(res, 502, { error: e.message });
    }
    return;
  }

  send(res, 404, { error: 'not found' });

}).listen(PORT, () => {
  console.log(`Kate's SEPTA Finder → http://localhost:${PORT}`);
});
